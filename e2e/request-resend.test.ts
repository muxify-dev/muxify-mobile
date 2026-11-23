/**
 * A New Topic whose answer is lost, against a real Host Server over real SSH.
 *
 * Not part of `pnpm test`. e2e/request-resend.sh runs it in the sandbox, after
 * it puts a proxy in front of the Host's `muxify server` that ends the channel
 * in place of the `end` of the first send of each Request id.
 *
 * The registry of Connections, the Host Server link and the Host Write are the
 * app's own. Only the dial is not: each exec and the Host Server channel are
 * one `ssh` to an sshd in the sandbox, and the registry closes a Connection by
 * ending its `ssh` processes. So this does not prove the app's screens.
 * e2e/request-resend.ad does that in the Simulator.
 */
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createHostConnections, type Dialed } from '@/ssh/host-connections';
import type { OpenServerChannel } from '@/ssh/host-server';
import type { Host } from '@/storage/records';
import type { TmuxExecResult } from '@/tmux/transport';
import { parseEnvironment } from '@/topics/environment';
import { firstPush, sendEnvironment } from '@/topics/host-write-request';
import { createCommand } from '@/topics/host-writes';
import { newRequestId } from '@/topics/request';

const mockLogged: string[] = [];
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: (tag: string, text: string) => mockLogged.push(`${tag}: ${text}`) }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => { throw new Error('this suite gives its own Connections'); } }));

const root = process.env.MUXIFY_E2E_ROOT;
if (!root) throw new Error('run this through e2e/request-resend.sh');
const port = process.env.MUXIFY_E2E_SSH_PORT;
const key = join(root, 'client_key');
const TITLE = 'e2e Request Topic over SSH';
const HOST: Host = { id: 'sandbox', displayName: 'Sandbox', address: '127.0.0.1', port: Number(port), identityId: 'none' };

const ssh = (command: string) => spawn('ssh', [
  '-p', String(port), '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '127.0.0.1', command,
]);

function dial(dials: Dialed[]): Promise<Dialed> {
  const running = new Set<ChildProcess>();
  let connected = true;
  const exec = (command: string) =>
    new Promise<TmuxExecResult>((resolve, reject) => {
      const child = ssh(command);
      running.add(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += String(data); });
      child.stderr.on('data', (data) => { stderr += String(data); });
      child.on('error', reject);
      child.on('close', (code) => {
        running.delete(child);
        if (code === null || code === 255) reject(new Error(`ssh ended with no answer: ${stderr.trim()}`));
        else resolve({ stdout, stderr, exitCode: code });
      });
    });
  // The Host Server's channel: stdout carries the frames, stderr stays apart.
  const openServerChannel: OpenServerChannel = (command, events) => {
    const child = ssh(command);
    running.add(child);
    const bytes = (chunk: Buffer) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    child.stdout.on('data', (chunk: Buffer) => events.onData(bytes(chunk)));
    child.stderr.on('data', (chunk: Buffer) => events.onStderr(bytes(chunk)));
    child.on('close', (code) => {
      running.delete(child);
      events.onClosed(code ?? undefined);
    });
    child.stdin.on('error', () => {});
    return Promise.resolve({
      write: (chunk) => { child.stdin.write(chunk); },
      close: async () => {
        child.stdin.end();
        child.kill();
      },
    });
  };
  const dialed: Dialed = {
    transport: { exec, openControl: () => Promise.reject(new Error('not in this test')) },
    openServerChannel,
    fingerprint: 'sandbox',
    verdict: { kind: 'known' },
    isConnected: () => connected,
    disconnect: () => {
      connected = false;
      for (const child of running) child.kill();
      return Promise.resolve();
    },
  };
  dials.push(dialed);
  return Promise.resolve(dialed);
}

it('makes one Topic, and gives no error, when the answer of the first send is lost', async () => {
  const dials: Dialed[] = [];
  const log: string[] = [];
  const connections = createHostConnections({
    dial: () => dial(dials),
    store: { rememberFingerprint: () => Promise.resolve(), pruneSessionPlaces: () => Promise.resolve() },
    log: { record: (tag, text) => log.push(`${tag}: ${text}`) },
  });
  const request = newRequestId();

  const made = await sendEnvironment(HOST, { command: createCommand(TITLE, ['work']), request }, () => {}, connections);

  expect(made).toEqual({ kind: 'answered', answer: { changed: expect.objectContaining({ created: true, topic_id: request }) } });
  expect(mockLogged.join('\n')).toContain('sending the same Request to the next one');
  // The Host Server started again on the same Connection, and took the second send.
  expect(dials).toHaveLength(1);
  expect(log.join('\n')).toContain('request-proxy: lost the answer of a first send');

  const snapshot = parseEnvironment(await connections.onServer(HOST, (server) => firstPush(server, { snapshot: {} })));
  const { pinned, unpinned } = snapshot;
  const labels = [...pinned, ...unpinned.places, ...unpinned.guests, ...unpinned.bench]
    .flatMap((card) => (card.kind === 'topic' ? [card.topic.label] : []))
    .filter((label) => label.startsWith(TITLE));
  expect(labels).toEqual([TITLE]);

  const sends = readFileSync(join(root, 'request-calls'), 'utf8').split('\n').filter((line) => line.endsWith(' create'));
  expect(sends.map((line) => line.split(' ')[0])).toEqual([request, request]);

  // Closes the Connection that is still open, so that no idle timer keeps jest running.
  connections.lifecycleChanged('background');
  connections.lifecycleChanged('active');
}, 60_000);
