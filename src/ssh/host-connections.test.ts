import { createTestClock } from '@/lib/test-clock';
import { HostProblem } from '@/ssh/failures';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host } from '@/storage/records';
import { reasonForConnectFailure } from '@/tmux/disconnect-reason';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';
import { INSTALL_TIMEOUT_MS, type HostCliState } from '@/topics/host-cli-install';
import { sendEnvironment } from '@/topics/host-write-request';
import type { TopicId } from '@/topics/environment';
import { newRequestId, WriteOutcomeUnknown } from '@/topics/request';

import {
  createHostConnections,
  EXEC_DEADLINE_MS,
  IDLE_MS,
  type Dialed,
} from './host-connections';

jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => { throw new Error('the tests give the Connections'); } }));

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
  /** Execs that have this text never answer. */
  silentOn?: string;
  /** The Connection breaks at an exec that has this text. */
  breaksOn?: string;
  /** What the library calls when its keepalive finds the Connection dead. */
  drop: () => void;
  /** The non-PTY channels opened on it: the Host CLI install's. */
  channels: FakeChannel[];
  /** The Host Server channels opened on it. */
  servers: FakeChannel[];
}

/** A non-PTY channel, which the test answers as the Host would. */
interface FakeChannel {
  command: string;
  closed: boolean;
  /** The frames the phone wrote on it, parsed. Only a Host Server channel keeps them. */
  frames: Record<string, unknown>[];
  print(text: string): void;
  exit(code?: number): void;
}

function setup(options: {
  verdict?: KeyVerdict;
  channels?: boolean;
  dialFails?: () => boolean;
  /** Each Connection starts with this `silentOn`. */
  silentOn?: string;
  /** Each Connection can run a Host Server, which says this `hello` once its channel opens. */
  serverHello?: string;
} = {}) {
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
      if (options.dialFails?.()) return Promise.reject(new Error('no route to the Host'));
      const link: FakeLink = {
        execs: [],
        connected: true,
        disconnected: false,
        silent: false,
        silentOn: options.silentOn,
        drop: () => {
          link.connected = false;
          for (const channel of [...link.channels, ...link.servers]) if (!channel.closed) channel.exit();
          dropped();
        },
        channels: [],
        servers: [],
      };
      links.push(link);
      const transport: TmuxTransport = {
        exec: (command) => {
          link.execs.push(command);
          if (link.silent || (link.silentOn && command.includes(link.silentOn))) return new Promise(() => {});
          if (link.breaksOn && command.includes(link.breaksOn)) link.connected = false;
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
          frames: [],
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
      const openServerChannel: Dialed['openServerChannel'] = (command, events) => {
        const channel: FakeChannel = {
          command,
          closed: false,
          frames: [],
          print: (text) => events.onData(new TextEncoder().encode(text).buffer as ArrayBuffer),
          exit: (code) => {
            if (channel.closed) return;
            channel.closed = true;
            events.onClosed(code);
          },
        };
        link.servers.push(channel);
        setTimeout(() => channel.print(`MUXIFY-PROTOCOL\n${options.serverHello}\n`), 0);
        return Promise.resolve({
          write: (bytes: Uint8Array) => {
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
              if (line !== '') channel.frames.push(JSON.parse(line) as Record<string, unknown>);
            }
          },
          close: () => {
            channel.closed = true;
            return Promise.resolve();
          },
        });
      };
      return Promise.resolve({
        transport,
        ...(options.channels ? { openChannel } : {}),
        ...(options.serverHello ? { openServerChannel } : {}),
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

  it('keeps a Connection open past the minute while a screen holds it, and starts the minute when it lets go', async () => {
    const { clock, links, connections } = setup();

    const release = await connections.hold(HOST);
    clock.advance(IDLE_MS * 3);
    await settle();
    expect(links).toHaveLength(1);
    expect(links[0]?.disconnected).toBe(false);

    release();
    release();
    clock.advance(IDLE_MS - 1);
    await settle();
    expect(links[0]?.disconnected).toBe(false);
    clock.advance(1);
    await settle();
    expect(links[0]?.disconnected).toBe(true);
  });

  it('closes, on return from the background, a Connection that only a screen holds', async () => {
    const { links, connections } = setup();
    await connections.hold(HOST);

    connections.lifecycleChanged('background');
    connections.lifecycleChanged('active');
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
    const failed = expect(read).rejects.toMatchObject({ reason: { kind: 'host-unreachable', detail: 'The Host did not answer in time.' } });
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await failed;

    expect(links).toHaveLength(2);
  });

  it('never sends again a write that has no Request id, and says that it may have reached the Host', async () => {
    const { clock, links, connections } = setup();
    await connections.read(HOST, ls);
    links[0]!.silent = true;

    const write = connections.write(HOST, (transport) => transport.exec('muxify topic new'));
    const failed = expect(write).rejects.toMatchObject({ name: 'WriteOutcomeUnknown', resent: false });
    await settle();
    clock.advance(EXEC_DEADLINE_MS);
    await failed;

    expect(links).toHaveLength(1);
    expect(links[0]?.execs.filter((command) => command === 'muxify topic new')).toHaveLength(1);
  });

  it('fails a write with the error of the dial when no Connection opens, because nothing went out', async () => {
    const { connections } = setup({ dialFails: () => true });

    const write = connections.write(HOST, (transport) => transport.exec('muxify topic new'));

    await expect(write).rejects.toThrow('no route to the Host');
    await expect(write).rejects.not.toBeInstanceOf(WriteOutcomeUnknown);
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

    await expect(read).rejects.toMatchObject({ reason: { kind: 'host-key' } });
    await settle();
    expect(links[0]?.disconnected).toBe(true);
    expect(links[0]?.execs).toEqual([]);
  });
});

describe('the Host CLI install', () => {
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

  it('waits for a changed Host key to be accepted, and never runs on a refused one', async () => {
    const { links, connections } = setup({ channels: true, verdict: { kind: 'changed', stored: 'SHA256:old' } });

    await expect(connections.read(HOST, ls, { onHostKey: () => false })).rejects.toMatchObject({ reason: { kind: 'host-key' } });
    expect(links[0]?.channels).toHaveLength(0);

    await connections.read(HOST, ls, { onHostKey: () => true });
    expect(links[1]?.channels).toHaveLength(1);
  });
});

describe('the Host Problem', () => {
  it('is the reason a read could not reach the Host, until a read reaches it', async () => {
    let down = true;
    const { connections } = setup({ dialFails: () => down });
    const heard: string[] = [];
    connections.subscribeProblem((hostId) => heard.push(hostId));

    const failed = await connections.read(HOST, ls).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(HostProblem);
    expect(connections.problem(HOST.id)).toEqual({ kind: 'host-unreachable', detail: 'no route to the Host' });
    down = false;
    await connections.read(HOST, ls);
    expect(connections.problem(HOST.id)).toBeNull();
    expect(heard).toEqual([HOST.id, HOST.id]);
  });

  it('is told once when two readers meet the same fault', async () => {
    const { connections } = setup({ dialFails: () => true });
    const heard: string[] = [];
    connections.subscribeProblem((hostId) => heard.push(hostId));

    await Promise.all([connections.read(HOST, ls).catch(() => {}), connections.read(HOST, ls).catch(() => {})]);

    expect(heard).toEqual([HOST.id]);
  });

  it('keeps the kind of the fault, so the Attach can tell a refused sign-in from an unreachable Host', async () => {
    const { connections } = setup({ dialFails: () => true });
    const refused = Object.assign(new Error('auth'), { code: 'AUTH_FAILED' });
    const auth = createHostConnections({
      dial: () => Promise.reject(refused),
      store: { rememberFingerprint: () => Promise.resolve() },
    });

    const failed = await auth.openConnection(HOST).catch((error: unknown) => error);

    expect(reasonForConnectFailure(failed).kind).toBe('authentication');
    expect(auth.problem(HOST.id)?.kind).toBe('authentication');
    expect(connections.problem(HOST.id)).toBeNull();
  });

  it('clears when the Host answers, even when it refuses the command', async () => {
    let down = true;
    const { connections } = setup({ dialFails: () => down });
    await connections.read(HOST, ls).catch(() => {});
    down = false;

    await connections.read(HOST, () => Promise.reject(new Error('tmux refused'))).catch(() => {});

    expect(connections.problem(HOST.id)).toBeNull();
  });
});


describe('the Host Server', () => {
  const CAPABLE =
    '{"hello":{"build":"muxify 7593671 1794697369","capabilities":["request","snapshot","topic-detail","ranked-session-paths","browser-tabs"],"protocol":1},"id":0,"kind":"hello"}';
  const BARE = '{"hello":{"build":"muxify 1a2b3c4 1763100000","capabilities":[],"protocol":1},"id":0,"kind":"hello"}';

  it('starts when the Connection opens, with the probed muxify, and the Log names its build', async () => {
    const { links, logged, connections } = setup({ serverHello: CAPABLE });

    await connections.read(HOST, ls);
    await settle();
    await settle();

    expect(links[0]?.servers.map((channel) => channel.command)).toEqual(["'/usr/local/bin/muxify' server"]);
    expect(connections.hostServer(HOST.id)?.state()).toEqual({
      kind: 'live',
      build: 'muxify 7593671 1794697369',
      protocol: 1,
    });
    expect(logged).toContain('connections: Mac: Host Server: muxify 7593671 1794697369, protocol 1');
  });

  it('finds `muxify` once for each Connection', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });

    await connections.read(HOST, ls);
    await connections.read(HOST, ls);
    await settle();
    await settle();

    expect(links[0]?.execs.filter((command) => command === 'command -v muxify')).toHaveLength(1);
  });

  it('finds `muxify` again and starts on it after the install answers `installed` or `updated`', async () => {
    for (const line of ['installed abc 1', 'updated abc 1 -> def 2']) {
      const { links, connections } = setup({ channels: true, serverHello: CAPABLE });
      await connections.read(HOST, ls);
      await settle();
      await settle();
      const probes = () => links[0]?.execs.filter((command) => command === 'command -v muxify');
      expect(probes()).toHaveLength(1);

      links[0]!.channels[0]!.print(`${line}\n`);
      await settle();
      await settle();
      await settle();

      expect(probes()).toHaveLength(2);
      expect(links[0]?.servers).toHaveLength(2);
    }
  });

  it('keeps the found path after the install answers `current`', async () => {
    const { links, connections } = setup({ channels: true, serverHello: CAPABLE });
    await connections.read(HOST, ls);
    await settle();
    await settle();

    links[0]!.channels[0]!.print('current abc 1\n');
    await settle();
    await settle();

    expect(links[0]?.execs.filter((command) => command === 'command -v muxify')).toHaveLength(1);
    expect(links[0]?.servers).toHaveLength(1);
  });

  it('names the Sessions-only reason in the Log', async () => {
    const { logged, connections } = setup({ serverHello: BARE });

    await connections.read(HOST, ls);
    await settle();
    await settle();

    expect(connections.hostServer(HOST.id)?.state()).toMatchObject({ kind: 'sessions-only' });
    expect(logged).toContain(
      "connections: Mac: Host Server: Sessions only: the Host's muxify is too old (muxify 1a2b3c4 1763100000)",
    );
  });

  it('gives the Listing of the Host’s latest Connection, and says when it changes', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });
    const heard: string[] = [];
    connections.subscribeListing((hostId) => heard.push(hostId));
    expect(connections.listing(HOST.id)).toBeNull();

    await connections.hold(HOST);
    await settle();
    await settle();
    expect(connections.listing(HOST.id)).toEqual({
      server: { kind: 'live', build: 'muxify 7593671 1794697369', protocol: 1 },
      snapshot: null,
    });
    expect(heard).toContain(HOST.id);

    links[0]!.drop();
    expect(connections.listing(HOST.id)?.server).toEqual({ kind: 'closed' });
    await connections.hold(HOST);
    await settle();
    await settle();
    expect(connections.listing(HOST.id)?.server.kind).toBe('live');
  });

  it('closes with its Connection, and a new Connection starts a new one', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });
    await connections.read(HOST, ls);
    await settle();
    const first = connections.hostServer(HOST.id);

    links[0]!.drop();
    await connections.read(HOST, ls);
    await settle();

    expect(first?.state()).toEqual({ kind: 'closed' });
    expect(links[0]?.servers[0]?.closed).toBe(true);
    expect(links[1]?.servers).toHaveLength(1);
    expect(connections.hostServer(HOST.id)).not.toBe(first);
  });
  /** The requests the phone wrote on a Host Server channel, but for the Listing's subscription. */
  const requests = (channel: FakeChannel | undefined) =>
    channel?.frames.filter((frame) => frame.kind === 'request' && !('subscribe' in (frame.request as object))) ?? [];
  /** The Host Server answers a request with this `ok`. */
  const answer = (channel: FakeChannel, id: unknown, ok: unknown) => channel.print(`${JSON.stringify({ end: { ok }, id, kind: 'end' })}\n`);
  const RENAME = { command: { rename: { title: 'Fix login' } }, topic: 't1' as TopicId, request: newRequestId() };
  const RENAMED = { environment: { version: 2, command: { rename: { title: 'Fix login' } }, target: { topic: { id: 't1' } }, request: RENAME.request } };

  it('runs a request on the Host Server of the Connection, and holds the Connection while it runs', async () => {
    const { clock, links, connections } = setup({ serverHello: CAPABLE });

    const asked = connections.onServer(HOST, (server) => server.request({ ping: {} }));
    await settle();
    await settle();
    const [ping] = requests(links[0]!.servers[0]);
    expect(ping).toMatchObject({ request: { ping: {} } });
    clock.advance(IDLE_MS);
    expect(links[0]?.disconnected).toBe(false);

    answer(links[0]!.servers[0]!, ping!.id, {});
    await expect(asked).resolves.toEqual({});
  });

  it('sends a write whose Connection broke before its end once more, with the same id, to the Host Server of a new Connection', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });
    await connections.hold(HOST);
    await settle();
    await settle();

    const write = sendEnvironment(HOST, RENAME, () => {}, connections);
    await settle();
    expect(requests(links[0]!.servers[0]).map((frame) => frame.request)).toEqual([RENAMED]);

    links[0]!.drop();
    await settle();
    await settle();
    await settle();
    const [again] = requests(links[1]?.servers[0]);
    expect(again?.request).toEqual(RENAMED);
    answer(links[1]!.servers[0]!, again!.id, { changed: { topic_id: 't1' } });

    await expect(write).resolves.toEqual({ kind: 'answered', answer: { changed: { topic_id: 't1' } } });
    expect(links).toHaveLength(2);
  });

  it('sends a write whose Host Server stopped before its end once more, with the same id, to the one that starts again on the Connection', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });
    await connections.hold(HOST);
    await settle();
    await settle();

    const write = sendEnvironment(HOST, RENAME, () => {}, connections);
    await settle();
    links[0]!.servers[0]!.exit(1);
    await settle();
    await settle();
    await settle();
    const [again] = requests(links[0]!.servers[1]);
    expect(again?.request).toEqual(RENAMED);
    answer(links[0]!.servers[1]!, again!.id, { changed: { topic_id: 't1' } });

    await expect(write).resolves.toMatchObject({ kind: 'answered' });
    expect(links).toHaveLength(1);
  });

  it('is unsure when the next Host Server does not answer either', async () => {
    const { links, connections } = setup({ serverHello: CAPABLE });
    await connections.hold(HOST);
    await settle();
    await settle();

    const write = sendEnvironment(HOST, RENAME, () => {}, connections);
    const unsure = expect(write).rejects.toMatchObject({ name: 'WriteOutcomeUnknown', resent: true });
    await settle();
    links[0]!.servers[0]!.exit(1);
    await settle();
    await settle();
    await settle();
    links[0]!.servers[1]!.exit(1);
    await unsure;
    expect(requests(links[0]!.servers[1]).map((frame) => frame.request)).toEqual([RENAMED]);
    expect(links[0]!.servers).toHaveLength(3);
    expect(requests(links[0]!.servers[2])).toEqual([]);
  });

  it('fails before anything goes out when the Host has Sessions only', async () => {
    const { links, connections } = setup({ serverHello: BARE });
    await connections.hold(HOST);
    await settle();
    await settle();
    const use = jest.fn();

    await expect(connections.onServer(HOST, use)).rejects.toEqual(
      new Error("Topics are unavailable on Mac: the Host's muxify is too old (muxify 1a2b3c4 1763100000)."),
    );
    expect(use).not.toHaveBeenCalled();
    expect(requests(links[0]!.servers[0])).toEqual([]);
  });
});
