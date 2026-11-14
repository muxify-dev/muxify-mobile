/**
 * Every hardware-keyboard press, through the app's own path, into real tmux of
 * every version Muxify meets: 3.0a to the latest.
 *
 * Not part of `pnpm test`. It needs tmux on this Mac and Docker for the older
 * versions:
 *
 *   pnpm e2e:tmux-keys
 *   TMUX_KEYS_TARGETS=local,ubuntu:24.04 pnpm e2e:tmux-keys
 *
 * A press starts as the kitty sequence the Surface writes, goes through
 * toTypedParts and TmuxClient.deliver down a real Control Connection, and is
 * read back as bytes by a raw program in the Pane. Each tmux runs with every
 * `extended-keys` and `extended-keys-format` it accepts, and the program asks
 * for each keyboard mode: none (a shell), modifyOtherKeys (Claude Code) and
 * kitty. A press is broken when nothing arrives, or when tmux typed the key's
 * name as text — what `S-Enter` did on 3.4 before the classic naming. See
 * ADR 0003.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { shellQuote, type OutboxToken } from '@/tmux/commands';
import type { Key, Seq } from '@/tmux/input-lane';
import { openControlConnection } from '@/tmux/control-connection';
import { keyNamingFor, renderPress, type KeyPress } from '@/tmux/key-press';
import { TmuxClient } from '@/tmux/tmux-client';
import type { TmuxTransport } from '@/tmux/transport';
import { toTypedParts } from '@/lib/terminal-input';

const TARGETS = (process.env.TMUX_KEYS_TARGETS
  ?? 'local,ubuntu:20.04,ubuntu:22.04,debian:bookworm,ubuntu:24.04,debian:trixie,alpine:edge').split(',');

const PANE = 'p:0.0';
const SEPARATOR = '~~SEP~~';
/** Bytes that bypass the naming: they must reach the Pane exactly. */
const RAW = '\x1b[114;5u';

const MODIFIERS: Record<string, number> = {
  shift: 1, alt: 2, ctrl: 4, 'alt+shift': 3, 'ctrl+shift': 5, 'ctrl+alt': 6, 'ctrl+alt+shift': 7,
};
const KEYS: Record<string, number> = { Return: 13, Tab: 9, Backspace: 127, Escape: 27, Space: 32 };
for (const character of 'abcdefghijklmnopqrstuvwxyz0123456789-_=+[]{}\\|;:\'",.<>/?`~!@#$%^&*()') {
  KEYS[character] = character.codePointAt(0)!;
}

interface Press { name: string; press: KeyPress }

/** Each key with each modifier set, parsed from the kitty sequence by the app's own parser. */
const PRESSES: Press[] = Object.entries(KEYS).flatMap(([key, code]) =>
  Object.entries(MODIFIERS).flatMap(([modifiers, bits]) => {
    const [part] = toTypedParts(new TextEncoder().encode(`\x1b[${code};${bits + 1}u`));
    return part?.kind === 'press' ? [{ name: `${modifiers}+${key}`, press: part.press }] : [];
  }));

/** Writes every byte the Pane receives to a file, after asking for a keyboard mode. */
const READER = `
import os, sys, tty
mode, out = sys.argv[1], sys.argv[2]
tty.setraw(0)
os.write(1, {'kitty': b'\\x1b[>1u', 'mok': b'\\x1b[>4;2m', 'none': b''}[mode])
open(out + '.ready', 'w').close()
f = open(out, 'ab', buffering=0)
while True:
    f.write(os.read(0, 65536))
`;

/** A tmux to test against. `dir` is the same folder seen from here and from inside, at `inside`. */
interface Target {
  dir: string;
  inside: string;
  tmux(...args: string[]): string;
  /** The shell command line of a Control Connection's channel, run where the tmux is. */
  spawnControl(command: string): ChildProcess;
  /** Stops the run's tmux server, only when it is the run's own. */
  killServer(): void;
  close(): void;
}

function localTarget(): Target {
  const dir = realpathSync(mkdtempSync('/tmp/muxify-keys-'));
  const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: dir };
  delete env.TMUX;
  delete env.TMUX_PANE;
  const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  return {
    dir,
    inside: dir,
    tmux,
    spawnControl: (command) => spawn('/bin/sh', ['-c', command], { env }),
    killServer() {
      let socket: string;
      try { socket = tmux('display', '-p', '#{socket_path}').trim(); } catch { return; }
      if (!socket.startsWith(`${dir}/`)) throw new Error(`refusing to kill a tmux server outside the run: ${socket}`);
      tmux('kill-server');
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function dockerTarget(image: string): Target {
  const dir = realpathSync(mkdtempSync('/tmp/muxify-keys-'));
  const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  const container = docker('run', '-d', '--rm', '-v', `${dir}:/work`, image, 'sleep', 'infinity');
  docker('exec', container, 'sh', '-c', [
    'if command -v apk >/dev/null; then apk add -q tmux python3',
    'else apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux python3 >/dev/null; fi',
  ].join('; '));
  const tmux = (...args: string[]) => docker('exec', container, 'tmux', '-f', '/dev/null', ...args);
  return {
    dir,
    inside: '/work',
    tmux,
    spawnControl: (command) => spawn('docker', ['exec', '-i', container, 'sh', '-c', command]),
    killServer() { try { tmux('kill-server'); } catch { /* not running */ } },
    close() {
      try { docker('rm', '-f', container); } catch { /* already gone */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function controlTransport(target: Target): TmuxTransport {
  return {
    exec: async () => { throw new Error('unused'); },
    openControl: async (command, events) => {
      const child = target.spawnControl(command);
      child.stdout!.on('data', (data: Buffer) =>
        events.onData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer));
      child.on('close', (code) => events.onClosed(code ?? undefined));
      child.stdin!.on('error', () => {});
      return {
        write: (bytes) => { child.stdin!.write(bytes); },
        isOpen: () => child.exitCode === null,
        close: async () => { child.kill(); },
      };
    },
  };
}

async function waitFor(what: string, done: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const accepts = (target: Target, ...args: string[]) => {
  try { target.tmux(...args); return true; } catch { return false; }
};

interface Run { config: string; received: string[] }

/** One tmux server with one setting and one keyboard mode: what each press delivered, in order. */
async function runConfig(target: Target, ext: string, format: string, mode: string): Promise<Run | null> {
  const out = join(target.dir, `out-${ext}-${format}-${mode}`);
  const outInside = join(target.inside, `out-${ext}-${format}-${mode}`);
  target.tmux('new-session', '-d', '-s', 'p', '-x', '80', '-y', '20',
    `python3 -I ${shellQuote(join(target.inside, 'reader.py'))} ${mode} ${shellQuote(outInside)}`);
  try {
    const extAccepted = accepts(target, 'set', '-s', 'extended-keys', ext);
    const formatAccepted = accepts(target, 'set', '-s', 'extended-keys-format', format);
    if ((!extAccepted && ext !== 'off') || (!formatAccepted && format !== 'xterm')) return null;
    await waitFor('the reader', () => existsSync(`${out}.ready`), 10_000);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const control = await openControlConnection(controlTransport(target), { sessionName: 'p' },
      { onOutput() {}, onNotification() {}, onClosed() {} });
    const client = new TmuxClient(control);
    // As the Outbox sends them: one Batch each, numbered, and each must be on
    // the Pane by its own mark. This is also the Batch line on every tmux.
    let seq = 0;
    const deliver = async (key: Key) => {
      seq += 1;
      const mark = await client.deliver(PANE, { seq: seq as Seq, key, typedAt: 0 }, 'keys' as OutboxToken);
      if (mark === 'gone' || 'refused' in mark || mark.ack !== seq) {
        throw new Error(`Batch ${seq} did not reach the Pane: ${JSON.stringify(mark)}`);
      }
      await control.run(['send-keys', '-t', PANE, '-l', SEPARATOR]);
    };
    for (const { press } of PRESSES) await deliver({ kind: 'key', key: press });
    await deliver({ kind: 'text', bytes: [...new TextEncoder().encode(RAW)], gesture: false });

    const received = () => (existsSync(out) ? readFileSync(out).toString('latin1') : '');
    await waitFor('every press', () => received().split(SEPARATOR).length > PRESSES.length + 1, 30_000);
    await control.close();
    const config = `extended-keys ${extAccepted ? ext : 'unsupported'}, format ${formatAccepted ? format : 'n/a'}, mode ${mode}`;
    return { config, received: received().split(SEPARATOR) };
  } finally {
    target.killServer();
  }
}

/** Whether a press arrived as something a program can read, not as nothing or its own name. */
function broken(sent: string | null, got: string): boolean {
  return got === '' || (sent !== null && sent.length > 1 && got.includes(sent)) || /[CMS]-/.test(got);
}

describe.each<string>(TARGETS)('tmux on %s', (name) => {
  let target: Target;
  beforeAll(() => {
    target = name === 'local' ? localTarget() : dockerTarget(name);
    writeFileSync(join(target.dir, 'reader.py'), READER);
  }, 300_000);
  afterAll(() => target?.close());

  it('delivers every press in every setting and keyboard mode', async () => {
    const version = target.tmux('-V').trim();
    const naming = keyNamingFor(version);
    const problems: string[] = [];
    let configs = 0;
    for (const ext of ['off', 'on', 'always']) {
      for (const format of ['xterm', 'csi-u']) {
        for (const mode of ['none', 'mok', 'kitty']) {
          const run = await runConfig(target, ext, format, mode);
          if (run === null) continue;
          configs += 1;
          PRESSES.forEach(({ name: press, press: key }, index) => {
            const rendered = renderPress(key, naming);
            const got = run.received[index];
            if (broken('key' in rendered ? rendered.key : null, got)) problems.push(`${run.config}: ${press} -> ${JSON.stringify(got)}`);
          });
          const raw = run.received[PRESSES.length];
          if (raw !== RAW) problems.push(`${run.config}: raw bytes -> ${JSON.stringify(raw)}`);
        }
      }
    }
    console.log(`${name}: ${version}, ${naming} naming, ${configs} configs, ${configs * PRESSES.length} presses, ${problems.length} broken`);
    expect(configs).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  }, 600_000);
});
