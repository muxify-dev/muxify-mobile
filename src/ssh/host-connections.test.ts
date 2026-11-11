import { createTestClock } from '@/lib/test-clock';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host } from '@/storage/records';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';
import { INSTALL_TIMEOUT_MS, type HostCliState } from '@/topics/host-cli-install';
import type { TopicsRead } from '@/topics/host-topics';

import {
  createHostConnections,
  EXEC_DEADLINE_MS,
  ExecDeadlineError,
  IDLE_MS,
  type Dialed,
  type ScreenUse,
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
  /** The non-PTY channels opened on it: the Host CLI install's. */
  channels: FakeChannel[];
}

/** A non-PTY channel, which the test answers as the Host would. */
interface FakeChannel {
  command: string;
  closed: boolean;
  print(text: string): void;
  exit(code?: number): void;
}

function setup(options: { verdict?: KeyVerdict; channels?: boolean } = {}) {
  const clock = createTestClock();
  const links: FakeLink[] = [];
  const remembered: string[] = [];
  const logged: string[] = [];
  const connections = createHostConnections({
    clock,
    log: { record: (tag, text) => logged.push(`${tag}: ${text}`) },
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
          for (const channel of link.channels) if (!channel.closed) channel.exit();
          dropped();
        },
        channels: [],
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
      const openChannel: Dialed['openChannel'] = (command, events) => {
        const channel: FakeChannel = {
          command,
          closed: false,
          print: (text) => events.onData(new TextEncoder().encode(text).buffer as ArrayBuffer),
          exit: (code) => {
            channel.closed = true;
            events.onClosed(code);
          },
        };
        link.channels.push(channel);
        return Promise.resolve({
          close: () => {
            channel.closed = true;
            return Promise.resolve();
          },
        });
      };
      return Promise.resolve({
        transport,
        ...(options.channels ? { openChannel } : {}),
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
  return { clock, links, remembered, logged, connections };
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

describe('the Host CLI install', () => {
  const readTopics: ScreenUse<TopicsRead> = (transport, muxify) =>
    muxify.read((command) => transport.exec(command));

  it('starts once when the Connection opens, on a channel of its own', async () => {
    const { links, connections } = setup({ channels: true });

    await connections.read(HOST, ls);
    await connections.read(HOST, ls);
    await connections.openConnection(HOST);

    expect(links).toHaveLength(1);
    expect(links[0]?.channels).toHaveLength(1);
    expect(links[0]?.channels[0]?.command).toContain('install.sh');
    expect(links[0]?.execs).toEqual(['tmux ls', 'tmux ls']);
    expect(connections.hostCli(HOST.id)).toEqual({ kind: 'running' });
  });

  it('does not make a screen read wait for it', async () => {
    const { links, connections } = setup({ channels: true });

    await connections.read(HOST, ls);

    expect(links[0]?.channels[0]?.closed).toBe(false);
    expect(links[0]?.execs).toEqual(['tmux ls']);
  });

  it('writes its line to the Log, and says it to whoever listens', async () => {
    const { links, logged, connections } = setup({ channels: true });
    const heard: [string, HostCliState][] = [];
    connections.subscribeHostCli((hostId, state) => heard.push([hostId, state]));

    await connections.read(HOST, ls);
    links[0]!.channels[0]!.print('current abc1234 1700000000\n');
    await settle();

    expect(logged).toContain('connections: Mac: Host CLI: current abc1234 1700000000');
    const done: HostCliState = {
      kind: 'done',
      result: { kind: 'current', text: 'abc1234 1700000000', line: 'current abc1234 1700000000' },
    };
    expect(heard).toEqual([['h1', { kind: 'running' }], ['h1', done]]);
    expect(connections.hostCli(HOST.id)).toEqual(done);
  });

  it('runs again on a new Connection after a drop', async () => {
    const { links, logged, connections } = setup({ channels: true });
    await connections.read(HOST, ls);
    links[0]!.channels[0]!.print('current abc 1\n');
    await settle();

    links[0]!.drop();
    await connections.read(HOST, ls);

    expect(links).toHaveLength(2);
    expect(links[1]?.channels).toHaveLength(1);
    expect(connections.hostCli(HOST.id)).toEqual({ kind: 'running' });
    links[1]!.channels[0]!.print('current abc 1\n');
    await settle();
    expect(logged.filter((line) => line.includes('Host CLI:'))).toHaveLength(2);
  });

  it('keeps an old Connection’s install from speaking over the new one’s', async () => {
    const { links, connections } = setup({ channels: true });
    await connections.read(HOST, ls);

    links[0]!.drop();
    await connections.read(HOST, ls);
    await settle();

    expect(connections.hostCli(HOST.id)).toEqual({ kind: 'running' });
  });

  it('leaves the Connection up when it fails', async () => {
    const { links, logged, connections } = setup({ channels: true });
    await connections.read(HOST, ls);

    links[0]!.channels[0]!.print('failed: neither curl nor wget\n');
    await settle();
    await connections.read(HOST, ls);

    expect(logged).toContain('connections: Mac: Host CLI: failed: neither curl nor wget');
    expect(links).toHaveLength(1);
    expect(links[0]?.disconnected).toBe(false);
  });

  it('leaves the Connection and the Attach alone when it times out', async () => {
    const { clock, links, logged, connections } = setup({ channels: true });
    const attach = await connections.openConnection(HOST);
    const suspected = jest.fn();
    attach.suspected?.(suspected);
    await settle();

    clock.advance(INSTALL_TIMEOUT_MS);
    await settle();
    await connections.read(HOST, ls);

    expect(logged).toContain('connections: Mac: Host CLI: failed: no answer in 3 minutes');
    expect(links[0]?.channels[0]?.closed).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0]?.disconnected).toBe(false);
    expect(suspected).not.toHaveBeenCalled();
  });

  it('keeps the Connection open while it runs, and starts the idle minute when it ends', async () => {
    const { clock, links, connections } = setup({ channels: true });
    await connections.read(HOST, ls);

    clock.advance(IDLE_MS * 2);
    await settle();
    expect(links[0]?.disconnected).toBe(false);

    links[0]!.channels[0]!.print('current abc 1\n');
    await settle();
    clock.advance(IDLE_MS);
    await settle();
    expect(links[0]?.disconnected).toBe(true);
  });

  it('makes the Topics module probe again on its next read after `installed` or `updated`', async () => {
    for (const line of ['installed abc 1', 'updated abc 1 -> def 2']) {
      const { links, connections } = setup({ channels: true });
      await connections.read(HOST, readTopics);
      await connections.read(HOST, readTopics);
      const probes = () => links[0]?.execs.filter((command) => command === 'command -v muxify');
      expect(probes()).toHaveLength(1);

      links[0]!.channels[0]!.print(`${line}\n`);
      await settle();
      await connections.read(HOST, readTopics);

      expect(probes()).toHaveLength(2);
    }
  });

  it('keeps the found path after `current`', async () => {
    const { links, connections } = setup({ channels: true });
    await connections.read(HOST, readTopics);

    links[0]!.channels[0]!.print('current abc 1\n');
    await settle();
    await connections.read(HOST, readTopics);

    expect(links[0]?.execs.filter((command) => command === 'command -v muxify')).toHaveLength(1);
  });

  it('waits for a changed Host key to be accepted, and never runs on a refused one', async () => {
    const { links, connections } = setup({ channels: true, verdict: { kind: 'changed', stored: 'SHA256:old' } });

    await expect(connections.read(HOST, ls, { onHostKey: () => false })).rejects.toMatchObject({
      code: 'HOST_KEY_REJECTED',
    });
    expect(links[0]?.channels).toHaveLength(0);

    await connections.read(HOST, ls, { onHostKey: () => true });
    expect(links[1]?.channels).toHaveLength(1);
  });
});
