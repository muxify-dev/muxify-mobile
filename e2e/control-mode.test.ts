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
import {
  claimWindowCommand,
  renderControlCommand,
  reportPaneColoursCommands,
  resizeClientCommand,
  type PaneColours,
} from '@/tmux/commands';
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

/** Everything the Attach writes down, kept in memory, with the Host record it reads back. */
function memoryStore(record: Host) {
  const wrote: string[] = [];
  const records: Records = { hosts: [record], identities: [], fingerprints: [], recentSessions: [], lastPlace: null, places: [] };
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
    recentSessionsFor: () => Promise.resolve([]),
    rememberLastPlace: () => Promise.resolve(),
    forgetLastPlace: () => Promise.resolve(),
    placeFor: () => Promise.resolve(null),
    rememberPlace: () => Promise.resolve(),
    pruneSessionPlaces: () => Promise.resolve(),
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
  /** The link goes deaf from the first line written that starts with this. */
  deafFrom?: string;
  /** While true, a line written is kept in `lines` and never reaches tmux: the link died before it left. */
  unsent?: boolean;
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
          const lines = Buffer.from(bytes).toString('utf8').split('\n').filter((line) => line !== '');
          tap?.lines.push(...lines);
          if (tap?.deafFrom && lines.some((line) => line.startsWith(tap.deafFrom as string))) tap.deaf = true;
          if (open && !tap?.unsent) child.stdin.write(Buffer.from(bytes));
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
  const record = options.record ?? host();
  const { store, wrote } = memoryStore(record);
  const phases: AttachPhase[] = [];

  const attach = openAttach({
    host: record,
    destination: { sessionName: options.sessionName ?? SESSION, topic: null },
    zoomed: true,
    colours: options.colours,
    store,
    openConnection: async (): Promise<HostConnection> => {
      await options.tap?.gate;
      if (options.tap) Object.assign(options.tap, { deaf: false, deafFrom: undefined, unsent: false });
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

async function until(what: string, done: () => boolean, within = 8000): Promise<void> {
  const end = Date.now() + within;
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

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

    // The Attach opens unsized and asks for the Surface's grid once it
    // settles. `refresh-client -C` is the only thing that moves the Window.
    const windowSize = () =>
      tmux(['display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}']).trim();
    await until('the Window at the Surface grid', () => windowSize() === '40x20');

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

describe('the colours of the screen in use, against a real tmux', () => {
  const SCREENS = 'e2e-screens';
  const PHONE: PaneColours = { foreground: '#657b83', background: '#fdf6e3' };
  const MAC: PaneColours = { foreground: '#ebdbb2', background: '#1d2021' };
  const PHONE_ANSWER = 'rgb:fdfd/f6f6/e3e3';
  const MAC_ANSWER = 'rgb:1d1d/2020/2121';

  beforeAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // No server to kill, which is the usual case.
    }
  });

  afterAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // Already gone.
    }
  });

  it('answers a probe with the colours of the screen that acted last, the phone or the Mac', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'muxify-screens-'));
    const asker = join(dir, 'asker.py');
    const heard = join(dir, 'heard');
    // The probe: asks for the background over and over, and writes down
    // every answer.
    writeFileSync(asker, [
      'import os, sys, tty, time, select',
      'tty.setraw(0)',
      'while True:',
      "    os.write(1, b'\\x1b]11;?\\x1b\\\\')",
      '    end = time.time() + 0.2',
      '    while time.time() < end:',
      '        if select.select([0], [], [], 0.05)[0]:',
      "            open(sys.argv[1], 'a').write(repr(os.read(0, 4096)) + '\\n')",
    ].join('\n'));
    const shell = tmux(['new-session', '-d', '-s', SCREENS, '-x', '80', '-y', '24', '-P', '-F', '#{pane_id}']).trim();
    const probe = tmux(['split-window', '-d', '-t', `${SCREENS}:`, '-P', '-F', '#{pane_id}', `python3 ${asker} ${heard}`]).trim();
    /** The background the probe was last answered with. */
    const lastAnswer = () => {
      let text = '';
      try { text = readFileSync(heard, 'utf8'); } catch { /* not asked yet */ }
      return [...text.matchAll(/rgb:[0-9a-f/]+/g)].pop()?.[0] ?? null;
    };

    // A fake Mac terminal: a second control Client that writes its own
    // colours where its user acts, and takes the Window's size, as desktop
    // Muxify does.
    const mac = spawn('/bin/sh', ['-c', `tmux -L ${SOCKET} -C attach -t ${SCREENS}`]);
    mac.stdin.on('error', () => {});
    const macRuns = (...commands: string[][]) =>
      mac.stdin.write(commands.map((argv) => `${renderControlCommand(argv)}\n`).join(''));
    const macActs = (...first: string[][]) => macRuns(
      ...first,
      claimWindowCommand(),
      resizeClientCommand(100, 30),
      ...reportPaneColoursCommands(probe, MAC),
    );

    const { attach } = attachTo({ sessionName: SCREENS, colours: PHONE });
    try {
      await reaches(attach, 'connected');
      await wait(1200);
      expect(lastAnswer()).toBe(PHONE_ANSWER);

      macActs();
      await wait(1200);
      expect(lastAnswer()).toBe(MAC_ANSWER);

      // A phone pick.
      expect(attach.selectPane(probe)).toBe(true);
      await wait(1200);
      expect(lastAnswer()).toBe(PHONE_ANSWER);

      // A Mac key, at a Window the Mac's size already: nothing the phone sees.
      macActs();
      await wait(1200);
      expect(lastAnswer()).toBe(MAC_ANSWER);

      // A phone key takes the size and the colours back.
      attach.view(probe).type(new TextEncoder().encode('x'));
      await wait(1200);
      expect(lastAnswer()).toBe(PHONE_ANSWER);
      expect(tmux(['display-message', '-p', '-t', SCREENS, '#{window_width}x#{window_height}'])).toContain('40x20');

      // A Mac key that moves the focus, and resizes nothing.
      macRuns(['select-pane', '-t', shell], ...reportPaneColoursCommands(probe, MAC));
      await wait(1200);
      expect(lastAnswer()).toBe(MAC_ANSWER);
      expect(tmux(['display-message', '-p', '-t', SCREENS, '#{window_width}x#{window_height}'])).toContain('40x20');

      attach.view(probe).type(new TextEncoder().encode('x'));
      await wait(1200);
      expect(lastAnswer()).toBe(PHONE_ANSWER);

      // A Mac key that takes the Window's size from the phone.
      macActs();
      await wait(1200);
      expect(lastAnswer()).toBe(MAC_ANSWER);

      attach.view(probe).press('Escape');
      await wait(1200);
      expect(lastAnswer()).toBe(PHONE_ANSWER);
    } finally {
      mac.kill();
      await attach.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
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
      { kind: 'discarded', paneId, preview: 'zzz', reason: 'server-restarted', message: false },
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

  /** A stopped server answers nothing, also not the `kill-server` of the clean-up. */
  let frozen: number | null = null;
  afterEach(() => {
    if (frozen !== null) process.kill(frozen, 'SIGCONT');
    frozen = null;
  });

  /** Says each check as it passes, so a run shows what it proved. */
  function check(what: string, actual: unknown, expected: unknown): void {
    expect(actual).toEqual(expected);
    process.stdout.write(`  ok: ${what}\n`);
  }

  /** An Attach on a Pane that runs `cat`, or `program`, from a clean screen, with its mark read. */
  async function catPane(program = 'cat') {
    tmux(['respawn-pane', '-k', '-t', TYPED, program]);
    tmux(['clear-history', '-t', TYPED]);
    const tap: LinkTap = { lines: [], deaf: false, gate: Promise.resolve() };
    const kit = attachTo({ sessionName: TYPED, tap });
    const paneId = await activePane(kit.attach);
    kit.attach.view(paneId);
    await wait(400);
    const screen = () => tmux(['capture-pane', '-p', '-t', paneId]).trimEnd();
    /** The tmux server stops reading, as a Host does whose network went away mid-line. */
    const serverPid = Number(tmux(['display-message', '-p', '#{pid}']).trim());
    const freeze = () => {
      frozen = serverPid;
      process.kill(serverPid, 'SIGSTOP');
    };
    const thaw = () => {
      frozen = null;
      process.kill(serverPid, 'SIGCONT');
    };
    /**
     * Ends the link, and starts a stopped server again. The next link opens
     * when the returned function is called.
     *
     * The server holds the client's stdout, so the link closes only once
     * the server runs again and reads what the dead client wrote.
     */
    const breakLink = async () => {
      let open!: () => void;
      tap.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      kit.children[kit.children.length - 1].kill('SIGKILL');
      await wait(200);
      if (frozen !== null) thaw();
      await reaches(kit.attach, 'reconnecting');
      return open;
    };
    /** Writes every line that started a paste again, as a late copy from a lost link. */
    const replayLate = async () => {
      const lines = tap.lines.filter((line) => line.startsWith("'set-buffer'") || line.startsWith("'if-shell'"));
      const late = spawn('tmux', ['-L', SOCKET, '-C', 'attach-session', '-t', TYPED]);
      late.stdin.write(`${lines.join('\n')}\n`);
      await wait(700);
      late.kill();
      return lines.length;
    };
    return { ...kit, tap, paneId, screen, breakLink, freeze, replayLate };
  }

  describe('a split and a New Window, across a break', () => {
    const panes = () => tmux(['list-panes', '-t', `${TYPED}:`]).split('\n').filter(Boolean).length;
    const windows = () => tmux(['list-windows', '-t', TYPED]).split('\n').filter(Boolean).length;

    /** One Window with one Pane, and an Attach on it. */
    async function oneWindow() {
      tmux(['kill-window', '-a', '-t', `${TYPED}:`]);
      tmux(['kill-pane', '-a', '-t', `${TYPED}:`]);
      return catPane();
    }

    it.each([
      ['a split', 'one new Pane', (attach: Attach) => attach.split('right'), panes],
      ['a New Window', 'one new Window', (attach: Attach) => attach.newWindow(), windows],
    ])('makes %s once when the reply is lost, and once when the server stops, and not after it starts again', async (what, made, verb, count) => {
      ownServer();
      const pane = await oneWindow();
      const { attach, tap } = pane;
      const before = count();
      process.stdout.write(`  ${what}: ${before} before\n`);

      // tmux runs the line, and the link dies before the reply.
      tap.deafFrom = "'if-shell'";
      const lost = verb(attach);
      await until(`${made}`, () => count() === before + 1);
      let reopen = await pane.breakLink();
      await lost;
      check(`${what} whose reply was lost ends without an error`, true, true);
      reopen();
      await reaches(attach, 'connected');
      await wait(900);
      check(`${what} whose reply was lost makes ${made}`, count(), before + 1);

      // The server stops with the line on its way, and the link ends.
      pane.freeze();
      const stopped = verb(attach);
      await wait(300);
      reopen = await pane.breakLink();
      await stopped;
      reopen();
      await reaches(attach, 'connected');
      await until(`${made} after the reconnect`, () => count() === before + 2);
      await wait(900);
      check(`${what} sent while the server stopped makes ${made}`, count(), before + 2);

      // The line never leaves the phone, so the next Connection sends it again.
      tap.unsent = true;
      const unsent = verb(attach);
      await wait(300);
      check(`${what} that did not leave the phone makes nothing yet`, count(), before + 2);
      reopen = await pane.breakLink();
      await unsent;
      reopen();
      await reaches(attach, 'connected');
      await until(`${made} sent again`, () => count() === before + 3);
      await wait(900);
      check(`${what} sent again after the break makes ${made}`, count(), before + 3);

      const replayed = await pane.replayLate();
      process.stdout.write(`  (wrote ${replayed} lines of both links again)\n`);
      check(`late copies of ${what} make nothing`, count(), before + 3);
      check(`no line of trouble after ${what}`, attach.state().trouble, null);

      // The server starts again during the break, and its new Session has the same id.
      const sessionId = () => tmux(['display-message', '-p', '-t', TYPED, '#{session_id}']).trim();
      const idBefore = sessionId();
      tap.unsent = true;
      const restarted = verb(attach);
      await wait(300);
      reopen = await pane.breakLink();
      await restarted;
      ownServer();
      tmux(['kill-server']);
      startServer();
      check(`the new Session has the id of the old one`, sessionId(), idBefore);
      reopen();
      await reaches(attach, 'connected');
      await wait(900);
      check(`${what} kept across a server restart makes nothing in the new Session`, count(), 1);

      await attach.close();
    }, 60000);
  });

  describe('a paste and a Composer Send, across a break', () => {
    it('sends a Composer message once, whether tmux took its line before the break or not', async () => {
      ownServer();
      const pane = await catPane();
      const { attach, paneId, screen, tap } = pane;

      // tmux runs the whole paste line, and the link dies before the reply.
      tap.deafFrom = "'if-shell'";
      attach.composer.edit(paneId, 'alpha');
      await attach.composer.send(paneId);
      check('the Draft keeps the message until tmux confirms it', attach.composer.draft(paneId).text, 'alpha');
      await until('alpha in the Pane', () => screen() === 'alpha\nalpha');
      let reopen = await pane.breakLink();
      reopen();
      await reaches(attach, 'connected');
      await wait(900);
      check('a Send whose reply was lost is not held', attach.state().input, []);
      check('a Send whose reply was lost shows once', screen(), 'alpha\nalpha');
      check('the Draft is empty when the next Connection confirms the message', attach.composer.draft(paneId).text, '');

      // The server stops with the Send on its way, and the link ends.
      pane.freeze();
      attach.composer.edit(paneId, 'bravo');
      await attach.composer.send(paneId);
      await wait(300);
      reopen = await pane.breakLink();
      reopen();
      await reaches(attach, 'connected');
      await until('a held notice', () => attach.state().input.length > 0);
      check('a Send that did not arrive is held for the user', attach.state().input, [
        expect.objectContaining({ kind: 'held', paneId, preview: 'bravo⏎', reasons: ['risky-keys'] }),
      ]);
      check('a held Send has not reached the Pane', screen(), 'alpha\nalpha');
      check('the Draft keeps a held message', attach.composer.draft(paneId), expect.objectContaining({ text: 'bravo', phase: expect.objectContaining({ kind: 'sending' }) }));
      attach.heldInput(paneId, 'send');
      await until('bravo in the Pane', () => screen().endsWith('bravo\nbravo'));
      await wait(700);
      check('a held Send shows once after Send', screen(), 'alpha\nalpha\nbravo\nbravo');
      check('nothing waits after the Send', attach.state().input, []);
      check('the Draft is empty after tmux confirms the held message', attach.composer.draft(paneId).text, '');

      const replayed = await pane.replayLate();
      process.stdout.write(`  (wrote ${replayed} lines of both links again)\n`);
      check('late copies of every paste line type nothing', screen(), 'alpha\nalpha\nbravo\nbravo');
      process.stdout.write(`  (tmux keeps ${tmux(['list-buffers']).split('\n').filter(Boolean).length} buffers)\n`);

      // The server stops with the Send on its way, and the Pane starts again during the break.
      pane.freeze();
      attach.composer.edit(paneId, 'charlie');
      await attach.composer.send(paneId);
      await wait(300);
      reopen = await pane.breakLink();
      tmux(['respawn-pane', '-k', '-t', paneId, 'cat']);
      reopen();
      await reaches(attach, 'connected');
      await until('a discarded notice', () => attach.state().input.length > 0);
      check('a message for a Pane that started again is discarded', attach.state().input, [
        expect.objectContaining({ kind: 'discarded', paneId, reason: 'pane-replaced', message: true }),
      ]);
      check('the Draft keeps a discarded message, and takes edits', attach.composer.draft(paneId), expect.objectContaining({
        text: 'charlie',
        phase: { kind: 'idle' },
        message: 'Not sent: the Pane was started again. The Draft is kept.',
      }));
      await wait(700);
      check('a discarded message is not in the Pane', screen(), '');

      await attach.close();
    }, 60000);

    it('sends a plain paste again after a break, and the Pane shows it once', async () => {
      ownServer();
      const pane = await catPane();
      const { attach, paneId, screen, tap } = pane;

      // A first paste, so the link has read the tmux version before the server stops.
      await attach.paste({ kind: 'text', text: 'one ' }, () => Promise.resolve(true));
      await until('the first paste in the Pane', () => screen() === 'one');

      pane.freeze();
      await attach.paste({ kind: 'text', text: 'two' }, () => Promise.resolve(true));
      await wait(300);
      const reopen = await pane.breakLink();
      reopen();
      await reaches(attach, 'connected');
      await until('the second paste in the Pane', () => screen() === 'one two');
      await wait(900);
      check('a plain paste is sent again without a question', attach.state().input, []);
      check('a plain paste sent again shows once', screen(), 'one two');

      // tmux takes the line of a paste, and the link dies before the reply.
      tap.deafFrom = "'if-shell'";
      await attach.paste({ kind: 'text', text: ' three' }, () => Promise.resolve(true));
      await until('the third paste in the Pane', () => screen() === 'one two three');
      const again = await pane.breakLink();
      again();
      await reaches(attach, 'connected');
      await wait(900);
      check('a paste whose reply was lost is confirmed, not sent again', screen(), 'one two three');
      check('nothing waits after the reconnect', attach.state().input, []);

      await pane.replayLate();
      check('late copies of every paste line type nothing', screen(), 'one two three');

      await attach.close();
    }, 60000);
  });

  describe('a clear, across a break', () => {
    it('clears after the keys that wait before it, once when its reply was lost, and leaves no Scrollback', async () => {
      ownServer();
      const pane = await catPane("PS1='$ ' bash --norc --noprofile");
      const { attach, paneId, screen, tap } = pane;
      const history = () => Number(tmux(['display-message', '-p', '-t', paneId, '#{history_size}']).trim());
      /** Output that fills the screen and the Scrollback, written by the shell and not by the app. */
      const fill = async () => {
        tmux(['send-keys', '-t', paneId, 'seq 1 60', 'Enter']);
        await until('lines in the Scrollback', () => history() > 0);
      };
      await until('the prompt', () => screen() === '$');
      await fill();

      // Keys typed during the break, then a clear: all held, and sent in order.
      let reopen = await pane.breakLink();
      attach.view(paneId).type(new TextEncoder().encode('echo kept\r'));
      attach.clearPane();
      reopen();
      await reaches(attach, 'connected');
      await until('a held notice', () => attach.state().input.length > 0);
      check('a clear typed during a break is held behind the keys before it', attach.state().input, [
        expect.objectContaining({ kind: 'held', paneId, preview: 'echo kept⏎Clear', reasons: ['risky-keys'] }),
      ]);
      attach.heldInput(paneId, 'send');
      await until('the cleared screen', () => screen() === '$');
      await wait(900);
      check('the clear ran after the command typed before it', screen(), '$');
      check('the Scrollback is empty after the clear', history(), 0);

      // tmux runs the clear line, and the link dies before the reply.
      await fill();
      tap.deafFrom = "'if-shell'";
      attach.clearPane();
      await until('the screen cleared again', () => screen() === '$' && history() === 0);
      reopen = await pane.breakLink();
      reopen();
      await reaches(attach, 'connected');
      await wait(900);
      check('a clear whose reply was lost is not held', attach.state().input, []);
      check('a clear whose reply was lost leaves no Scrollback', history(), 0);

      tmux(['send-keys', '-t', paneId, 'echo after', 'Enter']);
      await until('the output after the clear', () => screen().includes('\nafter'));
      const kept = screen();
      const replayed = await pane.replayLate();
      process.stdout.write(`  (wrote ${replayed} lines of both links again)\n`);
      check('late copies of every clear line clear nothing', screen(), kept);

      await attach.close();
    }, 60000);
  });
});
