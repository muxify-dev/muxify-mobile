import { createTestClock } from '@/lib/test-clock';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host } from '@/storage/records';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

import {
  createHostConnections,
  EXEC_DEADLINE_MS,
  ExecDeadlineError,
  IDLE_MS,
  type Dialed,
} from './host-connections';

const HOST: Host = {
  id: 'h1',
  displayName: 'Mac',
  address: '10.0.0.1',
  port: 22,
  identityId: 'i1',
};

const OK: TmuxExecResult = { stdout: '', stderr: '', exitCode: 0 };

/** An SSH Connection that answers every exec, until the test says otherwise. */
interface FakeLink {
  execs: string[];
  connected: boolean;
  disconnected: boolean;
  /** Execs from now on never answer. */
  silent: boolean;
  /** What the library calls when its keepalive finds the Connection dead. */
  drop: () => void;
}

function setup(options: { verdict?: KeyVerdict } = {}) {
  const clock = createTestClock();
  const links: FakeLink[] = [];
  const remembered: string[] = [];
  const connections = createHostConnections({
    clock,
    store: {
      rememberFingerprint: (_hostId: string, fingerprint: string) => {
        remembered.push(fingerprint);
        return Promise.resolve();
      },
    },
    dial: (_host, dropped): Promise<Dialed> => {
      const link: FakeLink = {
        execs: [],
        connected: true,
        disconnected: false,
        silent: false,
        drop: () => {
          link.connected = false;
          dropped();
        },
      };
      links.push(link);
      const transport: TmuxTransport = {
        exec: (command) => {
          link.execs.push(command);
          if (link.silent) return new Promise(() => {});
          if (!link.connected) return Promise.reject(new Error('channel closed'));
          if (command === 'command -v muxify') {
            return Promise.resolve({ ...OK, stdout: '/usr/local/bin/muxify\n' });
          }
          return Promise.resolve(OK);
        },
        openControl: () => Promise.reject(new Error('not in these tests')),
      };
      return Promise.resolve({
        transport,
        fingerprint: `SHA256:${links.length}`,
        verdict: options.verdict ?? { kind: 'first-sight' },
        isConnected: () => link.connected,
        disconnect: () => {
          link.connected = false;
          link.disconnected = true;
          return Promise.resolve();
        },
      });
    },
  });
  return { clock, links, remembered, connections };
}

/** Lets every promise that can settle, settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const ls = (transport: TmuxTransport) => transport.exec('tmux ls');

describe('the app’s Connections', () => {
  it('runs two reads on one Connection', async () => {
    const { links, connections } = setup();

    await connections.read(HOST, ls);
    await connections.read(HOST, ls);

    expect(links).toHaveLength(1);
    expect(links[0]?.execs).toEqual(['tmux ls', 'tmux ls']);
  });

  it('opens the Connection once for reads that start together', async () => {
    const { links, connections } = setup();

    await Promise.all([connections.read(HOST, ls), connections.read(HOST, ls)]);

    expect(links).toHaveLength(1);
  });

  it('gives the Attach and a screen the same Connection', async () => {
    const { links, connections } = setup();

    const attach = await connections.openConnection(HOST);
    await connections.read(HOST, ls);
    await attach.transport.exec('tmux display-message');

    expect(links).toHaveLength(1);
  });

  it('finds `muxify` once for each Connection', async () => {
    const { links, connections } = setup();

    await connections.read(HOST, (transport, muxify) => muxify.read((command) => transport.exec(command)));
    await connections.read(HOST, (transport, muxify) => muxify.read((command) => transport.exec(command)));

    expect(links[0]?.execs.filter((command) => command === 'command -v muxify')).toHaveLength(1);
  });

  it('remembers a Host key seen for the first time', async () => {
    const { remembered, connections } = setup();

    await connections.read(HOST, ls);

    expect(remembered).toEqual(['SHA256:1']);
  });

  it('closes a Connection that no screen has used for a minute', async () => {
    const { clock, links, connections } = setup();

    await connections.read(HOST, ls);
    clock.advance(IDLE_MS - 1);
    expect(links[0]?.disconnected).toBe(false);
    clock.advance(1);
    await settle();
    expect(links[0]?.disconnected).toBe(true);

    await connections.read(HOST, ls);
    expect(links).toHaveLength(2);
  });

  it('keeps a Connection open while the Attach holds it, and starts the minute when it lets go', async () => {
    const { clock, links, connections } = setup();

    const attach = await connections.openConnection(HOST);
    await connections.read(HOST, ls);
    clock.advance(IDLE_MS * 3);
    await settle();
    expect(links[0]?.disconnected).toBe(false);

    await attach.close();
    expect(links[0]?.disconnected).toBe(false);
    clock.advance(IDLE_MS);
    await settle();
    expect(links[0]?.disconnected).toBe(true);
  });

  it('reads once more on a new Connection when an exec passes its deadline', async () => {
    const { clock, links, connections } = setup();
    await connections.read(HOST, ls);
    links[0]!.silent = true;

    const read = connections.read(HOST, ls);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await read;

    expect(links).toHaveLength(2);
    expect(links[0]?.disconnected).toBe(true);
    expect(links[1]?.execs).toEqual(['tmux ls']);
  });

  it('reads only once more, and then gives the deadline', async () => {
    const { clock, links, connections } = setup();
    await connections.read(HOST, ls);
    links[0]!.silent = true;

    const read = connections.read(HOST, (transport) => {
      links.forEach((link) => (link.silent = true));
      return ls(transport);
    });
    const failed = expect(read).rejects.toBeInstanceOf(ExecDeadlineError);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await failed;

    expect(links).toHaveLength(2);
  });

  it('never sends a write again', async () => {
    const { clock, links, connections } = setup();
    await connections.read(HOST, ls);
    links[0]!.silent = true;

    const write = connections.write(HOST, (transport) => transport.exec('muxify topic new'));
    const failed = expect(write).rejects.toBeInstanceOf(ExecDeadlineError);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await failed;

    expect(links).toHaveLength(1);
    expect(links[0]?.execs.filter((command) => command === 'muxify topic new')).toHaveLength(1);
  });

  it('asks the Attach, and does not close its Connection, when an exec passes its deadline', async () => {
    const { clock, links, connections } = setup();
    const attach = await connections.openConnection(HOST);
    let asked = 0;
    attach.suspected?.(() => {
      asked += 1;
      links[0]!.silent = false;
    });
    links[0]!.silent = true;

    const read = connections.read(HOST, ls);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await read;

    expect(asked).toBe(1);
    expect(links).toHaveLength(1);
    expect(links[0]?.disconnected).toBe(false);
  });

  it('connects again after the keepalive finds the Connection dead', async () => {
    const { links, connections } = setup();
    await connections.read(HOST, ls);

    links[0]!.drop();
    await connections.read(HOST, ls);

    expect(links).toHaveLength(2);
    expect(links[0]?.disconnected).toBe(true);
  });

  it('gives the screens the new Connection once the Attach replaces its own', async () => {
    const { links, connections } = setup();
    const first = await connections.openConnection(HOST);
    links[0]!.connected = false;

    await first.discard?.();
    await connections.openConnection(HOST);
    await connections.read(HOST, ls);

    expect(links).toHaveLength(2);
    expect(links[0]?.disconnected).toBe(true);
    expect(links[1]?.execs).toEqual(['tmux ls']);
  });

  it('closes, on return from the background, a Connection no Attach holds', async () => {
    const { links, connections } = setup();
    await connections.read(HOST, ls);
    const other = { ...HOST, id: 'h2' };
    await connections.openConnection(other);

    connections.lifecycleChanged('background');
    connections.lifecycleChanged('active');
    await settle();

    expect(links[0]?.disconnected).toBe(true);
    expect(links[1]?.disconnected).toBe(false);
  });

  it('closes the Connection when the caller refuses its Host key', async () => {
    const { links, connections } = setup({ verdict: { kind: 'changed', stored: 'SHA256:old' } });

    const read = connections.read(HOST, ls, { onHostKey: () => false });

    await expect(read).rejects.toMatchObject({ code: 'HOST_KEY_REJECTED' });
    await settle();
    expect(links[0]?.disconnected).toBe(true);
    expect(links[0]?.execs).toEqual([]);
  });
});
