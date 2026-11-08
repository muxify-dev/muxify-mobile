import { createMuxifyCli } from './muxify-cli';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

import inPlay from './__fixtures__/environment-in-play.json';
import liveTopic from './__fixtures__/topic-live.json';
import type { TopicId } from './environment';

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
