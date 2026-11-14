/**
 * The Attach module, against a real tmux on this machine.
 *
 * Not part of `pnpm test`, which is hermetic. This one spawns `tmux -C attach`
 * on a throwaway socket and drives the actual Attach — Control Connection,
 * Client, Client sizing, Topology store and Pane views — through the transport
 * seam:
 *
 *   pnpm e2e:control
 *
 * It exists because the expensive mistakes in this work are the ones no
 * fixture can catch — a command tmux parses differently from how it was meant,
 * a reply correlated to the wrong caller, an option set without anyone
 * noticing, a refusal whose reason never reaches the user. Everything here was
 * measured against tmux 3.7c before it was written; this is what keeps it
 * measured.
 *
 * It no longer assembles the Attach sequence by hand. That was the thing most
 * worth checking and the thing this file was least able to check: a sequence
 * written twice is a sequence that can differ, and the order — size first, so
 * the capture that follows is of a Pane the size of the Surface — is the part
 * that mattered.
 *
 * The transport below stands in for SSH by piping to a local process. That is
 * the one thing it does not prove: whether bytes reach a phone. `e2e/*.ad` and
 * `e2e/regressions.sh` cover that half by driving the app on a simulator.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { openAttach, type Attach, type AttachPhase, type HostConnection } from '@/tmux/attach';
import type { PaneColours } from '@/tmux/commands';
import type { PaneSurface } from '@/tmux/pane-view';
import type { SelectionRows } from '@/tmux/selection-rows';
import type { Host, Records } from '@/storage/records';
import type { HostStore } from '@/storage/store';
import type { ControlChannel, ControlChannelEvents, TmuxTransport } from '@/tmux/transport';

/** A socket of this app's own, so nothing here can touch a real Session. */
const SOCKET = 'muxify-control-mode-e2e';
const SESSION = 'e2e';
const OTHER = 'e2e-other';

/** The Surface's grid, which the Attach is told and the Window follows. */
const GRID = { cols: 40, rows: 20 };
const SURFACE = { width: 400, height: 400 };

function tmux(args: string[]): string {
  // stderr piped rather than inherited: killing a server that is not there is
  // the normal case, and its complaint is not this check's output.
  return execFileSync('tmux', ['-L', SOCKET, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const host = (over: Partial<Host> = {}): Host => ({
  id: 'e2e-host',
  displayName: 'Local tmux',
  address: '127.0.0.1',
  port: 22,
  identityId: 'e2e-identity',
  ...over,
});

/** Everything the Attach writes down, kept in memory. */
function memoryStore() {
  const wrote: string[] = [];
  const records: Records = { hosts: [host()], identities: [], fingerprints: [], recentSessions: [], lastPlace: null };
  const store: HostStore = {
    load: () => Promise.resolve(records),
    saveHost: () => Promise.reject(new Error('not used by this check')),
    removeHost: () => Promise.resolve(),
    reorderHosts: () => Promise.resolve(),
    credentialFor: () => Promise.resolve('unused'),
    rememberFingerprint: () => Promise.resolve(),
    fingerprintFor: () => Promise.resolve(undefined),
    rememberSession: (hostId, name) => {
      wrote.push(`${hostId}:${name}`);
      return Promise.resolve();
    },
    forgetSession: () => Promise.resolve(),
    recentSessionsFor: () => Promise.resolve([]),
    rememberLastPlace: () => Promise.resolve(),
    forgetLastPlace: () => Promise.resolve(),
  };
  return { store, wrote };
}

/**
 * The transport seam, over a local tmux instead of an SSH Connection.
 *
 * The command it is handed is the shell line that would reach a Host, so the
 * only liberty taken is pointing it at the throwaway socket — and only when it
 * is the ordinary `tmux`, so a Host record with a wrong executable path still
 * fails the way it would on a real machine.
 */
/**
 * A hand on the link, for the checks that break it: what was written down it,
 * whether tmux's answers still come back, and a wait before the next link.
 */
interface LinkTap {
  /** Every line written to tmux, on every link. */
  lines: string[];
  /** While true, what tmux says is dropped: the link took a line and died before the reply. */
  deaf: boolean;
  /** The next Connection opens when this resolves. */
  gate: Promise<void>;
}

function localTransport(children: ChildProcess[], tap?: LinkTap): TmuxTransport {
  return {
    exec: () => Promise.reject(new Error('not used by this check')),
    async openControl(command: string, events: ControlChannelEvents): Promise<ControlChannel> {
      const child = spawn('/bin/sh', ['-c', command.replace(/^tmux /, `tmux -L ${SOCKET} `)]);
      children.push(child);
      let open = true;
      const forward = (chunk: Buffer) => {
        if (tap?.deaf) return;
        events.onData(
          chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
        );
      };
      // A killed child's stdin throws EPIPE on the next write. An SSH channel
      // does not — it drops the bytes — so this is swallowed here rather than
      // guarded above the seam, where nothing would be guarding anything real.
      child.stdin.on('error', () => {});
      child.stdout.on('data', forward);
      // Without a pty the server keeps stderr separate, and tmux writes its own
      // startup failures there. Merged in exactly as the SSH adapter does.
      child.stderr.on('data', forward);
      child.on('close', () => {
        open = false;
        events.onClosed(undefined);
      });
      return {
        write: (bytes) => {
          tap?.lines.push(...Buffer.from(bytes).toString('utf8').split('\n').filter((line) => line !== ''));
          if (open) child.stdin.write(Buffer.from(bytes));
        },
        // What the foreground check asks. A dead child is a dead channel, and
        // that is the whole of the liveness question on this side of the seam.
        isOpen: () => open && child.exitCode === null && !child.killed,
        close: async () => {
          open = false;
          child.kill();
        },
      };
    },
  };
}

/** A Surface that records what was painted on it, standing in for the library. */
function recordingSurface() {
  const written: Uint8Array[] = [];
  const selections: SelectionRows[] = [];
  let focused = false;
  const surface: PaneSurface = {
    write: (bytes) => written.push(bytes),
    focus: () => {
      focused = true;
    },
    blur: () => {
      focused = false;
    },
    isFocused: () => Promise.resolve(focused),
    showSelection: (rows) => selections.push(rows),
    endSelection: () => {},
    followSelectionPress: () => {},
  };
  return {
    surface,
    written,
    selections,
    text: () => Buffer.concat(written.map((each) => Buffer.from(each))).toString('utf8'),
  };
}

function attachTo(options: { sessionName?: string; record?: Host; colours?: PaneColours; tap?: LinkTap } = {}) {
  const children: ChildProcess[] = [];
  const { store, wrote } = memoryStore();
  const phases: AttachPhase[] = [];
  const record = options.record ?? host();

  const attach = openAttach({
    host: record,
    destination: { sessionName: options.sessionName ?? SESSION, topic: null },
    zoomed: true,
    colours: options.colours,
    store,
    openConnection: async (): Promise<HostConnection> => {
      await options.tap?.gate;
      if (options.tap) options.tap.deaf = false;
      return {
        transport: localTransport(children, options.tap),
        fingerprint: 'SHA256:local',
        verdict: { kind: 'known' },
        close: () => Promise.resolve(),
      };
    },
  });

  attach.subscribe((state) => {
    if (phases[phases.length - 1]?.kind !== state.phase.kind) phases.push(state.phase);
  });

  // The Surface reporting itself, which is what lets the Attach begin.
  attach.containerLaidOut(SURFACE);
  attach.windowGridReported(GRID, SURFACE);

  return { attach, children, phases, wrote, store };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the Attach to reach a phase, or gives up with what it saw. */
async function reaches(attach: Attach, kind: AttachPhase['kind'], within = 8000): Promise<void> {
  const until = Date.now() + within;
  while (Date.now() < until) {
    if (attach.state().phase.kind === kind) return;
    await wait(50);
  }
  throw new Error(
    `never reached ${kind}; it is ${JSON.stringify(attach.state().phase)}`,
  );
}

describe('the Attach, against a real tmux', () => {
  beforeAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // No server to kill, which is the usual case.
    }
    tmux(['new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24']);
    tmux(['new-session', '-d', '-s', OTHER, '-x', '100', '-y', '30']);
  });

  afterAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // Already gone.
    }
  });

  it('attaches in order, paints, types, scrolls and borrows nothing', async () => {
    // Every later reading is compared against this.
    const before = tmux(['show-options', '-t', SESSION]);

    const { attach, wrote } = attachTo();
    await reaches(attach, 'connected');

    const state = attach.state();
    expect(state.sessionName).toBe(SESSION);
    expect(state.topology.activeWindow?.id).toMatch(/^@\d+$/);
    expect(state.topology.activePane?.id).toMatch(/^%\d+$/);
    expect(state.sessions?.map((each) => each.name)).toContain(SESSION);
    // Stamped on a Session that actually opened.
    expect(wrote).toContain(`e2e-host:${SESSION}`);

    // Size first, so the Window is the Surface's shape before anything is
    // captured from it. `refresh-client -C` is the only thing that moved it.
    expect(
      tmux(['display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}']),
    ).toContain('40x20');

    const paneId = state.topology.activePane?.id as string;
    const screen = recordingSurface();
    attach.surfaceForPane(paneId, screen.surface);
    attach.paneGridReported(paneId, GRID);
    // The Pane view's own settling period, measured on a device.
    await wait(600);
    expect(screen.written.length).toBeGreaterThan(0);

    const view = attach.view(paneId);

    // Typing reaches the Pane, through send-keys and no PTY.
    view.type(new TextEncoder().encode('echo LIVE_CHECK_OK\r'));
    await wait(900);
    expect(tmux(['capture-pane', '-p', '-t', paneId])).toContain('LIVE_CHECK_OK');

    // Named keys, by tmux's name for each, into a `cat -v` that prints
    // back exactly what arrived. This is the half that cannot be driven from
    // the device: a SwiftUI menu's cells report no usable frame.
    view.type(new TextEncoder().encode('cat -v\r'));
    await wait(700);
    for (const key of ['Escape', 'Tab', 'Up', 'Down', 'Left', 'Right', 'Home', 'M-b']) {
      view.press(key);
      await wait(120);
    }
    await wait(600);
    // What a terminal sends for each, with the Pane in its ordinary cursor
    // mode: an application that turns DECCKM on gets `ESC O A` for Up instead,
    // which is the whole reason the name is sent rather than the bytes. Tab
    // arrives as a real tab: `cat -v` escapes the non-printing characters but
    // leaves that one alone.
    expect(tmux(['capture-pane', '-p', '-t', paneId])).toContain('^[\t^[[A^[[B^[[D^[[C^[[1~^[b');
    view.press('C-c');
    await wait(500);
    expect(tmux(['display-message', '-p', '-t', paneId, '#{pane_current_command}']).trim()).not.toBe(
      'cat',
    );

    // Scrollback comes from a capture. tmux's copy-mode is never entered.
    view.type(new TextEncoder().encode('seq 1 200\r'));
    await wait(1200);
    screen.written.length = 0;
    view.scroll(6, GRID);
    await wait(600);
    expect(screen.text()).toMatch(/\d/);
    expect(tmux(['display-message', '-p', '-t', paneId, '#{pane_in_mode}']).trim()).toBe('0');

    // The whole point: nothing was set, and there is nothing to put back.
    expect(tmux(['show-options', '-t', SESSION])).toBe(before);
    expect(tmux(['show-hooks', '-t', SESSION]).trim()).toBe('');

    await attach.close();
    await wait(300);
    expect(tmux(['show-options', '-t', SESSION])).toBe(before);
  }, 40000);

  it('gives a Selection the rows on the Surface, and holds the Pane still for it', async () => {
    const { attach } = attachTo();
    await reaches(attach, 'connected');
    const paneId = attach.state().topology.activePane?.id as string;
    const screen = recordingSurface();
    attach.surfaceForPane(paneId, screen.surface);
    attach.paneGridReported(paneId, GRID);
    await wait(600);
    const view = attach.view(paneId);

    // Forty columns: AAAA, a space and 35 of B fill the first row, and tmux
    // wraps the last ten onto the second.
    view.type(new TextEncoder().encode(`clear; printf 'AAAA %s\\n' ${'B'.repeat(45)}; echo end\r`));
    await wait(1200);

    expect(view.beginSelection({ x: 1, y: 1 })).toBe(true);
    await wait(600);
    const shown = screen.selections.at(-1);
    expect(shown?.rows.slice(0, 3).map((row) => [row.text, row.wraps])).toEqual([
      [`AAAA ${'B'.repeat(35)}`, true],
      ['B'.repeat(10), false],
      ['end', false],
    ]);
    // The first row's line counts from the first line of the Scrollback.
    const history = Number(tmux(['display-message', '-p', '-t', paneId, '#{history_size}']));
    expect(shown?.top).toBe(history);
    expect(shown?.rows[0].line).toBe(history);

    // Frozen: what the Pane prints now is not painted until the Selection ends.
    screen.written.length = 0;
    tmux(['send-keys', '-t', paneId, 'echo WHILE_FROZEN', 'Enter']);
    await wait(700);
    expect(screen.text()).not.toContain('WHILE_FROZEN');
    view.endSelection();
    await wait(700);
    expect(screen.text()).toContain('WHILE_FROZEN');

    await attach.close();
  }, 20000);

  it('re-sizes the Session it is switched into, and stamps it', async () => {
    const { attach, wrote } = attachTo();
    await reaches(attach, 'connected');

    await attach.switchSession({ sessionName: OTHER, topic: null });
    await wait(500);

    expect(attach.state().sessionName).toBe(OTHER);
    // The Session switched into was 100x30, laid out for whoever attached to
    // it last. The size goes out again though this Client's has not changed.
    expect(
      tmux(['display-message', '-p', '-t', OTHER, '#{window_width}x#{window_height}']),
    ).toContain('40x20');
    expect(wrote).toContain(`e2e-host:${OTHER}`);

    await attach.close();
  }, 30000);

  it('carries a split made on the tmux side into the state, with no picker opened', async () => {
    const { attach } = attachTo();
    await reaches(attach, 'connected');
    const before = attach.state().topology.panes.length;

    tmux(['split-window', '-t', `${SESSION}:`]);
    await wait(1200);

    expect(attach.state().topology.panes.length).toBeGreaterThan(before);

    await attach.close();
  }, 30000);

  it.each([
    ['a split', [['split-window', '-t', `${SESSION}:`]]],
    ['a plain select-pane', [['select-pane', '-t', `${SESSION}:.+`]]],
    ['a Pane closing', [['split-window', '-t', `${SESSION}:`], ['kill-pane', '-t', `${SESSION}:.+`]]],
  ])('keeps the Window zoomed through %s made on the tmux side', async (_, commands) => {
    // Two Panes, zoomed by the Attach, before tmux does anything to them.
    tmux(['kill-pane', '-a', '-t', `${SESSION}:`]);
    tmux(['split-window', '-t', `${SESSION}:`]);
    const { attach } = attachTo();
    await reaches(attach, 'connected');
    await wait(500);
    expect(tmux(['display', '-p', '-t', `${SESSION}:`, '#{window_zoomed_flag}']).trim()).toBe('1');

    for (const command of commands) tmux(command);
    await wait(1500);

    expect(tmux(['display', '-p', '-t', `${SESSION}:`, '#{window_zoomed_flag}']).trim()).toBe('1');
    expect(attach.state().topology.activeWindow?.zoomed).toBe(true);

    await attach.close();
  }, 30000);

  it('keeps the Window zoomed through a split made from the phone', async () => {
    // The verb re-applies the preference, and the Attach sees tmux drop the
    // zoom at the same moment: two toggles in flight, which must not cancel.
    tmux(['kill-pane', '-a', '-t', `${SESSION}:`]);
    tmux(['split-window', '-t', `${SESSION}:`]);
    const { attach } = attachTo();
    await reaches(attach, 'connected');
    await wait(500);

    await attach.split('right');
    await wait(1500);

    expect(tmux(['display', '-p', '-t', `${SESSION}:`, '#{window_zoomed_flag}']).trim()).toBe('1');

    await attach.close();
  }, 30000);

  it('leaves a Window unzoomed on the tmux side as it was put', async () => {
    tmux(['kill-pane', '-a', '-t', `${SESSION}:`]);
    tmux(['split-window', '-t', `${SESSION}:`]);
    const { attach } = attachTo();
    await reaches(attach, 'connected');
    await wait(500);

    tmux(['resize-pane', '-Z', '-t', `${SESSION}:`]);
    await wait(1500);

    expect(tmux(['display', '-p', '-t', `${SESSION}:`, '#{window_zoomed_flag}']).trim()).toBe('0');

    await attach.close();
  }, 30000);

  it('ends in tmux’s own words when there is no such Session', async () => {
    const { attach } = attachTo({ sessionName: 'no-such-session-here' });
    await reaches(attach, 'disconnected');

    const phase = attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    // Measured, then asserted: tmux 3.7c says `can't find session:` followed
    // by the name it was given.
    expect(phase.reason.detail.toLowerCase()).toContain("can't find session");
    expect(phase.reason.kind).toBe('session-ended');

    await attach.close();
  }, 30000);

  it('ends in the shell’s own words when tmux is not where the Host record says', async () => {
    // The loose end this settles. tmux's stderr is merged into the control
    // stream, and the parser drops every line outside a reply block that does
    // not start with `%` — so this used to close saying nothing at all.
    const { attach } = attachTo({
      record: host({ tmuxExecutablePath: '/nonexistent/bin/tmux' }),
    });
    await reaches(attach, 'disconnected');

    const phase = attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.detail).toMatch(/not found|No such file/i);
    expect(phase.reason.kind).toBe('tmux-unavailable');

    await attach.close();
  }, 30000);

  it('reads a killed child process as a lost transport', async () => {
    const { attach, children, phases } = attachTo();
    await reaches(attach, 'connected');

    children[0].kill('SIGKILL');
    await wait(500);

    // Disconnected with a transport-lost reason, then reconnecting: only a
    // lost transport is retried, and it is retried once.
    const disconnected = phases.find((phase) => phase.kind === 'disconnected');
    if (disconnected?.kind !== 'disconnected') throw new Error('never disconnected');
    expect(disconnected.reason.kind).toBe('transport-lost');

    await reaches(attach, 'connected');
    expect(children.length).toBe(2);

    await attach.close();
  }, 30000);

  it('restores once on returning to the foreground with a dead link', async () => {
    const { attach, children, phases } = attachTo();
    await reaches(attach, 'connected');

    // Suspended: the link dies and nobody is there to hear it.
    attach.lifecycleChanged('background');
    children[0].kill('SIGKILL');
    await wait(400);
    expect(children.length).toBe(1);

    attach.lifecycleChanged('active');
    await reaches(attach, 'connected');

    expect(phases.map((phase) => phase.kind)).toContain('restoring');
    expect(children.length).toBe(2);

    await attach.close();
  }, 30000);

  it('ends in “Session ended” when the Session is killed, and does not come back', async () => {
    const doomed = 'e2e-doomed';
    tmux(['new-session', '-d', '-s', doomed, '-x', '80', '-y', '24']);
    const { attach, children } = attachTo({ sessionName: doomed });
    await reaches(attach, 'connected');

    tmux(['kill-session', '-t', doomed]);
    await reaches(attach, 'disconnected');

    const phase = attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.kind).toBe('session-ended');

    // Nothing reconnects on its own for a Session that has gone.
    await wait(800);
    expect(attach.state().phase.kind).toBe('disconnected');
    expect(children.length).toBe(1);

    await attach.close();
  }, 30000);

  it('answers a program in any Window of the Session with the Theme’s colours', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'muxify-colours-'));
    const asker = join(dir, 'asker.py');
    const heard = join(dir, 'heard');
    // A program like NeoVim: it turns on mode 2031 and asks for the
    // background, and here it writes down every answer the terminal gives.
    writeFileSync(asker, [
      'import os, sys, tty, time, select',
      'tty.setraw(0)',
      "os.write(1, b'\\x1b[?2031h')",
      'while True:',
      "    os.write(1, b'\\x1b]11;?\\x1b\\\\')",
      '    end = time.time() + 0.3',
      '    while time.time() < end:',
      '        if select.select([0], [], [], 0.05)[0]:',
      "            open(sys.argv[1], 'a').write(repr(os.read(0, 4096)) + '\\n')",
    ].join('\n'));
    tmux(['new-window', '-d', '-t', `${SESSION}:`, `python3 ${asker} ${heard}`]);
    const answers = () => {
      try { return readFileSync(heard, 'utf8'); } catch { return ''; }
    };

    const { attach } = attachTo({ colours: { foreground: '#657b83', background: '#fdf6e3' } });
    await reaches(attach, 'connected');
    await wait(1500);
    expect(answers()).toContain('rgb:fdfd/f6f6/e3e3');

    attach.coloursChanged({ foreground: '#ebdbb2', background: '#1d2021' });
    await wait(1500);
    expect(answers()).toContain('rgb:1d1d/2020/2121');
    // tmux tells a program that asked for mode 2031 that the Theme went dark.
    expect(answers()).toContain('\\x1b[?997;1n');

    await attach.close();
    rmSync(dir, { recursive: true, force: true });
  }, 30000);
});

describe('typed keys, against a real tmux and a link that breaks', () => {
  const TYPED = 'e2e-typed';
  const encode = (text: string) => new TextEncoder().encode(text);

  /** Refuses to go on unless the server is this suite's own, in its own folder. */
  function ownServer(): void {
    const folder = process.env.TMUX_TMPDIR;
    if (!folder || process.env.TMUX) throw new Error('run this through e2e/sandbox.sh');
    const socket = tmux(['display-message', '-p', '#{socket_path}']).trim();
    if (!socket.startsWith(`${realpathSync(folder)}/`)) throw new Error(`${socket} is not this run's server`);
  }

  /** A Session whose one Pane runs `cat`: the terminal shows each typed character once. */
  const startServer = () => tmux(['new-session', '-d', '-s', TYPED, '-x', '80', '-y', '24', 'cat']);

  async function until(what: string, done: () => boolean, within = 8000): Promise<void> {
    const end = Date.now() + within;
    while (!done()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await wait(50);
    }
  }

  /** The Topology is read after the phase says connected. */
  async function activePane(attach: Attach): Promise<string> {
    await reaches(attach, 'connected');
    await until('the Topology', () => attach.state().topology.activePane !== undefined);
    return attach.state().topology.activePane?.id as string;
  }

  beforeAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // No server to kill.
    }
    startServer();
    ownServer();
  });

  afterAll(() => {
    try {
      ownServer();
      tmux(['kill-server']);
    } catch {
      // Already gone.
    }
  });

  it('types each key once, holds the risky ones, and tells of the ones it threw away', async () => {
    const tap: LinkTap = { lines: [], deaf: false, gate: Promise.resolve() };
    const { attach, children } = attachTo({ sessionName: TYPED, tap });
    const paneId = await activePane(attach);
    const screen = () => tmux(['capture-pane', '-p', '-t', paneId]).trimEnd();
    const type = (text: string) => attach.view(paneId).type(encode(text));
    /** Kills the link and keeps the next one closed until the returned function is called. */
    const breakLink = async () => {
      let open!: () => void;
      tap.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      children[children.length - 1].kill('SIGKILL');
      await reaches(attach, 'reconnecting');
      return open;
    };

    // The Pane on screen, as it is before the user types: its mark is read.
    attach.view(paneId);
    await wait(400);

    // tmux takes the line and the link dies before the reply.
    tap.deaf = true;
    type('abc');
    await until('abc in the Pane', () => screen() === 'abc');
    let reopen = await breakLink();
    type('def');
    reopen();
    await reaches(attach, 'connected');
    await until('def in the Pane', () => screen().endsWith('def'));
    await wait(700);
    expect(screen()).toBe('abcdef');
    expect(attach.state().input).toEqual([]);

    // The line of the dead link arrives again, late, as it was written.
    const batchLines = tap.lines.filter((line) => line.startsWith("'if-shell'"));
    expect(batchLines.length).toBeGreaterThanOrEqual(2);
    const late = spawn('tmux', ['-L', SOCKET, '-C', 'attach-session', '-t', TYPED]);
    late.stdin.write(`${batchLines.join('\n')}\n`);
    await wait(700);
    late.kill();
    expect(screen()).toBe('abcdef');

    // Enter typed while the link is down waits for the user.
    reopen = await breakLink();
    type('x');
    attach.view(paneId).press('Enter');
    reopen();
    await reaches(attach, 'connected');
    await until('a held notice', () => attach.state().input.length > 0);
    expect(attach.state().input).toMatchObject([
      { kind: 'held', paneId, preview: 'x⏎', reasons: ['risky-keys'] },
    ]);
    expect(screen()).toBe('abcdef');
    attach.heldInput(paneId, 'send');
    // The terminal shows the line as typed, and `cat` prints it once more.
    await until('the held keys in the Pane', () => screen() === 'abcdefx\nabcdefx');
    await wait(700);
    expect(screen()).toBe('abcdefx\nabcdefx');
    expect(attach.state().input).toEqual([]);

    // The server goes, and another starts with a new Pane under the same id.
    ownServer();
    tmux(['kill-server']);
    await reaches(attach, 'disconnected');
    type('zzz');
    startServer();
    expect(tmux(['display-message', '-p', '-t', TYPED, '#{pane_id}']).trim()).toBe(paneId);
    attach.reconnect();
    await reaches(attach, 'connected');
    await until('a discarded notice', () => attach.state().input.length > 0);
    expect(attach.state().input).toEqual([
      { kind: 'discarded', paneId, preview: 'zzz', reason: 'server-restarted' },
    ]);
    await wait(700);
    expect(screen()).toBe('');

    await attach.close();
  }, 60000);

  it('types a key whose name needs every kind of quoting, once, through the guard', async () => {
    const { attach } = attachTo({ sessionName: TYPED });
    const paneId = await activePane(attach);
    tmux(['respawn-pane', '-k', '-t', paneId, 'cat -v']);
    await wait(500);

    const names = ['M-;', "M-'", 'M-"', 'M-\\', 'M-$', 'M-#', 'M-{', ';', "'", '#{pid}', '$HOME'];
    for (const name of names) attach.view(paneId).press(name);
    const typed = '^[;^[\'^["^[\\^[$^[#^[{;\'#{pid}$HOME';
    const screen = () => tmux(['capture-pane', '-p', '-t', paneId]).trimEnd();
    await until('every key in the Pane', () => screen().length >= typed.length);
    await wait(500);
    expect(screen()).toBe(typed);
    expect(attach.state().input).toEqual([]);

    await attach.close();
  }, 30000);
});
