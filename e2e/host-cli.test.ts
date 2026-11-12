/**
 * The phone's Host CLI install, on throwaway OrbStack machines.
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
 * It serves `../muxify-shell/build/host-cli/` over HTTP from this Mac, which
 * the machine reaches at `host.orb.internal`, and sends the install runner's
 * own bootstrap to it over `ssh <machine>@orb`. The runner parses the answer:
 * `installed` the first time, `current` the second. The Topics module then
 * makes a Topic and reads it over the same SSH, through the `muxify` the
 * install put in `~/.local/bin`.
 *
 * Every command on the machine runs with a HOME and TMUX_TMPDIR of its own,
 * and without TMUX and TMUX_PANE, as e2e/sandbox.sh asks.
 *
 * It skips with a message when `orb` is not on PATH, or when
 * `../muxify-shell/build/host-cli/install.sh` is missing.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { connect, createServer } from 'net';
import { homedir } from 'os';
import { join, resolve } from 'path';

import type { Card } from '@/topics/environment';
import { installHostCli, type OpenCommandChannel } from '@/topics/host-cli-install';
import { createMuxifyCli } from '@/topics/muxify-cli';
import { shellQuote } from '@/tmux/commands';
import type { TmuxExecResult } from '@/tmux/transport';

const ASSETS = resolve(__dirname, '../../muxify-shell/build/host-cli');
const ARCHS = ['arm64', 'amd64'] as const;
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

let http: ChildProcess | undefined;
let base = '';

beforeAll(async () => {
  if (skipped) return;
  const port = await freePort();
  http = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ASSETS], {
    env: localEnv,
    stdio: 'ignore',
  });
  await listening(port, Date.now() + 10_000);
  base = `http://host.orb.internal:${port}/`;
});

afterAll(() => {
  if (http?.pid !== undefined && http.exitCode === null) process.kill(http.pid, 'SIGTERM');
});

(skipped ? describe.skip : describe).each(ARCHS)('the Host CLI install on a throwaway %s machine', (arch) => {
  const machine = `muxify-mobile-e2e-${arch}-${randomUUID().slice(0, 8)}`;
  let created = false;
  let home = '';

  /** SSH to the machine, as the phone does, with this run's HOME and TMUX_TMPDIR. */
  function sshArgs(command: string): string[] {
    const isolated =
      'env -u TMUX -u TMUX_PANE -u MUXIFY_CONFIG -u XDG_STATE_HOME -u XDG_CONFIG_HOME ' +
      `HOME=${shellQuote(home)} TMUX_TMPDIR=${shellQuote(home)} /bin/sh -c ${shellQuote(command)}`;
    return ['-F', SSH_CONFIG, '-o', 'BatchMode=yes', `${machine}@orb`, isolated];
  }

  async function exec(command: string): Promise<TmuxExecResult> {
    const result = await run('ssh', sshArgs(command));
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code };
  }

  /**
   * A non-PTY channel that runs one command: one `ssh` process. The bootstrap
   * sends its stderr to stdout, so stderr here is only ssh's own.
   */
  const open: OpenCommandChannel = (command, events) => {
    const child = spawn('ssh', sshArgs(command), { env: localEnv, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (chunk: Buffer) =>
      events.onData(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer),
    );
    child.on('close', (code) => events.onClosed(code ?? undefined));
    return Promise.resolve({
      close: async () => {
        child.kill('SIGTERM');
      },
    });
  };

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
      if (home) {
        const socket = await exec("tmux display -p '#{socket_path}'");
        if (socket.exitCode === 0 && socket.stdout.trim().startsWith(`${home}/`)) await exec('tmux kill-server');
      }
    } finally {
      if (created) await must('orb', ['delete', '-f', machine]);
    }
    expect(await machines()).not.toContain(machine);
  }, MACHINE_TIMEOUT_MS);

  it('installs the Host CLI with the phone’s bootstrap, then finds it current', async () => {
    const first = await installHostCli(open, { base });
    console.log(`${arch} first install: ${first.line}`);
    expect(first.kind).toBe('installed');

    const second = await installHostCli(open, { base });
    console.log(`${arch} second install: ${second.line}`);
    expect(second.kind).toBe('current');
    expect(second.text).toBe(first.text);

    const uname = await exec('uname -m');
    expect(uname.stdout.trim()).toBe(arch === 'arm64' ? 'aarch64' : 'x86_64');
  }, MACHINE_TIMEOUT_MS);

  it('makes a Topic and reads it through the installed muxify', async () => {
    const log: string[] = [];
    const cli = createMuxifyCli((line) => log.push(line));
    const title = `e2e Host CLI ${arch} ${Date.now()}`;

    const created = await cli.create(exec, title, []);
    expect(created).toMatchObject({ kind: 'created' });
    if (created.kind !== 'created') return;
    expect(log).toEqual([`found muxify at ${home}/.local/bin/muxify by ~/.local/bin`]);

    const read = await cli.read(exec);
    expect(read.kind).toBe('listed');
    if (read.kind !== 'listed') return;
    const { pinned, unpinned } = read.snapshot;
    const cards: Card[] = [
      ...pinned,
      ...(unpinned.kind === 'list' ? unpinned.cards : [...unpinned.places, ...unpinned.guests, ...unpinned.bench]),
    ];
    expect(cards).toContainEqual(
      expect.objectContaining({ kind: 'topic', topic: expect.objectContaining({ id: created.topic, label: title }) }),
    );
  }, MACHINE_TIMEOUT_MS);
});
