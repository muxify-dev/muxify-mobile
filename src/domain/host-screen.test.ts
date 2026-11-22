import { answered, asking, HOST_PROBLEM, refused, UNASKED, type Listing } from './host-listing';
import {
  firstReadAnswered,
  hostScreen,
  hostScreenTabs,
  runningSessions,
  tabOnShow,
  topicSections,
  type AttachPlace,
  type HostScreenRow,
  type HostScreenSection,
  type OpenableRow,
} from './host-screen';
import type { Session } from '@/tmux/tmux-client';
import type { SessionOnHost } from '@/topics/tmux-order';
import type { CardSection } from '@/topics/topic-action';
import type {
  BoardSessionId,
  Card,
  EnvironmentSnapshot,
  Mark,
  SessionId,
  TopicId,
  TopicState,
  Unpinned,
} from '@/topics/environment';
import inPlayFixture from '@/topics/__fixtures__/environment-in-play.json';
import { parseEnvironment } from '@/topics/environment';
import type { HostCliOutcome, HostCliState } from '@/topics/host-cli-install';
import {
  lastSnapshot,
  listedSessions,
  TOPICS_UNASKED,
  withHostCli,
  type HostTopics,
} from '@/topics/host-topics';

const running = (name: string, windowCount = 1): Session => ({ name, windowCount });

const sessionRow = (name: string, topicLabel: string | null = null, windowCount?: number, onHost?: SessionOnHost): HostScreenRow =>
  ({ kind: 'session', name, windowCount, topicLabel, ...(onHost === undefined ? {} : { onHost }) });
const note = (text: string) => ({ kind: 'note', text }) as const;

const INSTALL_RUNNING: HostCliState = { kind: 'running' };
const installDone = (kind: HostCliOutcome, text: string): HostCliState => ({
  kind: 'done',
  result: { kind, text, line: kind === 'failed' || kind === 'skipped' ? `${kind}: ${text}` : `${kind} ${text}` },
});

const topicsSection = (...rows: HostScreenRow[]): HostScreenSection => ({ id: 'topics', title: 'Board', rows });
const sessionsSection = (...rows: HostScreenRow[]): HostScreenSection => ({ id: 'sessions', title: null, rows });

// What the Board list shows before the Host has answered about Topics.
const TOPICS = topicsSection({ kind: 'checking', text: 'Checking Topics…' });

interface TopicsCase {
  name: string;
  topics: HostTopics;
  attach?: AttachPlace | null;
  opened?: ReadonlySet<OpenableRow>;
  appearance?: 'light' | 'dark';
  sections: HostScreenSection[];
}

const sid = (id: string) => id as SessionId;
const tid = (id: string) => id as TopicId;

const liveBoardSession = (session: string, name: string, section: CardSection, mark: Mark | null = null): HostScreenRow =>
  ({ kind: 'board-session', card: { kind: 'live-session', session: sid(session) }, name, mark, pinned: section === 'pinned', section });
const dormantBoardSession = (id: string, name: string, section: CardSection): HostScreenRow =>
  ({ kind: 'board-session', card: { kind: 'dormant-session', id: id as BoardSessionId }, name, mark: null, pinned: section === 'pinned', section });

const topicCard = (
  id: string,
  over: {
    state?: TopicState;
    mark?: Mark | null;
    note?: string | null;
    tags?: string[];
    sessions?: SessionId[];
  } = {},
): Card => ({
  kind: 'topic',
  mark: over.mark ?? null,
  sessions: over.sessions ?? [],
  topic: {
    id: tid(id),
    label: `Topic ${id}`,
    note: over.note ?? null,
    tags: over.tags ?? [],
    state: over.state ?? 'live',
  },
});

const topicRow = (
  id: string,
  over: Partial<Extract<HostScreenRow, { kind: 'topic' }>> = {},
): HostScreenRow => ({
  kind: 'topic',
  id: tid(id),
  label: `Topic ${id}`,
  note: null,
  tags: [],
  mark: null,
  pinned: false,
  section: 'in-play',
  dimmed: false,
  // The seed's content is checked once, below, and in topic-detail.test.ts.
  seed: expect.objectContaining({ id: tid(id) }) as Extract<HostScreenRow, { kind: 'topic' }>['seed'],
  ...over,
});

const snapshotSession = (id: string, name: string, topic: string | null) => ({
  id: sid(id),
  name,
  activity: 0,
  mark: null,
  topic: topic === null ? null : tid(topic),
  windows: null,
});

function snapshot(over: Partial<EnvironmentSnapshot> = {}): EnvironmentSnapshot {
  return {
    sidebar: null,
    tags: [],
    sessions: [],
    pinned: [],
    unpinned: inPlay({ places: [] }),
    no_topic: [],
    ...over,
  };
}

const listed = (over: Partial<EnvironmentSnapshot>): HostTopics => ({
  kind: 'listed',
  snapshot: snapshot(over),
});

const CLOSED = new Set<OpenableRow>();

const section = (
  id: HostScreenSection['id'],
  title: string | null,
  ...rows: HostScreenRow[]
): HostScreenSection => ({ id, title, rows });

const inPlaySection = (...rows: HostScreenRow[]): HostScreenSection => section('in-play', 'In Play', ...rows);

const OPEN_PLACE: Card = { kind: 'open_place', id: 'open1' };
const OPEN_PLACE_ROW: HostScreenRow = { kind: 'open-place', id: 'open1' };

/** An In Play answer with one Open Place and nothing else, unless told. */
const inPlay = (over: Partial<Unpinned> = {}): Unpinned => ({
  limit: 3,
  places: [OPEN_PLACE],
  guests: [],
  bench: [],
  ...over,
});

// `odd` has a colour the phone cannot read. `gone` is a Tag the Config no
// longer defines, which a Topic record can still hold.
const TAGS: EnvironmentSnapshot['tags'] = [
  { name: 'work', color: { light: { kind: 'system', name: 'orange' }, dark: { kind: 'system', name: 'orange' } } },
  { name: 'ui', color: { light: { kind: 'rgb', hex: '#112233' }, dark: { kind: 'system', name: 'blue' } } },
  { name: 'odd', color: { light: null, dark: null } },
];
// The Topic's own order, which the Mac does not draw in.
const TAG_NAMES = ['gone', 'ui', 'odd', 'work'];

describe('the Board tab of the Host Screen', () => {
  it.each<TopicsCase>([
    {
      name: 'puts the Pinned cards in their own section, and the places in the order they came',
      topics: listed({
        pinned: [topicCard('p')],
        unpinned: inPlay({ places: [topicCard('z'), topicCard('a')] }),
      }),
      sections: [
        section('pinned', 'Pinned', topicRow('p', { pinned: true, section: 'pinned' })),
        inPlaySection(topicRow('z'), topicRow('a')),
      ],
    },
    {
      name: 'with In Play, draws Pinned, the places, the Guests, then a closed Bench row',
      topics: listed({
        pinned: [topicCard('p')],
        unpinned: inPlay({
          places: [topicCard('place'), OPEN_PLACE],
          guests: [topicCard('guest')],
          bench: [topicCard('b1'), topicCard('b2')],
        }),
      }),
      sections: [
        section('pinned', 'Pinned', topicRow('p', { pinned: true, section: 'pinned' })),
        section('in-play', 'In Play', topicRow('place', { section: 'in-play' }), { kind: 'open-place', id: 'open1' }),
        section('guests', 'Guests', topicRow('guest', { section: 'guests' })),
        section('bench', null, { kind: 'bench', opened: false }),
      ],
    },
    {
      name: 'opens the Bench row into its cards, in the order they came',
      topics: listed({ unpinned: inPlay({ bench: [topicCard('b2'), topicCard('b1')] }) }),
      opened: new Set<OpenableRow>(['bench']),
      sections: [
        section('in-play', 'In Play', OPEN_PLACE_ROW),
        section('bench', null, { kind: 'bench', opened: true }, topicRow('b2', { section: 'bench' }), topicRow('b1', { section: 'bench' })),
      ],
    },
    {
      name: 'with In Play, leaves out an empty Pinned, Guests and Bench, and keeps the Open Places',
      topics: listed({ unpinned: inPlay({ places: [OPEN_PLACE, OPEN_PLACE] }) }),
      sections: [section('in-play', 'In Play', OPEN_PLACE_ROW, OPEN_PLACE_ROW)],
    },
    {
      name: 'gives No Topic its own section after the Bench',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null)],
        unpinned: inPlay({ bench: [topicCard('b1')] }),
        no_topic: [sid('$1')],
      }),
      sections: [
        section('in-play', 'In Play', OPEN_PLACE_ROW),
        section('bench', null, { kind: 'bench', opened: false }),
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: false }),
      ],
    },
    {
      name: 'with In Play, shows the error of a failed read above the first section',
      topics: {
        kind: 'failed',
        error: 'muxify exited with status 1',
        last: snapshot({ pinned: [topicCard('p')], unpinned: inPlay() }),
      },
      sections: [
        section(
          'pinned',
          'Pinned',
          { kind: 'refused', message: 'muxify exited with status 1' },
          topicRow('p', { pinned: true, section: 'pinned' }),
        ),
        section('in-play', 'In Play', OPEN_PLACE_ROW),
      ],
    },
    {
      name: 'draws the Tags in Config order, in their light colours, and an undefined one last',
      topics: listed({ tags: TAGS, unpinned: inPlay({ places: [topicCard('t1', { tags: TAG_NAMES })] }) }),
      sections: [
        inPlaySection(
          topicRow('t1', {
            tags: [
              { name: 'work', color: '#ff9500' },
              { name: 'ui', color: '#112233' },
              { name: 'odd', color: null },
              { name: 'gone', color: null },
            ],
          }),
        ),
      ],
    },
    {
      name: 'draws each Tag in the dark colour of its Config entry in dark appearance',
      appearance: 'dark',
      topics: listed({ tags: TAGS, unpinned: inPlay({ places: [topicCard('t1', { tags: TAG_NAMES })] }) }),
      sections: [
        inPlaySection(
          topicRow('t1', {
            tags: [
              { name: 'work', color: '#ff9f0a' },
              { name: 'ui', color: '#0a84ff' },
              { name: 'odd', color: null },
              { name: 'gone', color: null },
            ],
          }),
        ),
      ],
    },
    {
      name: 'shows the label, the Note and the mark of a Topic, and dims a Dormant and an Empty one',
      topics: listed({
        unpinned: inPlay({
          places: [
            topicCard('live', { note: 'Repro with seed 4411', mark: 'blocked' }),
            topicCard('sleeping', { state: 'dormant' }),
            topicCard('blank', { state: 'empty' }),
          ],
        }),
      }),
      sections: [
        inPlaySection(
          topicRow('live', { note: 'Repro with seed 4411', mark: 'blocked' }),
          topicRow('sleeping', { dimmed: true }),
          topicRow('blank', { dimmed: true }),
        ),
      ],
    },
    {
      name: 'draws a live Board Session as its own card, named from the snapshot, and pinned when it is',
      topics: listed({
        sessions: [snapshotSession('$1', 'scratch', null), snapshotSession('$2', 'notes', null), snapshotSession('$3', 'logs', null)],
        pinned: [{ kind: 'session', mark: 'unread', sessions: [sid('$2')] }],
        unpinned: inPlay({
          places: [{ kind: 'session', mark: null, sessions: [sid('$1')] }],
          guests: [{ kind: 'session', mark: null, sessions: [sid('$3')] }],
        }),
      }),
      sections: [
        section('pinned', 'Pinned', liveBoardSession('$2', 'notes', 'pinned', 'unread')),
        inPlaySection(liveBoardSession('$1', 'scratch', 'in-play')),
        section('guests', 'Guests', liveBoardSession('$3', 'logs', 'guests')),
      ],
    },
    {
      name: 'draws a Dormant Board Session at its place by its name, with no live Session behind it',
      topics: listed({
        pinned: [{ kind: 'dormant_session', id: 's4' as BoardSessionId, name: 'logs' }],
        unpinned: inPlay({
          places: [{ kind: 'dormant_session', id: 's2' as BoardSessionId, name: 'scratch' }],
          guests: [{ kind: 'dormant_session', id: 's1' as BoardSessionId, name: 'notes' }],
        }),
      }),
      sections: [
        section('pinned', 'Pinned', dormantBoardSession('s4', 'logs', 'pinned')),
        inPlaySection(dormantBoardSession('s2', 'scratch', 'in-play')),
        section('guests', 'Guests', dormantBoardSession('s1', 'notes', 'guests')),
      ],
    },
    {
      name: 'draws a card it does not know as a plain row: its Session names, else its kind',
      topics: listed({
        sessions: [snapshotSession('$1', 'one', null), snapshotSession('$2', 'two', null)],
        unpinned: inPlay({
          places: [
            { kind: 'unknown', sourceKind: 'folder', mark: null, sessions: [sid('$1'), sid('$2')] },
            { kind: 'unknown', sourceKind: 'banner', mark: null, sessions: [] },
          ],
        }),
      }),
      sections: [
        inPlaySection({ kind: 'unknown-card', text: 'one, two' }, { kind: 'unknown-card', text: 'banner' }),
      ],
    },
    {
      name: 'gives a Topic row the card and its Sessions before the Attach reads the Topic',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', 't1'), snapshotSession('$2', 'work', 't1')],
        unpinned: inPlay({
          places: [topicCard('t1', { note: 'Repro', tags: ['work'], sessions: [sid('$2'), sid('$1')] })],
        }),
      }),
      sections: [
        inPlaySection(
          topicRow('t1', {
            note: 'Repro',
            tags: [{ name: 'work', color: null }],
            seed: {
              id: tid('t1'),
              label: 'Topic t1',
              note: 'Repro',
              tags: ['work'],
              state: 'live',
              sessions: [
                { id: sid('$2'), name: 'work', windows: null },
                { id: sid('$1'), name: 'cook', windows: null },
              ],
            },
          }),
        ),
      ],
    },
    {
      name: 'ends the list with one closed No Topic row',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null), snapshotSession('$2', 'work', 't1')],
        unpinned: inPlay({ places: [topicCard('t1')] }),
        no_topic: [sid('$1')],
      }),
      sections: [
        inPlaySection(topicRow('t1')),
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: false }),
      ],
    },
    {
      name: 'opens the No Topic row into plain Session rows, in the order they came',
      topics: listed({
        sessions: [snapshotSession('$1', 'zeta', null), snapshotSession('$2', 'alpha', null)],
        unpinned: inPlay({ places: [topicCard('t1')] }),
        no_topic: [sid('$1'), sid('$2')],
      }),
      opened: new Set<OpenableRow>(['no-topic']),
      sections: [
        inPlaySection(topicRow('t1')),
        section(
          'no-topic',
          null,
          { kind: 'no-topic', count: 2, opened: true },
          sessionRow('zeta'),
          sessionRow('alpha'),
        ),
      ],
    },
    {
      name: 'has no No Topic row when every Session is in a Topic',
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1')],
        unpinned: inPlay({ places: [topicCard('t1')] }),
      }),
      sections: [inPlaySection(topicRow('t1'))],
    },
    {
      name: 'shows only the No Topic section when the list has no Topic cards',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null)],
        no_topic: [sid('$1')],
      }),
      sections: [section('no-topic', null, { kind: 'no-topic', count: 1, opened: false })],
    },
    {
      name: 'opens No Topic separately while the Bench stays closed',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null)],
        unpinned: inPlay({ bench: [topicCard('b1')] }),
        no_topic: [sid('$1')],
      }),
      opened: new Set<OpenableRow>(['no-topic']),
      sections: [
        section('in-play', 'In Play', OPEN_PLACE_ROW),
        section('bench', null, { kind: 'bench', opened: false }),
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: true }, sessionRow('cook')),
      ],
    },
    {
      name: 'says so when the Host has no Topics at all',
      topics: listed({}),
      sections: [inPlaySection(note('No Topics yet.'))],
    },
    {
      name: 'shows a check while the first read of Topics is in flight',
      topics: { kind: 'loading', last: null },
      sections: [TOPICS],
    },
    {
      name: 'draws the last snapshot while it reads again',
      topics: { kind: 'loading', last: snapshot({ unpinned: inPlay({ places: [topicCard('t1')] }) }) },
      sections: [inPlaySection(topicRow('t1'))],
    },
    {
      name: 'says there are no Topics on a Host with no Host CLI',
      topics: { kind: 'absent' },
      sections: [topicsSection(note('No Topics on this Host'))],
    },
    {
      name: 'says the Host CLI is being installed on a Host with none',
      topics: withHostCli({ kind: 'absent' }, INSTALL_RUNNING),
      sections: [topicsSection({ kind: 'checking', text: 'Installing Muxify on this Host…' })],
    },
    {
      name: 'says a Host CLI too old for a Host Server is being updated, with nothing under it',
      topics: withHostCli({ kind: 'unavailable', host: 'Mac', reason: 'x' }, INSTALL_RUNNING),
      sections: [topicsSection({ kind: 'checking', text: 'Updating Muxify on this Host…' })],
    },
    {
      name: 'says why the Host CLI could not be installed on a Host with none',
      topics: withHostCli({ kind: 'absent' }, installDone('failed', 'neither curl nor wget')),
      sections: [
        topicsSection({
          kind: 'refused',
          message: 'Could not install Muxify on this Host: neither curl nor wget',
        }),
      ],
    },
    {
      name: 'shows the Topics pushed after the install put a Host CLI there',
      topics: withHostCli(
        { kind: 'listed', snapshot: snapshot({ unpinned: inPlay({ places: [topicCard('t1')] }) }) },
        installDone('installed', 'abc1234 1760000000'),
      ),
      sections: [inPlaySection(topicRow('t1'))],
    },
    ...(['current', 'kept', 'skipped'] as const).flatMap((outcome) => [
      {
        name: `says there are no Topics on a Host with no Host CLI after an install that answered ${outcome}`,
        topics: withHostCli({ kind: 'absent' }, installDone(outcome, 'x')),
        sections: [topicsSection(note('No Topics on this Host'))],
      },
    ]),
    {
      name: 'shows the error of a failed read, and nothing under it without a last snapshot',
      topics: { kind: 'failed', error: 'muxify exited with status 1', last: null },
      sections: [topicsSection({ kind: 'refused', message: 'muxify exited with status 1' })],
    },
    {
      name: 'shows the error of a failed read above the last snapshot',
      topics: {
        kind: 'failed',
        error: 'muxify exited with status 1',
        last: snapshot({ unpinned: inPlay({ places: [topicCard('t1')] }) }),
      },
      sections: [
        inPlaySection({ kind: 'refused', message: 'muxify exited with status 1' }, topicRow('t1')),
      ],
    },
  ])('$name', ({ topics, attach = null, opened = CLOSED, appearance = 'light', sections }) => {
    expect(hostScreen({ tab: 'board', listing: UNASKED, topics, attach, opened, appearance, problem: null })).toEqual(sections);
  });
});

describe('the Host Screen, against the snapshot `environment show` gave on the Mac', () => {
  const mac = parseEnvironment(inPlayFixture);

  it('draws the sections and cards in the order the Mac sent them', () => {
    const sections = hostScreen({
      tab: 'board',
      listing: UNASKED,
      attach: null,
      topics: { kind: 'listed', snapshot: mac },
      opened: new Set<OpenableRow>(['bench']),
      appearance: 'dark',
      problem: null,
    });
    const ids = (cards: Card[]) => cards.map((card) => (card.kind === 'topic' ? card.topic.id : card.kind));
    const rowIds = (rows: HostScreenRow[]) =>
      rows.flatMap((row) => (row.kind === 'topic' ? [row.id] : row.kind === 'open-place' ? ['open_place'] : []));

    expect(sections.map((shown) => shown.id)).toEqual(['pinned', 'in-play', 'guests', 'bench', 'no-topic']);
    expect(sections.map((shown) => shown.title)).toEqual(['Pinned', 'In Play', 'Guests', null, null]);
    expect(rowIds(sections[0]?.rows ?? [])).toEqual(ids(mac.pinned));
    expect(rowIds(sections[1]?.rows ?? [])).toEqual(ids(mac.unpinned.places));
    expect(rowIds(sections[2]?.rows ?? [])).toEqual(ids(mac.unpinned.guests));
    expect(rowIds(sections[3]?.rows ?? [])).toEqual(ids(mac.unpinned.bench));
    expect(sections[1]?.rows[2]).toMatchObject({ tags: [{ name: 'personal', color: '#7fa88a' }] });
  });

  it('lists every Session on the Sessions tab, in the order `environment show` gave', () => {
    const [sessions] = hostScreen({
      tab: 'sessions',
      listing: answered(listedSessions(mac)),
      topics: { kind: 'listed', snapshot: mac },
      attach: null,
      opened: CLOSED,
      appearance: 'light',
      problem: null,
    });

    expect(sessions?.rows.map((row) => ('name' in row ? row.name : row.kind))).toEqual(mac.sessions.map((session) => session.name));
  });
});

describe('topicSections, the Topics a list of Sessions shows under itself', () => {
  const mac = parseEnvironment(inPlayFixture);

  it('lists every Topic of the Host, the Bench too, and no Session or place', () => {
    const topicIds = (cards: Card[]) => cards.flatMap((card) => (card.kind === 'topic' ? [card.topic.id] : []));
    const sections = topicSections({ kind: 'listed', snapshot: mac }, 'dark');
    const rows = sections.flatMap((section) => section.rows);

    expect(rows.every((row) => row.kind === 'topic')).toBe(true);
    expect(rows.flatMap((row) => (row.kind === 'topic' ? [row.id] : []))).toEqual(
      topicIds([...mac.pinned, ...mac.unpinned.places, ...mac.unpinned.guests, ...mac.unpinned.bench]),
    );
    expect(sections.every((section) => section.title !== null)).toBe(true);
  });

  it('says why there are no Topics', () => {
    expect(topicSections(TOPICS_UNASKED, 'dark').flatMap((section) => section.rows)).toHaveLength(1);
    expect(topicSections({ kind: 'failed', error: 'no route', last: null }, 'dark')[0]?.rows).toEqual([
      { kind: 'refused', message: 'no route' },
    ]);
  });
});

describe('firstReadAnswered, which the Host Screen waits for before it draws the Host', () => {
  const listed: HostTopics = { kind: 'listed', snapshot: parseEnvironment(inPlayFixture) };

  it.each<{ name: string; listing: Listing; topics: HostTopics; answered: boolean }>([
    { name: 'waits while the first read is in flight', listing: UNASKED, topics: TOPICS_UNASKED, answered: false },
    { name: 'waits for the Topics, which say the tabs', listing: answered([running('main')]), topics: TOPICS_UNASKED, answered: false },
    { name: 'draws once both have answered', listing: answered([running('main')]), topics: listed, answered: true },
    { name: 'draws a Host with no Host CLI', listing: answered([running('main')]), topics: { kind: 'absent' }, answered: true },
    { name: 'does not wait again on a later read', listing: asking(answered([running('main')])), topics: { kind: 'loading', last: parseEnvironment(inPlayFixture) }, answered: true },
    { name: 'takes a refusal as the answer', listing: refused('This Host is no longer saved.'), topics: TOPICS_UNASKED, answered: true },
  ])('$name', ({ listing, topics, answered: expected }) => {
    expect(firstReadAnswered({ listing, topics })).toBe(expected);
  });
});

describe('the tabs of the Host Screen', () => {
  const withSidebar = (sidebar: EnvironmentSnapshot['sidebar']) => listed({ sidebar });

  it.each<{ name: string; topics: HostTopics; tabs: string[] }>([
    { name: 'shows both for a Host CLI that does not say', topics: withSidebar(null), tabs: ['board', 'sessions'] },
    { name: 'shows both when the Config has both on', topics: withSidebar({ topics: true, sessions: true }), tabs: ['board', 'sessions'] },
    { name: 'shows only the Board when the Config has Sessions off', topics: withSidebar({ topics: true, sessions: false }), tabs: ['board'] },
    { name: 'shows only Sessions when the Config has Topics off', topics: withSidebar({ topics: false, sessions: true }), tabs: ['sessions'] },
    { name: 'shows both when the Config has both off, which leaves no view', topics: withSidebar({ topics: false, sessions: false }), tabs: ['board', 'sessions'] },
    { name: 'shows only Sessions on a Host with no Host CLI', topics: { kind: 'absent' }, tabs: ['sessions'] },
    { name: 'shows only Sessions while the Host CLI is installed', topics: { kind: 'installing' }, tabs: ['sessions'] },
    { name: 'shows only Sessions while an old Host CLI is updated', topics: { kind: 'updating', last: snapshot() }, tabs: ['sessions'] },
    { name: 'shows only Sessions when the Topics read failed and there is no snapshot', topics: { kind: 'failed', error: 'no route', last: null }, tabs: ['sessions'] },
    { name: 'keeps the tabs of the last snapshot through a failed read', topics: { kind: 'failed', error: 'no route', last: snapshot() }, tabs: ['board', 'sessions'] },
    { name: 'keeps the tabs of the last snapshot while it reads again', topics: { kind: 'loading', last: lastSnapshot(withSidebar({ topics: true, sessions: false })) }, tabs: ['board'] },
  ])('$name', ({ topics, tabs }) => {
    expect(hostScreenTabs(topics)).toEqual(tabs);
  });

  it('opens on the tab the user last chose on this Host, when it is on show', () => {
    expect(tabOnShow('sessions', ['board', 'sessions'])).toBe('sessions');
    expect(tabOnShow(undefined, ['board', 'sessions'])).toBe('board');
    expect(tabOnShow('board', ['sessions'])).toBe('sessions');
  });
});

describe('the Sessions tab of the Host Screen', () => {
  const sessions = (listing: Listing, topics: HostTopics) =>
    hostScreen({ tab: 'sessions', listing, topics, attach: null, opened: CLOSED, appearance: 'light', problem: null });
  const withTopics = listed({
    sessions: [
      { ...snapshotSession('$1', 'zeta', 't1'), windows: [] },
      snapshotSession('$2', 'alpha', null),
      snapshotSession('$3', 'benched', 'b1'),
    ],
    unpinned: inPlay({ places: [topicCard('t1')], bench: [topicCard('b1')] }),
    no_topic: [sid('$2')],
  });

  it('lists every running Session in the order of the Listing, with its Topic under the name, and no Bench', () => {
    expect(sessions(answered([running('zeta', 3), running('alpha'), running('benched', 2)]), withTopics)).toEqual([
      sessionsSection(
        sessionRow('zeta', 'Topic t1', 3, { id: sid('$1'), inTopic: true }),
        sessionRow('alpha', 'No Topic', 1, { id: sid('$2'), inTopic: false }),
        sessionRow('benched', 'Topic b1', 2, { id: sid('$3'), inTopic: true }),
      ),
    ]);
  });

  it('says nothing about Topics for a Session the Host has not placed, or on a Host with none', () => {
    expect(sessions(answered([running('new')]), withTopics)).toEqual([sessionsSection(sessionRow('new', null, 1))]);
    expect(sessions(answered([running('main', 2)]), { kind: 'absent' })).toEqual([sessionsSection(sessionRow('main', null, 2))]);
  });

  it('counts the Windows from the snapshot when the Listing came from it', () => {
    const topics = listed({ sessions: [{ ...snapshotSession('$1', 'main', null), windows: [
      { id: '@1', index: 0, name: 'zsh', active: true, mark: null },
      { id: '@2', index: 1, name: 'vim', active: false, mark: null },
    ] }] });
    expect(runningSessions(answered([{ name: 'main', windowCount: undefined }]), topics)).toEqual([
      { name: 'main', windowCount: 2, topicLabel: null, onHost: { id: sid('$1'), inTopic: false } },
    ]);
  });

  it('says so when the Host has no Session', () => {
    expect(sessions(answered([]), withTopics)).toEqual([sessionsSection(note('No Sessions on this Host.'))]);
  });

  it('shows the refusal of a Host that could not be asked', () => {
    expect(sessions(refused('no route'), TOPICS_UNASKED)).toEqual([sessionsSection({ kind: 'refused', message: 'no route' })]);
  });

  it.each<{ name: string; topics: HostTopics; row: HostScreenRow }>([
    { name: 'the Host CLI is being installed', topics: withHostCli({ kind: 'absent' }, INSTALL_RUNNING), row: { kind: 'checking', text: 'Installing Muxify on this Host…' } },
    { name: 'an old Host CLI is being updated', topics: withHostCli({ kind: 'unavailable', host: 'Mac', reason: 'x' }, INSTALL_RUNNING), row: { kind: 'checking', text: 'Updating Muxify on this Host…' } },
    {
      name: 'the Host CLI could not be installed',
      topics: withHostCli({ kind: 'absent' }, installDone('failed', 'neither curl nor wget')),
      row: { kind: 'refused', message: 'Could not install Muxify on this Host: neither curl nor wget' },
    },
  ])('says above the Sessions why the Host has no Board tab, when $name', ({ topics, row }) => {
    expect(sessions(answered([running('main')]), topics)).toEqual([sessionsSection(row, sessionRow('main', null, 1))]);
  });

  it('says nothing above the Sessions of a Host with no Host CLI, or of one whose Board tab has the error', () => {
    expect(sessions(answered([running('main')]), { kind: 'absent' })[0]?.rows).toHaveLength(1);
    expect(sessions(answered([]), { kind: 'failed', error: 'no route', last: snapshot() })[0]?.rows).toEqual([
      note('No Sessions on this Host.'),
    ]);
  });
});

describe('the Bench peek, which shows where the Attach is while the Bench row hides it', () => {
  const host = listed({
    sessions: [
      snapshotSession('$1', 'benched/b2', 'b2'),
      snapshotSession('$2', 'loose', null),
      snapshotSession('$3', 'placed/t1', 't1'),
      snapshotSession('$4', 'locked', null),
    ],
    unpinned: inPlay({
      places: [topicCard('t1')],
      bench: [topicCard('b1'), topicCard('b2'), { kind: 'session', mark: null, sessions: [sid('$4')] }],
    }),
    no_topic: [sid('$2')],
  });
  const benchRows = (attach: AttachPlace | null, opened: OpenableRow[] = []) =>
    hostScreen({ tab: 'board', listing: UNASKED, topics: host, attach, opened: new Set(opened), appearance: 'light', problem: null })
      .find((shown) => shown.id === 'bench')?.rows;
  const CLOSED_BENCH: HostScreenRow = { kind: 'bench', opened: false };

  it('hides every Benched card with no Attach on the Host', () => {
    expect(benchRows(null)).toEqual([CLOSED_BENCH]);
  });

  it('shows the Benched card of the Topic the Attach holds, and no other', () => {
    expect(benchRows({ sessionName: 'benched/b2', topic: tid('b2') })).toEqual([CLOSED_BENCH, topicRow('b2', { section: 'bench' })]);
  });

  it('finds the Topic from the Session when the Attach holds none', () => {
    expect(benchRows({ sessionName: 'benched/b2', topic: null })).toEqual([CLOSED_BENCH, topicRow('b2', { section: 'bench' })]);
  });

  it('shows the Benched card of a live Board Session that the Attach is on', () => {
    expect(benchRows({ sessionName: 'locked', topic: null })).toEqual([
      CLOSED_BENCH,
      liveBoardSession('$4', 'locked', 'bench'),
    ]);
  });

  it('shows the Session of the Attach under the Bench row when it is in No Topic', () => {
    expect(benchRows({ sessionName: 'loose', topic: null })).toEqual([CLOSED_BENCH, sessionRow('loose')]);
  });

  it('leaves that Session to the No Topic row once the row is opened', () => {
    expect(benchRows({ sessionName: 'loose', topic: null }, ['no-topic'])).toEqual([CLOSED_BENCH]);
  });

  it('keeps that Session under the row of an opened Bench, above its cards, as the Mac does', () => {
    expect(benchRows({ sessionName: 'loose', topic: null }, ['bench'])?.slice(0, 2)).toEqual([
      { kind: 'bench', opened: true },
      sessionRow('loose'),
    ]);
  });

  it('shows nothing more for an Attach whose Topic is In Play, or whose Session the Host does not list', () => {
    expect(benchRows({ sessionName: 'placed/t1', topic: tid('t1') })).toEqual([CLOSED_BENCH]);
    expect(benchRows({ sessionName: 'gone', topic: null })).toEqual([CLOSED_BENCH]);
  });

  it('shows the Session of the Attach in No Topic on a Host with an empty Bench', () => {
    const topics = listed({ sessions: [snapshotSession('$2', 'loose', null)], no_topic: [sid('$2')] });
    expect(hostScreen({ tab: 'board', listing: UNASKED, topics, attach: { sessionName: 'loose', topic: null }, opened: CLOSED, appearance: 'light', problem: null }))
      .toEqual([
        section('bench', null, sessionRow('loose')),
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: false }),
      ]);
  });

  it('shows no peek in the Topics of the Title Sheet, where the Bench is open', () => {
    const rows = topicSections(host, 'light').flatMap((shown) => shown.rows);
    expect(rows.filter((row) => row.kind === 'session')).toEqual([]);
  });
});

describe('the Host Problem on the Host Screen', () => {
  const problem = { title: 'Could not reach mac', detail: 'The Host did not answer in time.' };
  const unreachable: HostTopics = { kind: 'host-problem', last: null };

  it.each(['sessions', 'board'] as const)('is one row on the %s tab, however many reads of the Host met it', (tab) => {
    const rows = hostScreen({ tab, listing: HOST_PROBLEM, topics: unreachable, attach: null, opened: CLOSED, appearance: 'light', problem })
      .flatMap((section) => section.rows);

    expect(rows).toEqual([{ kind: 'host-problem', ...problem }]);
  });

  // The cached snapshot stays in the state, so the Topics come back with no
  // spinner, but the screen draws none of it.
  const cached: HostTopics = {
    kind: 'host-problem',
    last: snapshot({ pinned: [topicCard('pinned')], unpinned: inPlay({ places: [topicCard('playing')] }) }),
  };

  it.each(['sessions', 'board'] as const)('drops the cached Topics on the %s tab, and stands in a section of its own', (tab) => {
    const sections = hostScreen({ tab, listing: HOST_PROBLEM, topics: cached, attach: null, opened: CLOSED, appearance: 'light', problem });

    expect(sections).toEqual([{ id: tab === 'board' ? 'topics' : tab, title: null, rows: [{ kind: 'host-problem', ...problem }] }]);
  });

  it('drops the cached Topics from the Title Sheet too', () => {
    expect(topicSections(cached, 'light')).toEqual([]);
  });

  it('leaves a refusal from a Host that answered as its own row', () => {
    const rows = hostScreen({ tab: 'sessions', listing: refused('no server running'), topics: unreachable, attach: null, opened: CLOSED, appearance: 'light', problem: null })
      .flatMap((section) => section.rows);

    expect(rows).toEqual([{ kind: 'refused', message: 'no server running' }]);
  });

  it('counts as the first answer, so the screen draws its row', () => {
    expect(firstReadAnswered({ listing: HOST_PROBLEM, topics: unreachable })).toBe(true);
  });
});
