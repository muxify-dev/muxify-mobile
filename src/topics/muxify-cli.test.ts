import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMuxifyCli } from './muxify-cli';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

import inPlay from './__fixtures__/environment-in-play.json';
import liveTopic from './__fixtures__/topic-live.json';
import type { TopicId } from './environment';
import type { TopicChange } from './topic-edit';

type Answer = Partial<TmuxExecResult>;
const NOT_FOUND: Answer = { exitCode: 1 };

/** A Host that answers each command by the first rule that matches it, and records them all. */
function fakeHost(rules: [match: string, answer: Answer][]) {
  const ran: string[] = [];
  const exec: TmuxTransport['exec'] = async (command) => {
    ran.push(command);
    const rule = rules.find(([match]) => command.includes(match));
    return { stdout: '', stderr: '', exitCode: 127, ...rule?.[1] };
  };
  return { exec, ran };
}

const PATH_FOUND: Answer = { exitCode: 0, stdout: '/opt/bin/muxify\n' };
const SHOW: Answer = { exitCode: 0, stdout: JSON.stringify(inPlay) };

describe('finding muxify on a Host', () => {
  it('stops at the first place that has it', async () => {
    const host = fakeHost([['command -v', PATH_FOUND], ['environment show', SHOW]]);

    await createMuxifyCli().read(host.exec);

    expect(host.ran).toEqual(['command -v muxify', "'/opt/bin/muxify' environment show --json"]);
  });

  it('asks the shell to expand ~ and uses the path it gets back', async () => {
    const host = fakeHost([
      ['command -v', NOT_FOUND],
      ['~/.local/bin', { exitCode: 0, stdout: '/Users/me/.local/bin/muxify\n' }],
      ['environment show', SHOW],
    ]);

    await createMuxifyCli().read(host.exec);

    expect(host.ran).toEqual([
      'command -v muxify',
      'test -x ~/.local/bin/muxify && echo ~/.local/bin/muxify',
      "'/Users/me/.local/bin/muxify' environment show --json",
    ]);
  });

  it('falls back to the app bundle', async () => {
    const bundle = '/Applications/Muxify.app/Contents/Resources/bin/muxify';
    const host = fakeHost([
      ['command -v', NOT_FOUND],
      ['~/.local/bin', NOT_FOUND],
      [`test -x '${bundle}'`, { exitCode: 0, stdout: `${bundle}\n` }],
      ['environment show', SHOW],
    ]);

    const read = await createMuxifyCli().read(host.exec);

    expect(read.kind).toBe('listed');
    expect(host.ran).toHaveLength(4);
    expect(host.ran[3]).toBe(`'${bundle}' environment show --json`);
  });

  it('does not take a shell alias for a path', async () => {
    const host = fakeHost([['command -v', { exitCode: 0, stdout: "alias muxify='x'\n" }]]);

    expect(await createMuxifyCli().read(host.exec)).toEqual({ kind: 'absent' });
  });

  it('is absent when no place has it, and says so once', async () => {
    const host = fakeHost([]);
    const log: string[] = [];
    const cli = createMuxifyCli((line) => log.push(line));

    expect(await cli.read(host.exec)).toEqual({ kind: 'absent' });
    expect(await cli.read(host.exec)).toEqual({ kind: 'absent' });

    expect(host.ran).toHaveLength(3);
    expect(log).toEqual(['muxify is not on this Host']);
  });

  it('remembers where it found muxify, so a later read is one exec', async () => {
    const host = fakeHost([['command -v', PATH_FOUND], ['environment show', SHOW]]);
    const cli = createMuxifyCli();

    await cli.read(host.exec);
    host.ran.length = 0;
    await cli.read(host.exec);

    expect(host.ran).toEqual(["'/opt/bin/muxify' environment show --json"]);
  });

  it('probes again after an exec that threw, because it found nothing out', async () => {
    let calls = 0;
    const host = fakeHost([['command -v', PATH_FOUND], ['environment show', SHOW]]);
    const exec: TmuxTransport['exec'] = (command) => {
      if (calls++ === 0) return Promise.reject(new Error('connection lost'));
      return host.exec(command);
    };
    const cli = createMuxifyCli();

    await expect(cli.read(exec)).rejects.toThrow('connection lost');
    expect((await cli.read(exec)).kind).toBe('listed');
  });

  it('logs where it found muxify', async () => {
    const host = fakeHost([['command -v', PATH_FOUND], ['environment show', SHOW]]);
    const log: string[] = [];

    await createMuxifyCli((line) => log.push(line)).read(host.exec);

    expect(log).toEqual(['found muxify at /opt/bin/muxify by PATH']);
  });
});

describe('reading the Topics', () => {
  const found = ['command -v', PATH_FOUND] as [string, Answer];

  it('gives the parsed snapshot', async () => {
    const host = fakeHost([found, ['environment show', SHOW]]);

    const read = await createMuxifyCli().read(host.exec);

    if (read.kind !== 'listed') throw new Error(`expected listed, got ${read.kind}`);
    expect(read.snapshot.pinned).toHaveLength(1);
  });

  it('is old when muxify has no environment show, which a usage error says', async () => {
    const host = fakeHost([
      found,
      ['environment show', { exitCode: 2, stderr: 'error: unknown subcommand environment' }],
    ]);

    expect(await createMuxifyCli().read(host.exec)).toEqual({ kind: 'old' });
  });

  it('fails with the message the CLI wrote on stdout', async () => {
    const failure = { failed: { kind: 'topic_unavailable', message: 'No open Topic matches x.' } };
    const host = fakeHost([
      found,
      ['environment show', { exitCode: 1, stdout: JSON.stringify(failure), stderr: 'a human line\n' }],
    ]);

    expect(await createMuxifyCli().read(host.exec)).toEqual({
      kind: 'failed',
      error: 'No open Topic matches x.',
    });
  });

  it('fails with stderr when stdout has no message, and then with stdout, and then with the status', async () => {
    const answers: [Answer, string][] = [
      [{ exitCode: 1, stdout: 'not json', stderr: ' it broke \n' }, 'it broke'],
      [{ exitCode: 1, stdout: 'only stdout\n' }, 'only stdout'],
      [{ exitCode: 3 }, 'muxify exited with status 3'],
    ];
    for (const [answer, error] of answers) {
      const host = fakeHost([found, ['environment show', answer]]);
      expect(await createMuxifyCli().read(host.exec)).toEqual({ kind: 'failed', error });
    }
  });

  it('fails, with the reason, on an answer that is not JSON', async () => {
    const host = fakeHost([found, ['environment show', { exitCode: 0, stdout: 'Welcome back!\n' }]]);

    const read = await createMuxifyCli().read(host.exec);

    expect(read).toMatchObject({ kind: 'failed' });
    expect(read.kind === 'failed' && read.error).toContain('Could not read the answer of muxify');
  });

  it('fails, with the path of the problem, on JSON of a shape it cannot use', async () => {
    const host = fakeHost([found, ['environment show', { exitCode: 0, stdout: '{"tags":[]}' }]]);

    const read = await createMuxifyCli().read(host.exec);

    expect(read.kind === 'failed' && read.error).toContain('unpinned: expected an object');
  });
});

describe('reading one Topic', () => {
  const found = ['command -v', PATH_FOUND] as [string, Answer];
  const topicId = 'eb367a1f-687b-43af-9679-e27f28ad7141' as TopicId;

  it('names the Topic by its id, quoted for the shell', async () => {
    const host = fakeHost([found, ['topic show', { exitCode: 0, stdout: JSON.stringify(liveTopic) }]]);

    const read = await createMuxifyCli().show(host.exec, topicId);

    expect(host.ran[1]).toBe(`'/opt/bin/muxify' topic show --json --topic '${topicId}'`);
    expect(read.kind === 'shown' && read.topic.label).toBe('GS: Try a verification skill in poteto-mode');
  });

  it('quotes an id that has shell characters in it', async () => {
    const host = fakeHost([found]);

    await createMuxifyCli().show(host.exec, "it's; rm -rf ~" as TopicId);

    expect(host.ran[1]).toBe(`'/opt/bin/muxify' topic show --json --topic 'it'\\''s; rm -rf ~'`);
  });

  it('fails with the message the CLI gave for a Topic it has not got', async () => {
    const failure = {
      failed: { kind: 'topic_unavailable', message: 'No open Topic matches nope.', phase: 'nothing_changed' },
    };
    const host = fakeHost([found, ['topic show', { exitCode: 1, stdout: JSON.stringify(failure) }]]);

    expect(await createMuxifyCli().show(host.exec, 'nope' as TopicId)).toEqual({
      kind: 'failed',
      error: 'No open Topic matches nope.',
    });
  });

  it('fails, and says why, on a Host with no muxify', async () => {
    const host = fakeHost([]);

    expect(await createMuxifyCli().show(host.exec, topicId)).toEqual({
      kind: 'failed',
      error: 'Desktop Muxify is not on this Host.',
    });
  });

  it('fails, with the path of the problem, on JSON of a shape it cannot use', async () => {
    const host = fakeHost([found, ['topic show', { exitCode: 0, stdout: '{"topic":{"id":"x"}}' }]]);

    const read = await createMuxifyCli().show(host.exec, topicId);

    expect(read.kind === 'failed' && read.error).toContain('topic.label: expected a string');
  });

  it('shares one probe with the Topics read', async () => {
    const host = fakeHost([found, ['environment show', SHOW]]);
    const cli = createMuxifyCli();

    await cli.read(host.exec);
    await cli.show(host.exec, topicId);

    expect(host.ran.filter((command) => command.startsWith('command -v'))).toHaveLength(1);
  });
});

/**
 * A Host whose `muxify` is a script that writes the arguments it got, one
 * per line, and gives `answer`. The command runs in a
 * real shell, so the test sees what the Host's shell makes of the quoting.
 */
function scriptedHost(answer: string, exitCode = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'muxify-cli-'));
  const script = join(dir, 'muxify');
  const argv = join(dir, 'argv');
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\nprintf '%s' '${answer}'\nexit ${exitCode}\n`,
  );
  chmodSync(script, 0o755);
  const exec: TmuxTransport['exec'] = async (command) => {
    if (command.startsWith('command -v'))
      return { stdout: `${script}\n`, stderr: '', exitCode: 0 };
    const run = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    return {
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.status ?? 1,
    };
  };
  return {
    exec,
    argv: () => readFileSync(argv, 'utf8').split('\n').slice(0, -1),
  };
}

describe('making a Topic', () => {
  const created = {
    changed: {
      created: true,
      shown: { empty_topic: { id: '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' } },
      topic_id: '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6',
    },
  };

  it('gives the title and each Tag to muxify as one argument each, quotes and spaces kept', async () => {
    const host = scriptedHost(JSON.stringify(created));

    const read = await createMuxifyCli().create(host.exec, `Fix "login" it's $HOME`, [
      'big project',
      "o'brien",
    ]);

    expect(host.argv()).toEqual([
      'topic',
      'new',
      `Fix "login" it's $HOME`,
      '--tag',
      'big project',
      '--tag',
      "o'brien",
      '--json',
    ]);
    expect(read).toEqual({
      kind: 'created',
      topic: '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6',
    });
  });

  it('gives no --tag with no Tags', async () => {
    const host = scriptedHost(JSON.stringify(created));

    await createMuxifyCli().create(host.exec, 'Notes', []);

    expect(host.argv()).toEqual(['topic', 'new', 'Notes', '--json']);
  });

  it('fails with the message the CLI gave, as for a Tag the Config does not define', async () => {
    const failure = {
      failed: {
        kind: 'tag_undefined',
        message: 'The Config does not define #nosuchtag in topics.tags. Add a Tag there first.',
        phase: 'nothing_changed',
      },
    };
    const host = scriptedHost(JSON.stringify(failure), 1);

    expect(await createMuxifyCli().create(host.exec, 'bad', ['nosuchtag'])).toEqual({
      kind: 'failed',
      error: 'The Config does not define #nosuchtag in topics.tags. Add a Tag there first.',
    });
  });

  it('fails, with the path of the problem, on an answer with no Topic id', async () => {
    const host = fakeHost([
      ['command -v', PATH_FOUND],
      ['topic new', { exitCode: 0, stdout: '{"changed":{}}' }],
    ]);

    const read = await createMuxifyCli().create(host.exec, 'Notes', []);

    expect(read.kind === 'failed' && read.error).toContain('changed.topic_id: expected a string');
  });

  it('fails, and says why, on a Host with no muxify', async () => {
    expect(await createMuxifyCli().create(fakeHost([]).exec, 'Notes', [])).toEqual({
      kind: 'failed',
      error: 'Desktop Muxify is not on this Host.',
    });
  });
});

describe('changing a Topic', () => {
  const ID = '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' as TopicId;
  const CHANGED = JSON.stringify({ changed: { created: false, topic_id: ID } });

  it.each<[string, TopicChange, string[]]>([
    [
      'renames it, the title as one argument',
      { field: 'title', title: `Fix "login" it's $HOME` },
      ['topic', 'rename', `Fix "login" it's $HOME`],
    ],
    [
      'sets the Note, as one argument',
      { field: 'note', note: "back at o'brien's `test` step" },
      ['topic', 'note', "back at o'brien's `test` step"],
    ],
    ['clears the Note with --clear', { field: 'note', note: null }, ['topic', 'note', '--clear']],
    [
      'sets the Tags, each as one argument',
      { field: 'tags', tags: ['work', "o'brien", 'big project'] },
      ['topic', 'tag', 'set', 'work', "o'brien", 'big project'],
    ],
    ['removes every Tag with a set of none', { field: 'tags', tags: [] }, ['topic', 'tag', 'set']],
  ])('%s, and names the Topic by id', async (_, change, command) => {
    const host = scriptedHost(CHANGED);

    const write = await createMuxifyCli().change(host.exec, ID, change);

    expect(host.argv()).toEqual([...command, '--topic', ID, '--json']);
    expect(write).toEqual({ kind: 'changed' });
  });

  it('quotes an id that has shell characters in it', async () => {
    const host = scriptedHost(CHANGED);

    await createMuxifyCli().change(host.exec, "x' ; rm -rf ~ '" as TopicId, {
      field: 'note',
      note: null,
    });

    expect(host.argv()).toEqual([
      'topic',
      'note',
      '--clear',
      '--topic',
      "x' ; rm -rf ~ '",
      '--json',
    ]);
  });

  it.each<[string, TopicChange, string]>([
    [
      'a Tag the Config does not define',
      { field: 'tags', tags: ['nosuchtag'] },
      'The Config does not define #nosuchtag in topics.tags. Add a Tag there first.',
    ],
    [
      'a Topic the Mac has closed',
      { field: 'title', title: 'New' },
      `No open Topic matches ${ID}.`,
    ],
  ])('fails with the message the CLI gave, as for %s', async (_, change, message) => {
    const host = scriptedHost(
      JSON.stringify({
        failed: { kind: 'x', message, phase: 'nothing_changed' },
      }),
      1,
    );

    expect(await createMuxifyCli().change(host.exec, ID, change)).toEqual({
      kind: 'failed',
      error: message,
    });
  });

  it('fails with a short reason, not the help text, on a usage error', async () => {
    const host = fakeHost([
      ['command -v', PATH_FOUND],
      [
        'topic note',
        {
          exitCode: 2,
          stderr: 'usage: muxify topic note ("text" | --clear) …',
        },
      ],
    ]);

    const write = await createMuxifyCli().change(host.exec, ID, {
      field: 'note',
      note: '-x',
    });

    expect(write.kind === 'failed' && write.error).toContain('starts with -');
  });

  it('fails, and says why, on a Host with no muxify', async () => {
    expect(
      await createMuxifyCli().change(fakeHost([]).exec, ID, {
        field: 'title',
        title: 'New',
      }),
    ).toEqual({ kind: 'failed', error: 'Desktop Muxify is not on this Host.' });
  });
});

describe('adding a Session to a Topic', () => {
  const ID = '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' as TopicId;
  const ADDED = JSON.stringify({
    changed: {
      created: false,
      pane: '%187',
      session: '$61',
      session_name: 'my-project/fix-login',
      shown: { window: { id: '@75' } },
      topic_id: ID,
      window: '@75',
    },
  });

  it('gives the folder as one argument, spaces and quotes kept, and names the Topic by id', async () => {
    const host = scriptedHost(ADDED);

    const read = await createMuxifyCli().addSession(host.exec, ID, `/Users/me/my "big" project's $HOME`);

    expect(host.argv()).toEqual([
      'topic',
      'add-session',
      `/Users/me/my "big" project's $HOME`,
      '--topic',
      ID,
      '--json',
    ]);
    expect(read).toEqual({ kind: 'added', session: 'my-project/fix-login' });
  });

  it.each([
    ['~', `${process.env.HOME}`],
    ['~/', `${process.env.HOME}/`],
    ['~/Dev/my project', `${process.env.HOME}/Dev/my project`],
    ['~other/x', '~other/x'],
    ['Dev/~/x', 'Dev/~/x'],
  ])('reads a leading ~ in %s as the home folder on the Host', async (folder, given) => {
    const host = scriptedHost(ADDED);

    await createMuxifyCli().addSession(host.exec, ID, folder);

    expect(host.argv()[2]).toBe(given);
  });

  it('fails with what the CLI said, as for a folder that is not there', async () => {
    const host = fakeHost([
      ['command -v', PATH_FOUND],
      ['topic add-session', { exitCode: 2, stderr: "muxify: no directory '/nope'\n" }],
    ]);

    expect(await createMuxifyCli().addSession(host.exec, ID, '/nope')).toEqual({
      kind: 'failed',
      error: "muxify: no directory '/nope'",
    });
  });

  it('fails with the message the CLI gave, as for a Topic the Mac has closed', async () => {
    const message = `No open Topic matches ${ID}.`;
    const host = scriptedHost(
      JSON.stringify({ failed: { kind: 'x', message, phase: 'nothing_changed' } }),
      1,
    );

    expect(await createMuxifyCli().addSession(host.exec, ID, '/tmp')).toEqual({
      kind: 'failed',
      error: message,
    });
  });

  it('fails, and says why, on an answer with no Session name', async () => {
    const host = scriptedHost(JSON.stringify({ changed: { topic_id: ID } }));

    const read = await createMuxifyCli().addSession(host.exec, ID, '/tmp');

    expect(read.kind === 'failed' && read.error).toContain('changed.session_name');
  });

  it('fails, and says why, on a Host with no muxify', async () => {
    expect(await createMuxifyCli().addSession(fakeHost([]).exec, ID, '/tmp')).toEqual({
      kind: 'failed',
      error: 'Desktop Muxify is not on this Host.',
    });
  });
});

describe('waking a Dormant Topic', () => {
  const ID = '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' as TopicId;
  const WOKEN = JSON.stringify({ changed: { topic_id: ID } });

  it.each([
    ['reopenTopic', 'reopen'],
    ['startTopicFresh', 'start-fresh'],
  ] as const)('%s asks the Host for topic %s on the Topic by id', async (call, verb) => {
    const host = scriptedHost(WOKEN);

    const write = await createMuxifyCli()[call](host.exec, ID);

    expect(host.argv()).toEqual(['topic', verb, '--topic', ID, '--json']);
    expect(write).toEqual({ kind: 'changed' });
  });

  it.each(['reopenTopic', 'startTopicFresh'] as const)(
    '%s fails with the message the CLI gave, as for a Topic that is not Dormant',
    async (call) => {
      const message = 'The Topic has live Sessions.';
      const host = scriptedHost(
        JSON.stringify({ failed: { kind: 'x', message, phase: 'nothing_changed' } }),
        1,
      );

      expect(await createMuxifyCli()[call](host.exec, ID)).toEqual({ kind: 'failed', error: message });
    },
  );

  it.each(['reopenTopic', 'startTopicFresh'] as const)(
    '%s tells an old muxify, which has no such command, from a refusal',
    async (call) => {
      const host = fakeHost([
        ['command -v', PATH_FOUND],
        ['topic', { exitCode: 2, stderr: 'usage: muxify topic open …' }],
      ]);

      const write = await createMuxifyCli()[call](host.exec, ID);

      expect(write.kind === 'failed' && write.error).toContain('old muxify');
    },
  );

  it.each(['reopenTopic', 'startTopicFresh'] as const)('%s fails, and says why, on a Host with no muxify', async (call) => {
    expect(await createMuxifyCli()[call](fakeHost([]).exec, ID)).toEqual({
      kind: 'failed',
      error: 'Desktop Muxify is not on this Host.',
    });
  });
});

describe('reading the Tabs of a Window', () => {
  const TABS = [
    { active: true, id: 'A1', title: 'Dev server', url: 'http://mac.tail1234.ts.net:3000/' },
    { active: false, id: 'B2', title: '', url: 'http://localhost:3000/' },
  ];

  it('names the Window by its tmux id, quoted for the shell, and gives every Tab', async () => {
    const host = fakeHost([['command -v', PATH_FOUND], ['browser tabs', { exitCode: 0, stdout: JSON.stringify(TABS) }]]);

    const read = await createMuxifyCli().browserTabs(host.exec, '@12');

    expect(host.ran[1]).toBe("'/opt/bin/muxify' browser tabs --window '@12' --json");
    expect(read).toEqual({ kind: 'listed', tabs: TABS });
  });

  it('fails with what the CLI said, as for a tmux server that Muxify does not show', async () => {
    const stderr = 'cannot reach Muxify: Muxify does not serve the Browser of this tmux server.\n';
    const host = fakeHost([['command -v', PATH_FOUND], ['browser tabs', { exitCode: 1, stderr }]]);

    expect(await createMuxifyCli().browserTabs(host.exec, '@12')).toEqual({ kind: 'failed', error: stderr.trim() });
  });

  it('fails, and says why, on a Host with no muxify', async () => {
    const host = fakeHost([]);

    expect(await createMuxifyCli().browserTabs(host.exec, '@12')).toEqual({
      kind: 'failed',
      error: 'Desktop Muxify is not on this Host.',
    });
  });
});
