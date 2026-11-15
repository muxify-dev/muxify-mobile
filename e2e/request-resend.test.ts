/**
 * A New Topic whose answer is lost, against a real Host CLI over real SSH.
 *
 * Not part of `pnpm test`. e2e/request-resend.sh runs it in the sandbox, after
 * it puts a wrapper `muxify` on the Host's PATH that loses the answer of the
 * first send of each Request id.
 *
 * The registry of Connections and the Host CLI caller are the app's own. Only
 * the dial is not: each exec is one `ssh` to an sshd in the sandbox, and the
 * registry closes a Connection by ending its `ssh` processes. So this does not
 * prove the app's screens. e2e/request-resend.ad does that in the Simulator.
 */
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createHostConnections, type Dialed } from '@/ssh/host-connections';
import type { Host } from '@/storage/records';
import type { TmuxExecResult } from '@/tmux/transport';
import { newRequestId } from '@/topics/request';

const root = process.env.MUXIFY_E2E_ROOT;
if (!root) throw new Error('run this through e2e/request-resend.sh');
const port = process.env.MUXIFY_E2E_SSH_PORT;
const key = join(root, 'client_key');
const TITLE = 'e2e Request Topic over SSH';
const HOST: Host = { id: 'sandbox', displayName: 'Sandbox', address: '127.0.0.1', port: Number(port), identityId: 'none' };

function dial(dials: Dialed[]): Promise<Dialed> {
  const running = new Set<ChildProcess>();
  let connected = true;
  const exec = (command: string) =>
    new Promise<TmuxExecResult>((resolve, reject) => {
      const child = spawn('ssh', [
        '-p', String(port), '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '127.0.0.1', command,
      ]);
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
  const dialed: Dialed = {
    transport: { exec, openControl: () => Promise.reject(new Error('not in this test')) },
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
    store: { rememberFingerprint: () => Promise.resolve() },
    log: { record: (tag, text) => log.push(`${tag}: ${text}`) },
  });
  const request = newRequestId();

  const made = await connections.write(HOST, (transport, muxify) =>
    muxify.create((command) => transport.exec(command), TITLE, ['work'], request));

  expect(made).toEqual({ kind: 'created', topic: request });
  expect(dials).toHaveLength(2);
  expect(log.join('\n')).toContain('sending the same Request again');

  const read = await connections.read(HOST, (transport, muxify) => muxify.read((command) => transport.exec(command)));
  if (read.kind !== 'listed') throw new Error(`the Host did not list its Topics: ${JSON.stringify(read)}`);
  const { pinned, unpinned } = read.snapshot;
  const labels = [...pinned, ...unpinned.places, ...unpinned.guests, ...unpinned.bench]
    .flatMap((card) => (card.kind === 'topic' ? [card.topic.label] : []))
    .filter((label) => label.startsWith(TITLE));
  expect(labels).toEqual([TITLE]);

  const sends = readFileSync(join(root, 'request-calls'), 'utf8').split('\n').filter((line) => line.includes(TITLE));
  expect(sends.map((line) => line.split(' ')[0])).toEqual([request, request]);

  // Closes the Connection that is still open, so that no idle timer keeps jest running.
  connections.lifecycleChanged('background');
  connections.lifecycleChanged('active');
}, 60_000);
