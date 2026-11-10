import inPlay from './__fixtures__/environment-in-play.json';
import list from './__fixtures__/environment-list.json';
import { parseEnvironment, type Card, type EnvironmentSnapshot } from './environment';

/** Every Topic card of a snapshot, in the order the phone draws them. */
function topicLabels(cards: Card[]): string[] {
  return cards.flatMap((card) => (card.kind === 'topic' ? [card.topic.label] : []));
}

describe('parsing what `environment show --json` said on the Mac', () => {
  it('keeps the in_play form: places with Open Places, Guests, the Bench, the Tags', () => {
    const snapshot = parseEnvironment(inPlay);

    expect(snapshot.tags.map((tag) => tag.name)).toEqual(['personal', 'work']);
    expect(snapshot.tags[0]?.color).toEqual({
      light: { kind: 'rgb', hex: '#5e8c6a' },
      dark: { kind: 'rgb', hex: '#7fa88a' },
    });
    expect(snapshot.sessions).toHaveLength(20);
    expect(snapshot.no_topic).toHaveLength(9);
    expect(topicLabels(snapshot.pinned)).toEqual(['Chief of Staff']);

    if (snapshot.unpinned.kind !== 'in_play') throw new Error('expected in_play');
    const { limit, places, guests, bench } = snapshot.unpinned;
    expect(limit).toBe(3);
    expect(places.map((card) => card.kind)).toEqual(['open_place', 'open_place', 'topic']);
    expect(places[0]).toEqual({ kind: 'open_place', id: 'cd69b134-6bd5-4290-a1c9-d1f1e95c8aa6' });
    expect(topicLabels(guests)).toEqual([
      'GS: Try a verification skill in poteto-mode',
      'Software Zavod: proposal overview',
    ]);
    expect(bench).toHaveLength(18);
    expect(bench.filter((card) => card.kind === 'topic' && card.topic.state === 'dormant')).toHaveLength(12);
    expect(topicLabels(bench)[0]).toBe('Membr: Chat statuses');
  });

  it('keeps the list form: the cards in the order they came', () => {
    const snapshot = parseEnvironment(list);

    if (snapshot.unpinned.kind !== 'list') throw new Error('expected list');
    expect(snapshot.unpinned.cards).toHaveLength(21);
    expect(topicLabels(snapshot.unpinned.cards).slice(0, 2)).toEqual([
      'Muxify Mobile: How do we make it work with topics also?',
      'GS: Try a verification skill in poteto-mode',
    ]);
    expect(snapshot.unpinned.cards.some((card) => card.kind === 'open_place')).toBe(false);
  });

  it('reads a Topic card with its Note, Tags, Sessions and mark', () => {
    const snapshot = parseEnvironment(inPlay);
    if (snapshot.unpinned.kind !== 'in_play') throw new Error('expected in_play');

    expect(snapshot.unpinned.places[2]).toEqual({
      kind: 'topic',
      mark: 'done',
      sessions: ['$45'],
      topic: {
        id: '498a023e-ff45-4724-b23a-1525fbc40408',
        label: 'Muxify Mobile: How do we make it work with topics also?',
        note: null,
        tags: ['personal'],
        state: 'live',
      },
    });
  });
});

/** The smallest answer the phone accepts, to put one odd card or value into. */
function snapshotWith(overrides: Record<string, unknown>): unknown {
  return {
    tags: [],
    sessions: [],
    pinned: [],
    unpinned: { kind: 'list', cards: [] },
    no_topic: [],
    ...overrides,
  };
}

const topicCard = (topic: Record<string, unknown>, mark: unknown = null) => ({
  kind: 'topic',
  mark,
  sessions: [],
  topic: { id: 't1', label: 'A Topic', note: null, tags: [], state: 'live', ...topic },
});

function onlyCard(snapshot: EnvironmentSnapshot): Card {
  if (snapshot.unpinned.kind !== 'list') throw new Error('expected list');
  const [card] = snapshot.unpinned.cards;
  if (!card) throw new Error('expected a card');
  return card;
}

describe('what a newer desktop Muxify may send', () => {
  it('turns a card kind it does not know into a plain card, and keeps the list', () => {
    const snapshot = parseEnvironment(
      snapshotWith({
        unpinned: {
          kind: 'list',
          cards: [{ kind: 'folder', mark: 'blocked', sessions: ['$1', '$2'] }, topicCard({})],
        },
      }),
    );

    if (snapshot.unpinned.kind !== 'list') throw new Error('expected list');
    expect(snapshot.unpinned.cards).toHaveLength(2);
    expect(snapshot.unpinned.cards[0]).toEqual({
      kind: 'unknown',
      sourceKind: 'folder',
      mark: 'blocked',
      sessions: ['$1', '$2'],
    });
    expect(snapshot.unpinned.cards[1]?.kind).toBe('topic');
  });

  it('turns a mark it does not know into no mark', () => {
    const snapshot = parseEnvironment(
      snapshotWith({ unpinned: { kind: 'list', cards: [topicCard({}, 'sparkling')] } }),
    );

    expect(onlyCard(snapshot)).toMatchObject({ kind: 'topic', mark: null });
  });

  it('turns a Topic state it does not know into live, so no card claims "No live Sessions"', () => {
    const snapshot = parseEnvironment(
      snapshotWith({ unpinned: { kind: 'list', cards: [topicCard({ state: 'settled' })] } }),
    );

    expect(onlyCard(snapshot)).toMatchObject({ topic: { state: 'live' } });
  });

  it('keeps an Empty Topic and a Locked Session', () => {
    const snapshot = parseEnvironment(
      snapshotWith({
        unpinned: {
          kind: 'list',
          cards: [topicCard({ state: 'empty' }), { kind: 'session', mark: 'unread', sessions: ['$3'] }],
        },
      }),
    );

    if (snapshot.unpinned.kind !== 'list') throw new Error('expected list');
    expect(snapshot.unpinned.cards[0]).toMatchObject({ topic: { state: 'empty' } });
    expect(snapshot.unpinned.cards[1]).toEqual({ kind: 'session', mark: 'unread', sessions: ['$3'] });
  });
});

describe('a Tag colour', () => {
  const colorOf = (light: string, dark = light) =>
    parseEnvironment(snapshotWith({ tags: [{ name: 'work', color: { light, dark } }] })).tags[0]
      ?.color;

  it.each([
    ['a system colour name', 'orange', { kind: 'system', name: 'orange' }],
    ['a system colour name in another case, with spaces', ' Teal ', { kind: 'system', name: 'teal' }],
    ['a #rrggbb value, kept in lower case', '#5E8C6A', { kind: 'rgb', hex: '#5e8c6a' }],
  ])('reads %s', (_name, text, color) => {
    expect(colorOf(text)).toEqual({ light: color, dark: color });
  });

  it.each([['a name it does not know', 'chartreuse'], ['a short hex value', '#abc'], ['no #', '5e8c6a']])(
    'turns %s into no colour, and keeps the other appearance',
    (_name, text) => {
      expect(colorOf(text, 'blue')).toEqual({ light: null, dark: { kind: 'system', name: 'blue' } });
    },
  );
});

describe('a shape it cannot use', () => {
  it.each([
    ['not an object', 'nope', 'environment: expected an object'],
    ['no sessions array', snapshotWith({ sessions: undefined }), 'sessions: expected an array'],
    [
      'a Topic card with no Topic',
      snapshotWith({ pinned: [{ kind: 'topic', mark: null, sessions: [] }] }),
      'pinned[0].topic: expected an object',
    ],
    [
      'an unpinned form it does not know',
      snapshotWith({ unpinned: { kind: 'carousel' } }),
      'unpinned.kind',
    ],
  ])('fails with the path of the problem: %s', (_name, json, message) => {
    expect(() => parseEnvironment(json)).toThrow(message);
  });
});

it('keeps optional Window seeds and tolerates new marks', () => {
  const original = parseEnvironment(list);
  expect(original.sessions[0].windows).toBeNull();
  const input = JSON.parse(JSON.stringify(list));
  input.sessions[0].windows = [
    { id: '@8', index: 2, name: 'editor', active: true, mark: 'working' },
    { id: '@9', index: 4, name: 'logs', active: false, mark: 'future-mark' },
  ];
  expect(parseEnvironment(input).sessions[0].windows).toEqual([
    { id: '@8', index: 2, name: 'editor', active: true, mark: 'working' },
    { id: '@9', index: 4, name: 'logs', active: false, mark: null },
  ]);
  input.sessions[0].windows = [];
  expect(parseEnvironment(input).sessions[0].windows).toEqual([]);
  input.sessions[0].windows = [{ id: '@8', index: 2, name: 'editor', active: 'yes', mark: null }];
  expect(() => parseEnvironment(input)).toThrow('sessions[0].windows[0].active');
});
