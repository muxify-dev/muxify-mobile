/**
 * The Host Server link, against a real `muxify server`.
 *
 * Not part of `pnpm test`, which is hermetic:
 *
 *   pnpm e2e:host-server
 *
 * It runs the Host CLI that `(cd ../muxify-shell && make host-cli)` builds, or
 * the one MUXIFY_HOST_CLI names, as the link would over SSH: one exec channel,
 * here a child shell whose stdin, stdout and stderr are the channel's. It
 * checks the handshake, a `ping`, the snapshot subscription's first item, a
 * clean close, and the requests the phone sends: Host Writes, Go to, Browser
 * Tabs and Attachment uploads.
 *
 * Every command runs against a Muxify of its own: its Topic records, its Config
 * and its tmux server live in a temp folder, which is removed afterwards, the
 * way e2e/sandbox.sh does it.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { browserTabsOn } from '@/browser/read-browser-tabs';
import { attachmentUpload, CHUNK_BYTES } from '@/composer/host-upload';
import type { AttachmentFile, Upload } from '@/composer/types';
import { createHostServer, HostServerError, type HostServer, type HostServerState, type OpenServerChannel } from '@/ssh/host-server';
import type { Host } from '@/storage/records';
import { shellQuote } from '@/tmux/commands';
import type { TopicId } from '@/topics/environment';
import { rankedSessionPaths, topicSessionPaths } from '@/topics/host-session-paths';
import { environmentRequest, firstPush, sendEnvironment, type EnvironmentCommand, type ServerConnections } from '@/topics/host-write-request';
import {
  actionCommand,
  addSessionCommand,
  changeCommand,
  createCommand,
  dropCommand,
  newSessionCommand,
  settleCommand,
  wakeCommand,
} from '@/topics/host-writes';
import { newRequestId, REQUEST_MISMATCH_ERROR } from '@/topics/request';

jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => { throw new Error('this suite gives its own Connections'); } }));

const MUXIFY =
  process.env.MUXIFY_HOST_CLI ??
  resolve(__dirname, '..', '..', 'muxify-shell', 'build', 'host-cli', `muxify-darwin-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`);

// /tmp, not os.tmpdir(): a tmux socket path must stay under 104 bytes.
const root = realpathSync(mkdtempSync('/tmp/muxify-e2e-host-server.'));
const { TMUX: _tmux, TMUX_PANE: _pane, ...inherited } = process.env;
const env = {
  ...inherited,
  MUXIFY_CONFIG: join(root, 'config.yaml'),
  XDG_STATE_HOME: join(root, 'state'),
  TMUX_TMPDIR: root,
};
const projects = join(root, 'projects');

function runInShell(command: string): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((done, fail) => {
    execFile('/bin/sh', ['-c', command], { env }, (error, stdout) => {
      if (error && typeof error.code !== 'number') return fail(error);
      done({ stdout, exitCode: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
}

/** Every channel the link opened, so that none outlives the suite. */
const children: ChildProcess[] = [];

/** An exec channel over child-process pipes: stdout carries the frames, stderr stays apart. */
const openChannel: OpenServerChannel = (command, events) => {
  const child = spawn('/bin/sh', ['-c', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const bytes = (chunk: Buffer) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
  child.stdout.on('data', (chunk: Buffer) => events.onData(bytes(chunk)));
  child.stderr.on('data', (chunk: Buffer) => events.onStderr(bytes(chunk)));
  child.on('close', (code) => events.onClosed(code ?? undefined));
  child.stdin.on('error', () => {});
  return Promise.resolve({
    write: (chunk) => {
      child.stdin.write(chunk);
    },
    close: async () => {
      child.stdin.end();
      child.kill();
    },
  });
};

function until(server: HostServer, kinds: HostServerState['kind'][]): Promise<HostServerState> {
  return new Promise((done) => {
    if (kinds.includes(server.state().kind)) return done(server.state());
    const stop = server.onState((state) => {
      if (!kinds.includes(state.kind)) return;
      stop();
      done(state);
    });
  });
}

beforeAll(async () => {
  if (!existsSync(MUXIFY)) throw new Error(`no Host CLI at ${MUXIFY}: run (cd ../muxify-shell && make host-cli)`);
  // The folders under projects are the Session Paths of this Muxify.
  mkdirSync(projects);
  await runInShell(`printf 'topics:\\n  tags:\\n    work: {}\\nsessions:\\n  paths:\\n    - path: %s/*\\n' ${shellQuote(projects)} > ${shellQuote(env.MUXIFY_CONFIG)}`);
  await runInShell('tmux -f /dev/null new-session -d -s 0');
});

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill();
  // Only the sandbox's own server: never one whose socket is outside root.
  const socket = (await runInShell("tmux display -p '#{socket_path}'")).stdout.trim();
  if (socket.startsWith(`${root}/`)) await runInShell('tmux kill-server');
  rmSync(root, { recursive: true, force: true });
});

function startServer(logged: string[] = []): HostServer {
  return createHostServer({
    open: openChannel,
    locate: () => Promise.resolve(MUXIFY),
    forget: () => {},
    version: async (path) => (await runInShell(`${shellQuote(path)} --version`)).stdout.trim(),
    connected: () => true,
    build: 'Muxify e2e build 1',
    say: (line) => logged.push(line),
  });
}

describe('the Host Server link against a real muxify server', () => {
  it('gets hello, a ping answer and the first snapshot, and closes cleanly', async () => {
    const logged: string[] = [];
    const server = createHostServer({
      open: openChannel,
      locate: () => Promise.resolve(MUXIFY),
      forget: () => {},
      version: async (path) => (await runInShell(`${shellQuote(path)} --version`)).stdout.trim(),
      connected: () => true,
      build: 'Muxify e2e build 1',
      say: (line) => logged.push(line),
    });

    const state = await until(server, ['live', 'sessions-only']);
    const version = (await runInShell(`${shellQuote(MUXIFY)} --version`)).stdout.trim();
    console.log(`Host Server: ${logged.join('; ')}`);
    expect(state).toEqual({ kind: 'live', build: version, protocol: 2 });
    expect(logged).toEqual([`${version}, protocol 2`]);

    await expect(server.request({ ping: {} })).resolves.toEqual({});

    const first = await new Promise<unknown>((done, fail) => {
      const subscription = server.subscribe({ snapshot: {} }, (item) => {
        done(item);
        subscription.cancel();
      });
      subscription.catch(fail);
    });
    expect(first).toMatchObject({ sidebar: expect.any(Object), sessions: [expect.objectContaining({ name: '0' })] });

    const pending = server.request({ snapshot: {} });
    server.close();
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    expect(server.state()).toEqual({ kind: 'closed' });
  }, 30_000);

  it('takes every Host Write of the phone as MuxifyCore decodes it, once per Request id', async () => {
    const server = startServer();
    await until(server, ['live']);
    const HOST = { id: 'sandbox', displayName: 'Sandbox' } as Host;
    const connections = { onServer: <T,>(_host: Host, work: (on: HostServer) => Promise<T>) => work(server) };
    /** One write: its `ok`, or the code and the TopicFailure kind it ended with. A bad shape ends `invalid`. */
    const write = async (command: EnvironmentCommand | { error: string }, topic?: TopicId) => {
      if ('error' in command) throw new Error(String(command.error));
      try {
        return { ok: await server.request(environmentRequest({ command, topic, request: newRequestId() })) };
      } catch (error) {
        if (!(error instanceof HostServerError)) throw error;
        return { code: error.code, kind: (error.topic_failure as { kind?: string } | undefined)?.kind, message: error.message };
      }
    };
    const decoded = (result: { code?: string; kind?: string }) => {
      expect(result.code).not.toBe('invalid');
      expect(result.code).not.toBe('unsupported');
      expect(result.kind).not.toBe('unsupported');
    };

    // New Topic: a second send of the same id makes no second Topic; other arguments with it clash.
    const request = newRequestId();
    const create = { command: createCommand('Live Writes', ['work']), request };
    const made = await sendEnvironment(HOST, create, () => {}, connections);
    expect(made).toEqual({ kind: 'answered', answer: { changed: expect.objectContaining({ created: true, topic_id: request }) } });
    await expect(sendEnvironment(HOST, create, () => {}, connections)).resolves.toEqual(made);
    await expect(sendEnvironment(HOST, { command: createCommand('Live Other', []), request }, () => {}, connections))
      .resolves.toEqual({ kind: 'failed', error: REQUEST_MISMATCH_ERROR });
    const topic = request as unknown as TopicId;
    const listed = (await firstPush(server, { snapshot: {} })) as { unpinned: { bench: { topic?: { label: string } }[] } };
    expect(JSON.stringify(listed).match(/"label":"Live Writes"/g)).toHaveLength(1);

    // Edit Topic.
    for (const change of [
      { field: 'title' as const, title: 'Live Writes 2' },
      { field: 'note' as const, note: 'a note' },
      { field: 'note' as const, note: null },
      { field: 'tags' as const, tags: [] },
    ]) {
      expect(await write(changeCommand(change), topic)).toMatchObject({ ok: expect.anything() });
    }

    // Add a Session, with its exact name, and a Go to pick's Session in no Topic.
    expect(await write(addSessionCommand({ directory: root, worktree: null }, { chosenName: 'live' }), topic))
      .toEqual({ ok: { changed: expect.objectContaining({ session_name: expect.stringMatching(/^live\//) }) } });
    expect(await write(newSessionCommand(root, 'live-free')))
      .toEqual({ ok: { changed: expect.objectContaining({ session_name: 'live-free' }) } });

    // The card's menu orders and drops: each decodes, though the Host may refuse one where the card is.
    for (const action of ['mark-read', 'mark-unread', 'move-up', 'move-down', 'make-guest', 'bench'] as const) {
      decoded(await write(actionCommand(action), topic));
    }
    const lock = '$0' as never;
    for (const drop of [
      { kind: 'place' as const, side: 'before' as const, anchor: { kind: 'open-place' as const, id: 'open-place-1' } },
      { kind: 'place' as const, side: 'after' as const, anchor: { kind: 'locked-session' as const, session: lock, name: '0' } },
      { kind: 'trade' as const, with: { kind: 'topic' as const, id: topic } },
      { kind: 'fill' as const, place: 1 },
    ]) {
      decoded(await write(dropCommand(drop), topic));
    }

    // Settle with the Sessions the Host offers, then the wakes.
    const choices = (await server.request({ topic_choices: { action: 'settle', target: { topic: { id: topic } } } })) as { sessions: object[] };
    expect(choices.sessions).toHaveLength(1);
    expect(await write(settleCommand(choices.sessions, false), topic)).toMatchObject({ ok: expect.anything() });
    expect(await write(wakeCommand('reopen'), topic)).toMatchObject({ ok: expect.anything() });
    decoded(await write(wakeCommand('start-fresh'), topic));

    server.close();
  }, 60_000);

  it('ranks Session Paths for Go to, lists a Topic\'s folder choices, and records a visit', async () => {
    const server = startServer();
    await until(server, ['live']);
    const folder = join(projects, "go to's folder");
    mkdirSync(folder);
    mkdirSync(join(projects, 'another'));
    expect((await runInShell(`${shellQuote(MUXIFY)} session-paths refresh`)).exitCode).toBe(0);
    try {
      await goToRows(server, folder);
    } finally {
      server.close();
    }
  }, 60_000);

  it("lists a Window's stored Browser Tabs, only those the phone can reach", async () => {
    const HOST = { id: 'sandbox', displayName: 'Sandbox' } as Host;
    const server = startServer();
    await until(server, ['live']);
    const connections: ServerConnections = { onServer: (_host, work) => work(server) };
    const window = (await runInShell("tmux new-window -d -P -F '#{window_id}' -t 0:")).stdout.trim();
    // As desktop Muxify stores them: the URLs in the Window's options, with the active Tab's index.
    const urls = ['http://localhost:3000/', 'http://100.101.102.103:8080/', 'https://github.com/', 'http://192.168.1.10:8080/'];
    await runInShell(`tmux set-option -wq -t ${shellQuote(window)} @muxify_tabs ${shellQuote(urls.join(' '))} \\; ` +
      `set-option -wq -t ${shellQuote(window)} @muxify_active_tab 1`);
    try {
      expect(await browserTabsOn(HOST, window, connections)).toEqual({
        kind: 'listed',
        tabs: [
          { id: expect.any(String), url: 'http://100.101.102.103:8080/', title: '', active: true },
          { id: expect.any(String), url: 'https://github.com/', title: '', active: false },
        ],
      });
      // A Window whose Browser has no Tabs lists none; a Window that is gone fails with the Host's reason.
      const plain = (await runInShell("tmux display -p -t 0:0 '#{window_id}'")).stdout.trim();
      expect(await browserTabsOn(HOST, plain, connections)).toEqual({ kind: 'listed', tabs: [] });
      expect(await browserTabsOn(HOST, '@9999', connections)).toEqual({ kind: 'failed', error: expect.stringContaining('@9999') });
    } finally {
      await runInShell(`tmux kill-window -t ${shellQuote(window)}`);
      server.close();
    }
  }, 60_000);

  it('uploads a binary Attachment in pipelined chunks, and the Host has the same bytes', async () => {
    const server = startServer();
    await until(server, ['live']);
    // Every byte value, over more chunks than wait at one time.
    const data = Uint8Array.from({ length: 17 * CHUNK_BYTES + 7 }, (_, index) => (index * 31 + (index >> 8)) % 256);
    let at = 0;
    const file: AttachmentFile = {
      id: 'e2e-upload', uri: '', name: "a 'quoted' $(touch NO).bin", size: data.length, image: false, dispose: () => {},
      open: () => ({ readBytes: (length) => data.subarray(at, (at += length)), close: () => {} }),
    };
    const progress: number[] = [];
    const script = jest.fn<Promise<string>, Parameters<Upload>>();
    try {
      const path = await attachmentUpload(() => server, script)(file, new AbortController().signal, ({ sent }) => progress.push(sent));
      try {
        expect(script).not.toHaveBeenCalled();
        expect(path.endsWith("/a 'quoted' $(touch NO).bin")).toBe(true);
        expect(new Uint8Array(readFileSync(path))).toEqual(data);
        expect(progress.at(-1)).toBe(data.length);
      } finally {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    } finally {
      server.close();
    }
  }, 60_000);
});

/** Go to's rows and visits, and Add a Session's rows, on one live Host Server. */
async function goToRows(server: HostServer, folder: string) {
  const HOST = { id: 'sandbox', displayName: 'Sandbox' } as Host;
  const connections: ServerConnections = { onServer: (_host, work) => work(server) };

  // A visit ranks the folder first for an empty field; a folder that is not there is refused.
  await expect(server.request({ visit_session_path: { folder } })).resolves.toEqual({});
  await expect(server.request({ visit_session_path: { folder: join(root, 'missing') } })).rejects.toBeInstanceOf(HostServerError);
  const ranked = await rankedSessionPaths(HOST, '', connections);
  expect(ranked.map((row) => row.directory)).toEqual(expect.arrayContaining([folder, join(projects, 'another')]));
  expect(ranked[0]).toMatchObject({ directory: folder, lastVisit: expect.any(String) });
  // Text is ranked by the Host's match.
  const matched = await rankedSessionPaths(HOST, 'anoth', connections);
  expect(matched[0]).toMatchObject({ directory: join(projects, 'another') });

  // A Topic's rows name the Topic, and say which folders are in it.
  const request = newRequestId();
  await sendEnvironment(HOST, { command: createCommand('Live Go to', []), request }, () => {}, connections);
  const topic = request as unknown as TopicId;
  const add = addSessionCommand({ directory: folder, worktree: null }, { chosenName: 'goto' });
  if ('error' in add) throw new Error(String(add.error));
  await expect(server.request(environmentRequest({ command: add, topic, request: newRequestId() })))
    .resolves.toMatchObject({ changed: expect.anything() });
  const choices = await topicSessionPaths(HOST, topic, connections);
  expect(choices).toContainEqual(expect.objectContaining({ directory: folder, inThisTopic: true }));
  expect(choices).toContainEqual(expect.objectContaining({ directory: join(projects, 'another'), inThisTopic: false }));
}
