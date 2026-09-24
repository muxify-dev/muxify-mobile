/**
 * The control-mode path, against a real tmux on this machine.
 *
 * Not part of `pnpm test`, which is hermetic. This one spawns `tmux -C attach`
 * on a throwaway socket and drives the actual Control Connection, Client,
 * Topology and Pane view through it:
 *
 *   pnpm e2e:control
 *
 * It exists because the expensive mistakes in this migration are the ones no
 * fixture can catch — a command tmux parses differently from how it was meant,
 * a reply correlated to the wrong caller, an option set without anyone
 * noticing. Everything here was measured against tmux 3.7c before it was
 * written; this is what keeps it measured.
 *
 * The transport below stands in for SSH by piping to a local process. That is
 * the one thing it does not prove: whether bytes reach a phone. `e2e/*.ad` and
 * `e2e/regressions.sh` cover that half by driving the app on a simulator.
 */
import { execFileSync, spawn } from 'child_process';

import { openControlConnection } from '@/tmux/control-connection';
import { createPaneView } from '@/tmux/pane-view';
import { TmuxClient } from '@/tmux/tmux-client';
import { createTopologyStore } from '@/tmux/topology';
import type { ControlChannel, ControlChannelEvents, TmuxTransport } from '@/tmux/transport';

/** A socket of this app's own, so nothing here can touch a real Session. */
const SOCKET = 'muxify-control-mode-e2e';
const SESSION = 'e2e';

function tmux(args: string[]): string {
  // stderr piped rather than inherited: killing a server that is not there is
  // the normal case, and its complaint is not this check's output.
  return execFileSync('tmux', ['-L', SOCKET, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The transport seam, over a local tmux instead of an SSH Connection.
 *
 * The command it is handed is the shell line that would reach a Host, so the
 * only liberty taken is pointing it at the throwaway socket.
 */
function localTransport(): TmuxTransport {
  return {
    exec: () => Promise.reject(new Error('not used by this check')),
    async openControl(command: string, events: ControlChannelEvents): Promise<ControlChannel> {
      const child = spawn('/bin/sh', [
        '-c',
        command.replace(/^tmux /, `tmux -L ${SOCKET} `),
      ]);
      const forward = (chunk: Buffer) =>
        events.onData(
          chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
        );
      child.stdout.on('data', forward);
      child.stderr.on('data', forward);
      child.on('close', () => events.onClosed(undefined));
      return {
        write: (bytes) => child.stdin.write(Buffer.from(bytes)),
        close: async () => {
          child.kill();
        },
      };
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (lines: Uint8Array[]) =>
  lines.map((line) => Buffer.from(line).toString('utf8')).join('\n');

describe('the control-mode path, against a real tmux', () => {
  beforeAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // No server to kill, which is the usual case.
    }
    tmux(['new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24']);
  });

  afterAll(() => {
    try {
      tmux(['kill-server']);
    } catch {
      // Already gone.
    }
  });

  it('attaches, reads, sizes, types and scrolls, and borrows nothing', async () => {
    // Every later reading is compared against this.
    const before = tmux(['show-options', '-t', SESSION]);

    const painted: Uint8Array[] = [];
    const connection = await openControlConnection(
      localTransport(),
      { sessionName: SESSION },
      { onOutput: () => {}, onNotification: () => {}, onClosed: () => {} },
    );
    const client = new TmuxClient(connection);

    // Reading, down the same channel the Pane's output comes up.
    expect((await client.listSessions()).map((each) => each.name)).toContain(SESSION);

    const store = createTopologyStore(client);
    const topology = await store.refresh(SESSION);
    expect(topology.activeWindow?.id).toMatch(/^@\d+$/);
    expect(topology.activePane?.id).toMatch(/^%\d+$/);
    const paneId = topology.activePane?.id as string;
    const windowIndex = topology.activeWindow?.index as number;

    // Sizing: `refresh-client -C` moves the Window, and nothing else does.
    await client.resizeClient({ cols: 40, rows: 20 });
    await wait(300);
    expect(
      tmux(['display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}']),
    ).toContain('40x20');

    // The resync paints what is already on the Pane, before anything streams.
    const view = createPaneView(client, {
      write: (bytes) => painted.push(bytes),
      onScroll: () => {},
    });
    await view.show(paneId, 20);
    expect(painted.length).toBeGreaterThan(0);

    // Typing reaches the Pane, through send-keys and no PTY.
    view.type(new TextEncoder().encode('echo LIVE_CHECK_OK\r'));
    await wait(900);
    expect(text(await client.capturePane(paneId))).toContain('LIVE_CHECK_OK');

    // Every Meta key, by tmux's name for it, into a `cat -v` that prints back
    // exactly what arrived. This is the half that cannot be driven from the
    // device: a SwiftUI menu's cells report no usable frame, so automation
    // taps the panel rather than the row it asked for.
    view.type(new TextEncoder().encode('cat -v\r'));
    await wait(700);
    for (const key of ['Escape', 'Tab', 'Up', 'Down', 'Left', 'Right', 'Home', 'M-b']) {
      view.press(key);
      await wait(120);
    }
    await wait(600);
    const arrived = text(await client.capturePane(paneId));
    // What a terminal sends for each, with the Pane in its ordinary cursor
    // mode: an application that turns DECCKM on gets `ESC O A` for Up instead,
    // which is the whole reason the name is sent rather than the bytes.
    // Tab arrives as a real tab: `cat -v` escapes the non-printing characters
    // but leaves that one alone.
    expect(arrived).toContain('^[\t^[[A^[[B^[[D^[[C^[[1~^[b');
    view.press('C-c');
    await wait(500);
    expect(tmux(['display-message', '-p', '-t', paneId, '#{pane_current_command}']).trim()).not.toBe(
      'cat',
    );

    // A batch: one write, one reply each, and one of them failing takes
    // nothing with it.
    const previews = await client.capturePanes([`${SESSION}:${windowIndex}`, `${SESSION}:9999`]);
    expect(previews.has(`${SESSION}:${windowIndex}`)).toBe(true);
    expect(previews.has(`${SESSION}:9999`)).toBe(false);

    // A refused command is an answer, not a dead Connection.
    const refused = await connection.run(['select-window', '-t', `${SESSION}:404`]);
    expect(refused.ok).toBe(false);
    expect((await client.listSessions()).length).toBeGreaterThan(0);

    // A Session name a shell would have mangled, through tmux's own quoting.
    await client.createSession("it's $HOME");
    await wait(200);
    expect((await client.listSessions()).map((each) => each.name)).toContain("it's $HOME");

    // Scrollback comes from a capture. tmux's copy-mode is never entered.
    view.type(new TextEncoder().encode('seq 1 200\r'));
    await wait(1200);
    painted.length = 0;
    view.scroll(6, { cols: 40, rows: 20 });
    await wait(600);
    expect(Buffer.concat(painted.map((each) => Buffer.from(each))).toString('utf8')).toMatch(/\d/);
    expect(tmux(['display-message', '-p', '-t', paneId, '#{pane_in_mode}']).trim()).toBe('0');

    // The whole point: nothing was set, and there is nothing to put back.
    expect(tmux(['show-options', '-t', SESSION])).toBe(before);
    expect(tmux(['show-hooks', '-t', SESSION]).trim()).toBe('');

    await connection.close();
    await wait(300);
    expect(tmux(['show-options', '-t', SESSION])).toBe(before);
  }, 30000);
});
