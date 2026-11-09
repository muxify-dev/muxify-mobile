import dormant from './__fixtures__/topic-dormant.json';
import live from './__fixtures__/topic-live.json';
import type { Card, SessionId, TopicId } from './environment';
import {
  loadingTopic,
  parseTopicDetail,
  seededTopic,
  settledTopic,
  topicSeedFromParam,
  topicSeedParam,
  topicStartingFrom,
  TOPIC_UNASKED,
  type TopicDetail,
} from './topic-detail';

/** An answer with one Session whose Windows hold the Agents given, one Pane each. */
function withAgents(windows: (Record<string, unknown> | null)[][]) {
  return {
    topic: {
      id: 't1',
      label: 'Fix login',
      note: 'Repro with seed 4411',
      tags: ['backend', 'ux'],
      state: 'live',
      sessions: [
        {
          id: '$1',
          name: 'gs/fix-login',
          windows: windows.map((agents, w) => ({
            id: `@${w}`,
            index: w + 1,
            name: `w${w}`,
            panes: agents.map((agent, p) => ({ id: `%${w}${p}`, agent })),
          })),
        },
      ],
    },
  };
}

describe('parsing what `topic show --json` said on the Mac', () => {
  it('keeps a live Topic with its Session, Windows and the Agent mark', () => {
    const topic = parseTopicDetail(live);

    expect(topic).toEqual<TopicDetail>({
      id: 'eb367a1f-687b-43af-9679-e27f28ad7141' as TopicDetail['id'],
      label: 'GS: Try a verification skill in poteto-mode',
      note: null,
      tags: [],
      state: 'live',
      sessions: [
        {
          id: '$47' as TopicDetail['sessions'][number]['id'],
          name: 'game_server/main/gs-try-a-verification-skill',
          windows: [{ id: '@61', index: 1, name: 'zsh', mark: 'done' }],
        },
      ],
    });
  });

  it('keeps a Dormant Topic, which has no Sessions', () => {
    const topic = parseTopicDetail(dormant);

    expect(topic.state).toBe('dormant');
    expect(topic.sessions).toEqual([]);
  });

  it('keeps the Note, the Tags and the order of the Windows', () => {
    const topic = parseTopicDetail(withAgents([[], [], []]));

    expect(topic.note).toBe('Repro with seed 4411');
    expect(topic.tags).toEqual(['backend', 'ux']);
    expect(topic.sessions[0]?.windows?.map((window) => window.index)).toEqual([1, 2, 3]);
  });

  it('marks each Window with its strongest Agent, as the Mac does', () => {
    const topic = parseTopicDetail(
      withAgents([
        [{ status: 'working' }, { status: 'done', unread: true }],
        [{ status: 'blocked', unread: false }, { status: 'failed', unread: true }],
        [{ status: 'done', unread: false }, { status: 'failed', unread: false }, null],
        [{ status: 'thinking' }, {}],
      ]),
    );

    expect(topic.sessions[0]?.windows?.map((window) => window.mark)).toEqual([
      'done',
      'blocked',
      null,
      null,
    ]);
  });

  it('throws with the path of the first thing that is wrong', () => {
    const answer = withAgents([[]]);
    (answer.topic.sessions[0] as Record<string, unknown>).windows = 'none';

    expect(() => parseTopicDetail(answer)).toThrow('topic.sessions[0].windows: expected an array');
  });
});

describe('what the Topic Screen holds', () => {
  const shown = { kind: 'shown', topic: parseTopicDetail(live) } as const;

  it('keeps the last answer while it reads again', () => {
    expect(loadingTopic(shown)).toEqual({ kind: 'loading', last: shown.topic });
  });

  it('keeps the last answer under a failed read', () => {
    const failed = settledTopic(loadingTopic(shown), { kind: 'failed', error: 'Connection lost' });

    expect(failed).toEqual({ kind: 'failed', error: 'Connection lost', last: shown.topic });
  });

  it('has nothing to show before the first answer', () => {
    expect(settledTopic(TOPIC_UNASKED, { kind: 'failed', error: 'x' })).toEqual({
      kind: 'failed',
      error: 'x',
      last: null,
    });
  });
});

describe('the seed: what the Host Screen already read about a Topic', () => {
  const sid = (id: string) => id as SessionId;
  const card: Extract<Card, { kind: 'topic' }> = {
    kind: 'topic',
    mark: null,
    sessions: [sid('$2'), sid('$9'), sid('$1')],
    topic: {
      id: 't1' as TopicId,
      label: 'Fix login',
      note: 'Repro with seed 4411',
      tags: ['backend'],
      state: 'live',
    },
  };
  const names = new Map([
    [sid('$1'), 'gs/fix-login'],
    [sid('$2'), 'gs/web'],
  ]);

  it('has the card’s title, Note, Tags, state and Sessions in card order, with no Windows read yet', () => {
    expect(seededTopic(card, names)).toEqual<TopicDetail>({
      id: 't1' as TopicId,
      label: 'Fix login',
      note: 'Repro with seed 4411',
      tags: ['backend'],
      state: 'live',
      sessions: [
        { id: sid('$2'), name: 'gs/web', windows: null },
        { id: sid('$1'), name: 'gs/fix-login', windows: null },
      ],
    });
  });

  it('goes through a route param and back unchanged', () => {
    const seed = seededTopic(card, names);
    expect(topicSeedFromParam(topicSeedParam(seed))).toEqual(seed);
  });

  it('is no seed for a param that is missing or does not decode', () => {
    expect(topicSeedFromParam(undefined)).toBeNull();
    expect(topicSeedFromParam('not json')).toBeNull();
    expect(topicSeedFromParam(JSON.stringify({ label: 3 }))).toBeNull();
  });

  it('starts the screen with the seed on it while the read is in flight', () => {
    const seed = seededTopic(card, names);
    expect(topicStartingFrom(seed)).toEqual({ kind: 'loading', last: seed });
    expect(topicStartingFrom(null)).toEqual(TOPIC_UNASKED);
  });

  it('gives way to the read, and stays under a failed one', () => {
    const seed = seededTopic(card, names);
    const read = parseTopicDetail(live);

    expect(settledTopic(topicStartingFrom(seed), { kind: 'shown', topic: read })).toEqual({
      kind: 'shown',
      topic: read,
    });
    expect(settledTopic(topicStartingFrom(seed), { kind: 'failed', error: 'x' })).toEqual({
      kind: 'failed',
      error: 'x',
      last: seed,
    });
  });
});
