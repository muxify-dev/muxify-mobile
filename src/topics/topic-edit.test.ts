import type { TmuxTransport } from '@/tmux/transport';

import type { TopicId } from './environment';
import { createMuxifyCli } from './muxify-cli';
import type { RequestId } from './request';
import {
  changes,
  fieldsFromParam,
  fieldsParam,
  saveTopicEdit,
  typedFields,
  type TopicFields,
} from './topic-edit';

const ID = '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' as TopicId;
const ON_HOST: TopicFields = {
  title: 'Fix login',
  note: 'at step 3',
  tags: ['work', 'old'],
};

const REQUEST = '0b0e4a3c-6f1d-4c0a-9a57-2f3c1d9e8b10' as RequestId;

/**
 * A Host with `muxify` on its PATH that records each command after the probe
 * and refuses the subcommands in `refuse`.
 */
function host(refuse: string[] = []) {
  const sent: string[] = [];
  const exec: TmuxTransport['exec'] = async (command) => {
    if (command.startsWith('command -v'))
      return { stdout: '/opt/bin/muxify\n', stderr: '', exitCode: 0 };
    // The first write asks what the Host CLI can do. This Host offers nothing.
    if (command.includes('environment show')) return { stdout: '{}', stderr: '', exitCode: 0 };
    sent.push(command.replace("'/opt/bin/muxify' ", '').replace(` --topic '${ID}' --json`, ''));
    const refused = refuse.find((subcommand) => command.includes(subcommand));
    return refused === undefined
      ? { stdout: '{"changed":{}}', stderr: '', exitCode: 0 }
      : {
          stdout: JSON.stringify({ failed: { message: `no ${refused}` } }),
          stderr: '',
          exitCode: 1,
        };
  };
  return { exec, sent };
}

function save(on: ReturnType<typeof host>, saved: TopicFields, wanted: TopicFields) {
  const muxify = createMuxifyCli();
  return saveTopicEdit(saved, wanted, (change) => muxify.change(on.exec, ID, change, REQUEST));
}

describe('Save on the Edit sheet', () => {
  it('sends only the fields that changed', async () => {
    const on = host();

    const { saved, errors } = await save(on, ON_HOST, {
      ...ON_HOST,
      note: 'at step 4',
    });

    expect(on.sent).toEqual(["topic note 'at step 4'"]);
    expect(saved).toEqual({ ...ON_HOST, note: 'at step 4' });
    expect(errors).toEqual({});
  });

  it('sends nothing when nothing changed, and Tags in another order are no change', async () => {
    const on = host();

    await save(on, ON_HOST, { ...ON_HOST, tags: ['old', 'work'] });

    expect(on.sent).toEqual([]);
  });

  it('sends each changed field, once, in field order', async () => {
    const on = host();

    await save(on, ON_HOST, {
      title: 'Fix logout',
      note: null,
      tags: ['work'],
    });

    expect(on.sent).toEqual([
      "topic rename 'Fix logout'",
      'topic note --clear',
      "topic tag set 'work'",
    ]);
  });

  it('puts a refusal under its field, and a second Save sends only what still differs', async () => {
    const wanted: TopicFields = {
      title: 'Fix logout',
      note: 'at step 4',
      tags: ['work'],
    };
    const first = host(['topic note']);

    const partial = await save(first, ON_HOST, wanted);

    expect(first.sent).toEqual([
      "topic rename 'Fix logout'",
      "topic note 'at step 4'",
      "topic tag set 'work'",
    ]);
    expect(partial.errors).toEqual({ note: 'no topic note' });
    expect(partial.saved).toEqual({ ...wanted, note: ON_HOST.note });

    const second = host();
    const retry = await save(second, partial.saved, wanted);

    expect(second.sent).toEqual(["topic note 'at step 4'"]);
    expect(retry).toEqual({ saved: wanted, errors: {} });
  });
});

describe('what the user typed', () => {
  it('trims the title and the Note, and an empty Note is no Note', () => {
    expect(typedFields('  Fix login ', '   ', ['work'])).toEqual({
      title: 'Fix login',
      note: null,
      tags: ['work'],
    });
    expect(typedFields('Fix login', ' at step 3 ', [])).toMatchObject({
      note: 'at step 3',
    });
  });

  it('is no change when it matches the Host', () => {
    expect(changes(ON_HOST, typedFields(' Fix login', 'at step 3 ', ['work', 'old']))).toEqual([]);
  });
});

describe('the Topic route param of the Edit sheet', () => {
  it('gives back the fields', () => {
    expect(fieldsFromParam(fieldsParam(ON_HOST))).toEqual(ON_HOST);
    expect(fieldsFromParam(fieldsParam({ ...ON_HOST, note: null }))).toEqual({
      ...ON_HOST,
      note: null,
    });
  });

  it.each([
    undefined,
    'not json',
    'null',
    '{"title":1,"note":null,"tags":[]}',
    '{"title":"a","note":3,"tags":[]}',
    '{"title":"a","note":null,"tags":[1]}',
  ])('gives null for %p', (param) => {
    expect(fieldsFromParam(param)).toBeNull();
  });
});

it('stops at a write that the Host has in doubt, and says so', async () => {
  const sent: string[] = [];
  const write = async (change: { field: string }) => {
    sent.push(change.field);
    return { kind: 'unknown', message: 'The Request changed the records and did not finish.' } as const;
  };
  const wanted = { ...ON_HOST, title: 'Fix logout', note: 'new' };

  expect(await saveTopicEdit(ON_HOST, wanted, write)).toEqual({
    saved: ON_HOST, errors: {}, inDoubt: 'The Request changed the records and did not finish.',
  });
  expect(sent).toEqual(['title']);
});
