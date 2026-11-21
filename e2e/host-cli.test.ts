/**
 * The phone's Host CLI install and its Host Server, on throwaway OrbStack
 * machines.
 *
 * Not part of `pnpm test`, which is hermetic:
 *
 *   (cd ../muxify-shell && make host-cli)
 *   pnpm e2e:host-cli
 *
 * For each architecture, arm64 and then amd64 through Rosetta, it creates a
 * uniquely named Ubuntu machine with tmux, git and curl. It never uses or
 * changes a machine it did not create, and deletes its own afterwards, also
 * when a step fails.
 *
 * It serves two builds of the Host CLI over HTTP from this Mac, which the
 * machine reaches at `host.orb.internal`: `new/` is
 * `../muxify-shell/build/host-cli/`, and `old/` the same Linux binaries with
 * their build stamp a day older. Over `ssh <machine>@orb`, as the phone does:
 *
 * - the install runner sends its bootstrap for `old/` and answers `installed`,
 *   and the Host Server link, which found no `muxify`, starts the server,
 *   gets its `hello` and the first `snapshot` item;
 * - a second link starts on the old build, the install of `new/` answers
 *   `updated`, and the link sends `shutdown`, starts once more on the new
 *   binary and gets `hello` again; a third install answers `current`;
 * - on a HOME with no `muxify`, an install that cannot fetch leaves the link
 *   in Sessions only, with "the Host CLI could not be installed".
 *
 * Every command on the machine runs with a HOME and TMUX_TMPDIR of its own,
 * and without TMUX and TMUX_PANE, as e2e/sandbox.sh asks.
 *
 * It skips with a message when `orb` is not on PATH, or when
 * `../muxify-shell/build/host-cli/install.sh` is missing.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { connect, createServer } from 'net';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';

import {
  createHostServer,
  PHONE_CAPABILITIES,
  type HostServer,
  type HostServerState,
  type OpenServerChannel,
} from '@/ssh/host-server';
import { installHostCli, type OpenCommandChannel } from '@/topics/host-cli-install';
import { createMuxifyPath } from '@/topics/muxify-path';
import { shellQuote } from '@/tmux/commands';
import type { TmuxExecResult } from '@/tmux/transport';

const ASSETS = resolve(__dirname, '../../muxify-shell/build/host-cli');
const ARCHS = ['arm64', 'amd64'] as const;
/** This run's machines are named `muxify-mobile-e2e-<run>-<arch>`. */
const RUN = randomUUID().slice(0, 8);
/** How long the Host Server may take to answer, a restart included. */
const SERVER_TIMEOUT_MS = 60_000;
/** A machine with apt-get, through Rosetta for amd64, takes minutes. */
const MACHINE_TIMEOUT_MS = 15 * 60_000;
const SSH_CONFIG = join(homedir(), '.orbstack/ssh/config');

const { TMUX: _tmux, TMUX_PANE: _pane, ...localEnv } = process.env;

interface Run {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs a program on this Mac, without TMUX and TMUX_PANE. Never rejects on a non-zero exit. */
function run(file: string, args: string[], timeout = MACHINE_TIMEOUT_MS): Promise<Run> {
  return new Promise((done, fail) => {
    execFile(file, args, { env: localEnv, timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return fail(error);
      done({ stdout, stderr, code: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
}

async function must(file: string, args: string[]): Promise<string> {
  const result = await run(file, args);
  if (result.code !== 0) {
    throw new Error(`${file} ${args.join(' ')} exited ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function onPath(program: string): boolean {
  return (process.env.PATH ?? '').split(':').some((dir) => dir && existsSync(join(dir, program)));
}

function skipReason(): string | null {
  if (!onPath('orb')) return 'orb is not on PATH (it needs OrbStack)';
  if (!existsSync(join(ASSETS, 'install.sh'))) {
    return `${join(ASSETS, 'install.sh')} is missing; run make host-cli in ../muxify-shell`;
  }
  return null;
}

const skipped = skipReason();
if (skipped) console.warn(`pnpm e2e:host-cli: skipped, ${skipped}`);

async function machines(): Promise<string[]> {
  return (await must('orb', ['list', '-q'])).split('\n').filter(Boolean);
}

/** A port nothing on this Mac listens on, for the HTTP server. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? done(address.port) : fail(new Error('no port')),
      );
    });
  });
}

async function listening(port: number, deadline: number): Promise<void> {
  for (;;) {
    const up = await new Promise<boolean>((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
    if (up) return;
    if (Date.now() > deadline) throw new Error(`the HTTP server did not listen on ${port}`);
    await new Promise((later) => setTimeout(later, 100));
  }
}

/**
 * The served folder: `new/` is the build, `old/` its Linux binaries with the
 * build stamp `<sha> <time>` a day older, which they print in `--version` and
 * in their `hello`. `missing/` holds only `install.sh`, so an install of it
 * fails: it cannot fetch the version.
 */
function servedBuilds(): { root: string; oldLine: string; newLine: string } {
  const newLine = readFileSync(join(ASSETS, 'version'), 'utf8').trim();
  const [, sha, time] = newLine.split(' ');
  const oldLine = `muxify ${sha} ${Number(time) - 86_400}`;
  const stamp = (line: string) => Buffer.from(`${line.replace(/^muxify /, '')}\0`);
  if (stamp(oldLine).length !== stamp(newLine).length) throw new Error(`cannot make an older stamp of ${newLine}`);

  const root = mkdtempSync(join(tmpdir(), 'muxify-e2e-host-cli.'));
  const old = join(root, 'old');
  mkdirSync(old);
  mkdirSync(join(root, 'missing'));
  copyFileSync(join(ASSETS, 'install.sh'), join(root, 'missing', 'install.sh'));
  symlinkSync(ASSETS, join(root, 'new'));
  copyFileSync(join(ASSETS, 'install.sh'), join(old, 'install.sh'));
  writeFileSync(join(old, 'version'), `${oldLine}\n`);
  for (const asset of ['muxify-linux-aarch64', 'muxify-linux-x86_64']) {
    const binary = readFileSync(join(ASSETS, asset));
    const at = binary.indexOf(stamp(newLine));
    if (at < 0 || binary.indexOf(stamp(newLine), at + 1) >= 0) {
      throw new Error(`${asset} does not hold its build stamp exactly once`);
    }
    stamp(oldLine).copy(binary, at);
    writeFileSync(join(old, asset), binary, { mode: 0o755 });
  }
  return { root, oldLine, newLine };
}

let http: ChildProcess | undefined;
let served = '';
let oldBase = '';
let newBase = '';
let missingBase = '';
let oldLine = '';
let newLine = '';

beforeAll(async () => {
  if (skipped) return;
  const builds = servedBuilds();
  served = builds.root;
  ({ oldLine, newLine } = builds);
  const port = await freePort();
  http = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', served], {
    env: localEnv,
    stdio: 'ignore',
  });
  await listening(port, Date.now() + 10_000);
  const base = `http://host.orb.internal:${port}/`;
  oldBase = `${base}old/`;
  newBase = `${base}new/`;
  missingBase = `${base}missing/`;
});

afterAll(async () => {
  if (http?.pid !== undefined && http.exitCode === null) process.kill(http.pid, 'SIGTERM');
  if (served) rmSync(served, { recursive: true, force: true });
  if (skipped) return;
  expect((await machines()).filter((name) => name.startsWith(`muxify-mobile-e2e-${RUN}-`))).toEqual([]);
});

/** Waits for the link to reach one of `kinds`, and answers that state. */
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

/** The first item of the `snapshot` subscription. */
function firstSnapshot(server: HostServer): Promise<unknown> {
  return new Promise((done, fail) => {
    const subscription = server.subscribe({ snapshot: {} }, (item) => {
      done(item);
      subscription.cancel();
    });
    subscription.catch(fail);
  });
}

/** One Host Server channel the link opened: its command, the frames each way, and its ssh. */
interface ServerChannelRecord {
  command: string;
  child: ChildProcess;
  sent: string;
  received: string;
  closed: Promise<void>;
}

/** The JSON frames of one side of a channel, without the preamble. */
function frames(text: string): Record<string, unknown>[] {
  return text.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

(skipped ? describe.skip : describe).each(ARCHS)('the Host CLI install and Host Server on a throwaway %s machine', (arch) => {
  const machine = `muxify-mobile-e2e-${RUN}-${arch}`;
  let created = false;
  let home = '';
  const channels: ServerChannelRecord[] = [];

  /** SSH to the machine, as the phone does, with a HOME and TMUX_TMPDIR of this run's own. */
  function sshArgs(command: string, dir = home): string[] {
    const isolated =
      'env -u TMUX -u TMUX_PANE -u MUXIFY_CONFIG -u XDG_STATE_HOME -u XDG_CONFIG_HOME ' +
      `HOME=${shellQuote(dir)} TMUX_TMPDIR=${shellQuote(dir)} /bin/sh -c ${shellQuote(command)}`;
    return ['-F', SSH_CONFIG, '-o', 'BatchMode=yes', `${machine}@orb`, isolated];
  }

  async function exec(command: string, dir = home): Promise<TmuxExecResult> {
    const result = await run('ssh', sshArgs(command, dir));
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code };
  }

  const bytes = (chunk: Buffer) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;

  /**
   * A non-PTY channel that runs one command: one `ssh` process. The bootstrap
   * sends its stderr to stdout, so stderr here is only ssh's own.
   */
  function openCommand(dir = home): OpenCommandChannel {
    return (command, events) => {
      const child = spawn('ssh', sshArgs(command, dir), { env: localEnv, stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.on('data', (chunk: Buffer) => events.onData(bytes(chunk)));
      child.on('close', (code) => events.onClosed(code ?? undefined));
      return Promise.resolve({
        close: async () => {
          child.kill('SIGTERM');
        },
      });
    };
  }

  /** The Host Server's exec channel: one `ssh` process, its stdin and stdout the frames, its stderr apart. */
  function openServer(dir = home): OpenServerChannel {
    return (command, events) => {
      const child = spawn('ssh', sshArgs(command, dir), { env: localEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      const record: ServerChannelRecord = {
        command,
        child,
        sent: '',
        received: '',
        closed: new Promise((done) => child.on('close', () => done())),
      };
      channels.push(record);
      child.stdout.on('data', (chunk: Buffer) => {
        record.received += chunk.toString('utf8');
        events.onData(bytes(chunk));
      });
      child.stderr.on('data', (chunk: Buffer) => events.onStderr(bytes(chunk)));
      child.on('close', (code) => events.onClosed(code ?? undefined));
      child.stdin.on('error', () => {});
      return Promise.resolve({
        write: (chunk) => {
          record.sent += Buffer.from(chunk).toString('utf8');
          child.stdin.write(chunk);
        },
        close: async () => {
          child.stdin.end();
          child.kill();
        },
      });
    };
  }

  /** The link of one Connection, as host-connections serves it: the probe finds `muxify`, the install tells it its answer. */
  function link(dir = home, logged: string[] = []): HostServer {
    const muxify = createMuxifyPath((line) => logged.push(line));
    return createHostServer({
      open: openServer(dir),
      locate: () => muxify.locate((command) => exec(command, dir)),
      forget: () => muxify.forget(),
      version: async (path) => (await exec(`${shellQuote(path)} --version`, dir)).stdout.trim().split('\n')[0] ?? '',
      connected: () => true,
      build: 'Muxify e2e build 1',
      say: (line) => logged.push(line),
    });
  }

  /** The `hello` the server sent on a channel. */
  function helloOn(record: ServerChannelRecord): { build?: string; capabilities?: string[] } | undefined {
    return frames(record.received).find((frame) => frame.kind === 'hello')?.hello as
      | { build?: string; capabilities?: string[] }
      | undefined;
  }

  beforeAll(async () => {
    if ((await machines()).includes(machine)) throw new Error(`OrbStack machine ${machine} already exists`);
    created = true;
    await must('orb', ['create', '--arch', arch, 'ubuntu', machine]);
    await must('orb', [
      '-m',
      machine,
      '-u',
      'root',
      'sh',
      '-c',
      'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq tmux git curl >/dev/null',
    ]);
    const made = await must('ssh', ['-F', SSH_CONFIG, '-o', 'BatchMode=yes', `${machine}@orb`, 'mktemp -d /tmp/muxify-e2e.XXXXXX']);
    home = made.trim();
    expect(home).toMatch(/^\/tmp\/muxify-e2e\./);
    const tmux = await exec('tmux -f /dev/null new-session -d -s 0');
    expect(tmux.exitCode).toBe(0);
  }, MACHINE_TIMEOUT_MS);

  afterAll(async () => {
    try {
      for (const { child } of channels) if (child.exitCode === null && child.signalCode === null) child.kill();
      if (home) {
        const socket = await exec("tmux display -p '#{socket_path}'");
        if (socket.exitCode === 0 && socket.stdout.trim().startsWith(`${home}/`)) await exec('tmux kill-server');
      }
    } finally {
      if (created) await must('orb', ['delete', '-f', machine]);
    }
    expect(await machines()).not.toContain(machine);
  }, MACHINE_TIMEOUT_MS);

  it('starts the Host Server once the install answers, and gets hello and the first snapshot', async () => {
    const logged: string[] = [];
    const server = link(home, logged);
    try {
      // No `muxify` yet: the link waits for the install.
      expect(await until(server, ['installing', 'live', 'sessions-only'])).toEqual({ kind: 'installing' });
      const answer = await installHostCli(openCommand(), { base: oldBase });
      console.log(`${arch} first install: ${answer.line}`);
      expect(answer).toMatchObject({ kind: 'installed', text: oldLine.replace(/^muxify /, '') });
      server.installAnswered(answer);

      const state = await until(server, ['live', 'sessions-only']);
      console.log(`${arch} Host Server: ${logged.join('; ')}`);
      expect(state).toEqual({ kind: 'live', build: oldLine, protocol: 2 });
      expect(channels).toHaveLength(1);
      expect(channels[0]!.command).toBe(`${shellQuote(`${home}/.local/bin/muxify`)} server`);
      const hello = helloOn(channels[0]!);
      expect(hello?.build).toBe(oldLine);
      expect(hello?.capabilities).toEqual(expect.arrayContaining([...PHONE_CAPABILITIES]));
      expect(PHONE_CAPABILITIES).toHaveLength(5);

      expect(await firstSnapshot(server)).toMatchObject({ sessions: [expect.objectContaining({ name: '0' })] });
    } finally {
      server.close();
    }
    await channels[0]!.closed;
  }, MACHINE_TIMEOUT_MS);

  it('after an updated answer, sends shutdown and starts once more on the new binary', async () => {
    const before = channels.length;
    const logged: string[] = [];
    const server = link(home, logged);
    try {
      expect(await until(server, ['live', 'sessions-only'])).toEqual({ kind: 'live', build: oldLine, protocol: 2 });
      expect(channels).toHaveLength(before + 1);
      const first = channels[before]!;

      const answer = await installHostCli(openCommand(), { base: newBase });
      console.log(`${arch} second install: ${answer.line}`);
      expect(answer.kind).toBe('updated');
      expect(answer.text).toBe(`${oldLine.replace(/^muxify /, '')} -> ${newLine.replace(/^muxify /, '')}`);
      server.installAnswered(answer);

      const restarted = await new Promise<HostServerState>((done) => {
        const stop = server.onState((state) => {
          if (state.kind !== 'live' && state.kind !== 'sessions-only') return;
          stop();
          done(state);
        });
      });
      console.log(`${arch} Host Server: ${logged.join('; ')}`);
      expect(restarted).toEqual({ kind: 'live', build: newLine, protocol: 2 });
      expect(frames(first.sent).some((frame) => frame.kind === 'request' && 'shutdown' in (frame.request as object))).toBe(true);
      await first.closed;
      expect(channels).toHaveLength(before + 2);
      const second = channels[before + 1]!;
      expect(second.command).toBe(`${shellQuote(`${home}/.local/bin/muxify`)} server`);
      expect(helloOn(second)?.build).toBe(newLine);
      expect(await firstSnapshot(server)).toMatchObject({ sessions: [expect.objectContaining({ name: '0' })] });

      const third = await installHostCli(openCommand(), { base: newBase });
      console.log(`${arch} third install: ${third.line}`);
      expect(third.kind).toBe('current');
      server.installAnswered(third);
      expect(server.state()).toEqual({ kind: 'live', build: newLine, protocol: 2 });
      expect(channels).toHaveLength(before + 2);
    } finally {
      server.close();
    }
    await channels[channels.length - 1]!.closed;

    const uname = await exec('uname -m');
    expect(uname.stdout.trim()).toBe(arch === 'arm64' ? 'aarch64' : 'x86_64');
  }, MACHINE_TIMEOUT_MS);

  it('finds the installed muxify, which answers --version', async () => {
    const log: string[] = [];
    const path = await createMuxifyPath((line) => log.push(line)).locate(exec);

    expect(path).toBe(`${home}/.local/bin/muxify`);
    expect(log).toContain(`found muxify at ${home}/.local/bin/muxify by ~/.local/bin`);
    const version = await exec(`${shellQuote(path!)} --version`);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toBe(newLine);
  }, MACHINE_TIMEOUT_MS);

  it('ends in Sessions only when there is no muxify and the install fails', async () => {
    const bare = (await exec('mktemp -d /tmp/muxify-e2e.XXXXXX')).stdout.trim();
    expect(bare).toMatch(/^\/tmp\/muxify-e2e\./);
    const before = channels.length;
    const logged: string[] = [];
    const server = link(bare, logged);
    try {
      const answer = await installHostCli(openCommand(bare), { base: missingBase });
      console.log(`${arch} failed install: ${answer.line}`);
      expect(answer.line).toBe(`failed: cannot fetch ${missingBase}version`);
      server.installAnswered(answer);

      const state = await until(server, ['live', 'sessions-only']);
      console.log(`${arch} Host Server: ${logged.join('; ')}`);
      expect(state).toEqual({ kind: 'sessions-only', reason: `the Host CLI could not be installed (${answer.line})` });
      expect(channels).toHaveLength(before);
    } finally {
      server.close();
    }
  }, SERVER_TIMEOUT_MS);
});
