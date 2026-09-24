/** Real shell, binary files and tmux: protocol behaviour a mock cannot prove. */
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createUploader, type OpenUploadChannel } from '@/composer/upload';
import type { AttachmentFile } from '@/composer/types';
import { openControlConnection } from '@/tmux/control-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import type { TmuxTransport } from '@/tmux/transport';
import { describeCommand, shellQuote } from '@/tmux/commands';

let home: string;
const children: ChildProcess[] = [];
const SOCKET = `muxify-composer-${process.pid}`;
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCKET, '-f', '/dev/null', ...args], { encoding: 'utf8' });
const bytes = (data: Buffer) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'muxify-composer-')); });
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  rmSync(home, { recursive: true, force: true });
});
afterAll(() => {
  try { execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' }); }
  catch { /* already gone */ }
});

const open: OpenUploadChannel = async (command, events) => {
  const child = spawn('/bin/sh', ['-c', command], { env: { ...process.env, HOME: home } });
  children.push(child);
  child.stdout.on('data', (data: Buffer) => events.onData(bytes(data)));
  child.stdin.on('error', () => {});
  const closed = new Promise<void>((resolve) => child.on('close', (code) => {
    events.onClosed(code ?? undefined);
    resolve();
  }));
  return {
    write: (data) => { child.stdin.write(data); },
    sendEof: () => { child.stdin.end(); },
    close: async () => { child.stdin.end(); await closed; },
  };
};

function source(data: Buffer, name = 'image.png', size = data.length): AttachmentFile {
  return { uri: '', name, image: true, size, dispose() {}, open() {
    let at = 0;
    return { close() {}, readBytes(length) {
      const part = data.subarray(at, at + length);
      at += part.length;
      return part;
    } };
  } };
}

it('uploads every byte, quotes filenames, reports acknowledged progress, and finalizes atomically', async () => {
  const data = Buffer.alloc(2 * 1024 * 1024 + 7);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;
  const progress: number[] = [];
  const path = await createUploader(open)(source(data, "a 'quoted' $(touch NO).png"), new AbortController().signal,
    ({ sent }) => progress.push(sent));
  expect(readFileSync(path)).toEqual(data);
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(data.length);
  expect(progress.every((value, index) => index === 0 || value > progress[index - 1])).toBe(true);
  expect(existsSync(join(home, 'NO'))).toBe(false);
  expect(existsSync(join(path, '..', '.upload.part'))).toBe(false);
}, 30_000);

it('can upload an empty file', async () => {
  const path = await createUploader(open)(source(Buffer.alloc(0)), new AbortController().signal, () => {});
  expect(readFileSync(path).length).toBe(0);
});

it('refuses a truncated local source and never publishes a final file', async () => {
  await expect(createUploader(open)(source(Buffer.from('short'), 'short.png', 100), new AbortController().signal, () => {}))
    .rejects.toThrow('could not be read');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const root = join(home, '.cache/muxify/attachments');
  expect(readdirSync(root).flatMap((id) => readdirSync(join(root, id)))).toEqual([]);
});

it('cancels between acknowledged chunks without finalizing partial content', async () => {
  const controller = new AbortController();
  await expect(createUploader(open)(source(Buffer.alloc(100_000)), controller.signal, ({ sent }) => {
    if (sent > 0) controller.abort();
  })).rejects.toThrow('cancelled');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const root = join(home, '.cache/muxify/attachments');
  expect(readdirSync(root).flatMap((id) => readdirSync(join(root, id)))).toEqual([]);
});

it('round-trips Unicode, multiline text and shell syntax through a private tmux paste buffer', async () => {
  tmux('new-session', '-d', '-s', 'composer', '-x', '80', '-y', '24');
  const transport: TmuxTransport = {
    exec: async () => { throw new Error('unused'); },
    openControl: async (command, events) => {
      const child = spawn('/bin/sh', ['-c', command.replace(/^tmux /, `tmux -L ${SOCKET} `)]);
      children.push(child);
      child.stdout.on('data', (data: Buffer) => events.onData(bytes(data)));
      child.on('close', () => events.onClosed());
      child.stdin.on('error', () => {});
      return {
        write: (data) => { child.stdin.write(data); },
        isOpen: () => child.exitCode === null,
        close: async () => { child.kill(); },
      };
    },
  };
  const control = await openControlConnection(transport, { sessionName: 'composer' }, { onOutput() {}, onNotification() {}, onClosed() {} });
  const client = new TmuxClient(control);
  const text = `${'🙂'.repeat(2100)}\nsecond\tline '\\' \"quotes\" $HOME #{pane_id}\r\nlast`;
  const buffer = await client.preparePaste(text, 'muxify-test', () => {});
  const actual = execFileSync('tmux', ['-L', SOCKET, 'save-buffer', '-b', 'muxify-test', '-']);
  expect(actual.toString('utf8')).toBe(text);
  expect(describeCommand(['set-buffer', '-b', 'muxify-test', '--', text])).not.toContain('second');

  // A raw receiver enables bracketed paste, proving -p follows the Pane mode
  // and -r preserves newlines. Its file is independent of terminal rendering.
  const output = join(home, 'received');
  const ready = join(home, 'ready');
  const python = `import os,tty; tty.setraw(0); os.write(1,b'\\x1b[?2004h'); open(${JSON.stringify(ready)},'w').close(); f=open(${JSON.stringify(output)},'wb',buffering=0)\nwhile True:\n b=os.read(0,65536)\n f.write(b)\n if b.endswith(b'\\r'): break`;
  tmux('respawn-pane', '-k', '-t', 'composer:0.0', `python3 -c ${shellQuote(python)}`);
  const waitFor = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('Receiver timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await waitFor(() => existsSync(ready));
  await buffer.paste('composer:0.0');
  await client.sendKey('composer:0.0', 'Enter');
  const expected = `\x1b[200~${text}\x1b[201~\r`;
  await waitFor(() => existsSync(output) && readFileSync(output).length >= Buffer.byteLength(expected));
  expect(readFileSync(output).toString('utf8')).toBe(expected);
  await control.close();
}, 15_000);
