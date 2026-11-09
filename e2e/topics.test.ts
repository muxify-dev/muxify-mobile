/**
 * The Topics module, against the real `muxify` on this machine.
 *
 * Not part of `pnpm test`, which is hermetic:
 *
 *   pnpm e2e:topics
 *
 * It makes a throwaway Topic, reads `environment show --json` through the
 * module's own probe and read, and checks that the Host Screen model draws the
 * Topic as an Empty, dimmed card.
 *
 * Every command runs against a Muxify of its own: its Topic records, its Config
 * and its tmux server live in a temp folder, which is removed afterwards. See
 * e2e/sandbox.sh, which does the same for the suites that go over SSH.
 *
 * The transport stands in for SSH by running each command in a child shell, as
 * an SSH exec does. It does not prove that `muxify` is found over a real SSH
 * session, whose PATH can be smaller: the Simulator run against the dev
 * Host does.
 */
import { execFile } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

import { hostScreen } from '@/domain/host-screen';
import { UNASKED } from '@/domain/host-listing';
import { settled, TOPICS_UNASKED } from '@/topics/host-topics';
import { createMuxifyCli } from '@/topics/muxify-cli';
import { shellQuote } from '@/tmux/commands';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

// /tmp, not os.tmpdir(): a tmux socket path must stay under 104 bytes.
const root = mkdtempSync('/tmp/muxify-e2e-topics.');
const { TMUX: _tmux, TMUX_PANE: _pane, ...inherited } = process.env;
const env = {
  ...inherited,
  MUXIFY_CONFIG: join(root, 'config.yaml'),
  XDG_STATE_HOME: join(root, 'state'),
  TMUX_TMPDIR: root,
};

function runInShell(command: string): Promise<TmuxExecResult> {
  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL ?? '/bin/sh', ['-c', command], { env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
}

const transport: TmuxTransport = {
  exec: runInShell,
  openControl: () => Promise.reject(new Error('Topics only use exec')),
};

beforeAll(async () => {
  await runInShell('tmux -f /dev/null new-session -d -s 0');
});

afterAll(async () => {
  await runInShell('tmux kill-server');
  rmSync(root, { recursive: true, force: true });
});

describe('Topics against the real muxify', () => {
  it('reads a Topic that was just made, as an Empty, dimmed card', async () => {
    const title = `e2e Topics ${Date.now()}`;
    const created = await runInShell(`muxify topic new ${shellQuote(title)} --json`);
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { changed: { topic_id: string } }).changed.topic_id;

    const log: string[] = [];
    const read = await createMuxifyCli((line) => log.push(line)).read(transport.exec);

    expect(read.kind).toBe('listed');
    if (read.kind !== 'listed') return;
    console.log(`probe: ${log.join('; ')}`);

    const sections = hostScreen({
      settings: { hostScreenLists: ['topics'], recentSessionsFirst: true },
      recent: [],
      listing: UNASKED,
      topics: settled(TOPICS_UNASKED, read),
      // With In Play, a new Topic waits on the Bench, which shows its cards only when opened.
      opened: new Set(['bench']),
      appearance: 'light',
    });
    const rows = sections.flatMap((section) => section.rows);
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: 'topic',
        id,
        label: title,
        dimmed: true,
        mark: null,
        note: null,
      }),
    );
    expect(read.snapshot.sessions.length).toBeGreaterThan(0);
  });
});
