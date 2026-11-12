import { answered, asking, refused, UNASKED, type Listing } from './host-listing';
import {
  homeRows,
  hostScreen,
  topicSections,
  type HostScreenRow,
  type HostScreenSection,
  type OpenableRow,
} from './host-screen';
import type { HostScreenLists } from '@/settings/settings';
import type { RecentSession } from '@/storage/records';
import type { Session } from '@/tmux/tmux-client';
import type {
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
  listedSessions,
  settled,
  TOPICS_UNASKED,
  withHostCli,
  type HostTopics,
} from '@/topics/host-topics';

const remembered = (name: string, lastOpenedAt = '2026-09-15T10:00:00Z'): RecentSession => ({
  hostId: 'host1',
  name,
  lastOpenedAt,
});

const running = (name: string, windowCount = 1): Session => ({ name, windowCount });

const recentRow = (name: string, windowCount?: number, lastOpenedAt = '2026-09-15T10:00:00Z') =>
  ({ kind: 'recent', name, lastOpenedAt, windowCount }) as const;
const availableRow = (name: string) => ({ kind: 'available', name }) as const;
const note = (text: string) => ({ kind: 'note', text }) as const;

const INSTALL_RUNNING: HostCliState = { kind: 'running' };
const installDone = (kind: HostCliOutcome, text: string): HostCliState => ({
  kind: 'done',
  result: { kind, text, line: kind === 'failed' || kind === 'skipped' ? `${kind}: ${text}` : `${kind} ${text}` },
});

const CHECKING = { kind: 'checking', text: 'Checking Sessions…' } as const;
const NOTHING_OPENED = note('Nothing opened on this Host yet.');
const NO_OTHERS = note('No other Sessions on this Host.');

const recentSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'recent',
  title: 'Recent Sessions',
  footer: null,
  rows,
});

/** The Sessions list below a Recent Sessions list that is on. */
const sessionsSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'sessions',
  title: 'Sessions',
  footer: rows.some((row) => row.kind === 'available')
    ? 'Opening one adds it to Recent Sessions.'
    : null,
  rows,
});

/** The Sessions list with Recent Sessions off. */
const allSessionsSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'sessions',
  title: 'Sessions',
  footer: null,
  rows,
});

const topicsSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'topics',
  title: 'Topics',
  footer: null,
  rows,
});

// What the Topics list shows before the Host has answered about Topics.
const TOPICS = topicsSection({ kind: 'checking', text: 'Checking Topics…' });

interface Case {
  name: string;
  lists?: HostScreenLists;
  recent: RecentSession[];
  listing: Listing;
  sections: HostScreenSection[];
}

describe('hostScreen', () => {
  it.each<Case>([
    {
      // One Session, one row: two ways to open the same thing is a list that
      // lies about how many Sessions the Host has.
      name: 'keeps a Session out of Sessions once it is in Recent Sessions',
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [recentSection(recentRow('muxify', 1)), sessionsSection(availableRow('cook'))],
    },
    {
      // The Mac's Sessions mode shows the Host's order, so the phone matches
      // it rather than sorting.
      name: 'keeps the order it was given for Recent Sessions, and the Host order for Sessions',
      recent: [
        remembered('zebra', '2026-09-15T11:00:00Z'),
        remembered('alpha', '2026-09-15T09:00:00Z'),
      ],
      listing: answered([
        running('zebra'),
        running('alpha'),
        running('game_server'),
        running('aws_terraform'),
      ]),
      sections: [
        recentSection(
          recentRow('zebra', 1, '2026-09-15T11:00:00Z'),
          recentRow('alpha', 1, '2026-09-15T09:00:00Z'),
        ),
        sessionsSection(availableRow('game_server'), availableRow('aws_terraform')),
      ],
    },
    {
      name: 'carries what the Host said onto the remembered row',
      recent: [remembered('muxify')],
      listing: answered([running('muxify', 4)]),
      sections: [recentSection(recentRow('muxify', 4)), sessionsSection(NO_OTHERS)],
    },
    {
      name: 'hides a remembered Session the Host no longer has',
      recent: [remembered('gone'), remembered('here')],
      listing: answered([running('here')]),
      sections: [recentSection(recentRow('here', 1)), sessionsSection(NO_OTHERS)],
    },
    {
      // Failing open is the whole point: an unreachable Host is exactly when
      // you most want to see what you had open on it.
      name: 'shows everything remembered while the first question is in flight',
      recent: [remembered('muxify'), remembered('cook')],
      listing: UNASKED,
      sections: [recentSection(recentRow('muxify'), recentRow('cook')), sessionsSection(CHECKING)],
    },
    {
      name: 'shows everything remembered when the Host refused, with why',
      recent: [remembered('muxify')],
      listing: refused('Host unreachable'),
      sections: [
        recentSection(recentRow('muxify')),
        sessionsSection({ kind: 'refused', message: 'Host unreachable' }),
      ],
    },
    {
      name: 'keeps the last answer on screen while it asks again',
      recent: [remembered('muxify')],
      listing: asking(answered([running('muxify', 2), running('cook')])),
      sections: [recentSection(recentRow('muxify', 2)), sessionsSection(availableRow('cook'))],
    },
    {
      name: 'reads a Host with nothing running as no Sessions at all',
      recent: [remembered('gone')],
      listing: answered([]),
      sections: [recentSection(NOTHING_OPENED), sessionsSection(NO_OTHERS)],
    },
    {
      name: 'lists a Host that has Sessions nobody here has opened',
      recent: [],
      listing: answered([running('cook'), running('aws_terraform')]),
      sections: [
        recentSection(NOTHING_OPENED),
        sessionsSection(availableRow('cook'), availableRow('aws_terraform')),
      ],
    },
    {
      name: 'shows only the Topics list when Topics is the one list on',
      lists: ['topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [TOPICS],
    },
    {
      name: 'shows Recent Sessions and Topics without Sessions',
      lists: ['recent', 'topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [recentSection(recentRow('muxify', 1)), TOPICS],
    },
    {
      name: 'puts the three lists in the order set, Topics first',
      lists: ['topics', 'recent', 'sessions'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        TOPICS,
        recentSection(recentRow('muxify', 1)),
        sessionsSection(availableRow('cook')),
      ],
    },
    {
      name: 'puts the three lists in the order set, Recent Sessions last',
      lists: ['sessions', 'topics', 'recent'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        sessionsSection(availableRow('cook')),
        TOPICS,
        recentSection(recentRow('muxify', 1)),
      ],
    },
    {
      name: 'with Recent Sessions off, keeps a remembered Session in the Host order',
      lists: ['sessions'],
      recent: [remembered('muxify', '2026-09-15T11:00:00Z'), remembered('gone')],
      listing: answered([running('zebra'), running('muxify', 3), running('alpha')]),
      sections: [
        allSessionsSection(
          availableRow('zebra'),
          recentRow('muxify', 3, '2026-09-15T11:00:00Z'),
          availableRow('alpha'),
        ),
      ],
    },
    {
      name: 'with Recent Sessions off, keeps the last answer while it asks again',
      lists: ['sessions'],
      recent: [remembered('muxify')],
      listing: asking(answered([running('cook'), running('muxify', 2)])),
      sections: [allSessionsSection(availableRow('cook'), recentRow('muxify', 2))],
    },
    {
      name: 'with Recent Sessions off, shows everything remembered before an answer',
      lists: ['sessions'],
      recent: [remembered('muxify'), remembered('cook')],
      listing: UNASKED,
      sections: [allSessionsSection(recentRow('muxify'), recentRow('cook'), CHECKING)],
    },
    {
      name: 'with Recent Sessions off, shows why the Host refused',
      lists: ['sessions'],
      recent: [remembered('muxify')],
      listing: refused('Host unreachable'),
      sections: [
        allSessionsSection(recentRow('muxify'), { kind: 'refused', message: 'Host unreachable' }),
      ],
    },
    {
      name: 'with Recent Sessions off, reads a Host with nothing running as no Sessions',
      lists: ['sessions'],
      recent: [remembered('gone')],
      listing: answered([]),
      sections: [allSessionsSection(note('No Sessions on this Host.'))],
    },
    {
      name: 'with Recent Sessions off, keeps Topics in its place',
      lists: ['topics', 'sessions'],
      recent: [],
      listing: answered([running('cook')]),
      sections: [TOPICS, allSessionsSection(availableRow('cook'))],
    },
  ])('$name', ({ lists = ['recent', 'sessions'], recent, listing, sections }) => {
    expect(
      hostScreen({
        settings: { hostScreenLists: lists },
        recent,
        listing,
        topics: TOPICS_UNASKED,
        opened: new Set(),
        appearance: 'light',
      }),
    ).toEqual(sections);
  });
});

interface TopicsCase {
  name: string;
  lists?: HostScreenLists;
  recent?: RecentSession[];
  listing?: Listing;
  topics: HostTopics;
  opened?: ReadonlySet<OpenableRow>;
  appearance?: 'light' | 'dark';
  sections: HostScreenSection[];
}

const sid = (id: string) => id as SessionId;
const tid = (id: string) => id as TopicId;

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
    tags: [],
    sessions: [],
    pinned: [],
    unpinned: { kind: 'list', cards: [] },
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
): HostScreenSection => ({ id, title, footer: null, rows });

const OPEN_PLACE: Card = { kind: 'open_place', id: 'open1' };
const OPEN_PLACE_ROW: HostScreenRow = { kind: 'open-place', id: 'open1' };

/** An In Play answer with one Open Place and nothing else, unless told. */
const inPlay = (over: Partial<Extract<Unpinned, { kind: 'in_play' }>> = {}): Unpinned => ({
  kind: 'in_play',
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

describe('hostScreen with Topics', () => {
  it.each<TopicsCase>([
    {
      name: 'puts Pinned cards first, with a pin, then the list in the order it came',
      topics: listed({
        pinned: [topicCard('p')],
        unpinned: { kind: 'list', cards: [topicCard('z'), topicCard('a')] },
      }),
      sections: [
        topicsSection(topicRow('p', { pinned: true }), topicRow('z'), topicRow('a')),
      ],
    },
    {
      name: 'with In Play, draws Pinned, the places, the Guests, then a closed Bench row',
      topics: listed({
        pinned: [topicCard('p')],
        unpinned: {
          kind: 'in_play',
          limit: 3,
          places: [topicCard('place'), OPEN_PLACE],
          guests: [topicCard('guest')],
          bench: [topicCard('b1'), topicCard('b2')],
        },
      }),
      sections: [
        section('pinned', 'Pinned', topicRow('p', { pinned: true })),
        section('in-play', 'In Play', topicRow('place'), { kind: 'open-place', id: 'open1' }),
        section('guests', 'Guests', topicRow('guest')),
        section('bench', null, { kind: 'bench', opened: false }),
      ],
    },
    {
      name: 'opens the Bench row into its cards, in the order they came',
      topics: listed({ unpinned: inPlay({ bench: [topicCard('b2'), topicCard('b1')] }) }),
      opened: new Set<OpenableRow>(['bench']),
      sections: [
        section('in-play', 'In Play', OPEN_PLACE_ROW),
        section('bench', null, { kind: 'bench', opened: true }, topicRow('b2'), topicRow('b1')),
      ],
    },
    {
      name: 'with In Play, leaves out an empty Pinned, Guests and Bench, and keeps the Open Places',
      topics: listed({ unpinned: inPlay({ places: [OPEN_PLACE, OPEN_PLACE] }) }),
      sections: [section('in-play', 'In Play', OPEN_PLACE_ROW, OPEN_PLACE_ROW)],
    },
    {
      name: 'with In Play and Topics alone, gives No Topic its own section after the Bench',
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
          topicRow('p', { pinned: true }),
        ),
        section('in-play', 'In Play', OPEN_PLACE_ROW),
      ],
    },
    {
      name: 'draws the Tags in Config order, in their light colours, and an undefined one last',
      topics: listed({ tags: TAGS, unpinned: { kind: 'list', cards: [topicCard('t1', { tags: TAG_NAMES })] } }),
      sections: [
        topicsSection(
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
      topics: listed({ tags: TAGS, unpinned: { kind: 'list', cards: [topicCard('t1', { tags: TAG_NAMES })] } }),
      sections: [
        topicsSection(
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
        unpinned: {
          kind: 'list',
          cards: [
            topicCard('live', { note: 'Repro with seed 4411', mark: 'blocked' }),
            topicCard('sleeping', { state: 'dormant' }),
            topicCard('blank', { state: 'empty' }),
          ],
        },
      }),
      sections: [
        topicsSection(
          topicRow('live', { note: 'Repro with seed 4411', mark: 'blocked' }),
          topicRow('sleeping', { dimmed: true }),
          topicRow('blank', { dimmed: true }),
        ),
      ],
    },
    {
      name: 'draws a Locked Session as its own card, named from the snapshot, and pinned when it is',
      topics: listed({
        sessions: [snapshotSession('$1', 'scratch', null), snapshotSession('$2', 'notes', null)],
        pinned: [{ kind: 'session', mark: 'unread', sessions: [sid('$2')] }],
        unpinned: { kind: 'list', cards: [{ kind: 'session', mark: null, sessions: [sid('$1')] }] },
      }),
      sections: [
        topicsSection(
          { kind: 'locked-session', name: 'notes', mark: 'unread', pinned: true },
          { kind: 'locked-session', name: 'scratch', mark: null, pinned: false },
        ),
      ],
    },
    {
      name: 'draws a card it does not know as a plain row: its Session names, else its kind',
      topics: listed({
        sessions: [snapshotSession('$1', 'one', null), snapshotSession('$2', 'two', null)],
        unpinned: {
          kind: 'list',
          cards: [
            { kind: 'unknown', sourceKind: 'folder', mark: null, sessions: [sid('$1'), sid('$2')] },
            { kind: 'unknown', sourceKind: 'banner', mark: null, sessions: [] },
          ],
        },
      }),
      sections: [
        topicsSection({ kind: 'unknown-card', text: 'one, two' }, { kind: 'unknown-card', text: 'banner' }),
      ],
    },
    {
      name: 'gives a Topic row the card and its Sessions before the Attach reads the Topic',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', 't1'), snapshotSession('$2', 'work', 't1')],
        unpinned: {
          kind: 'list',
          cards: [topicCard('t1', { note: 'Repro', tags: ['work'], sessions: [sid('$2'), sid('$1')] })],
        },
      }),
      sections: [
        topicsSection(
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
      name: 'ends the list with one closed No Topic row when Topics stand alone',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null), snapshotSession('$2', 'work', 't1')],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$1')],
      }),
      sections: [
        topicsSection(topicRow('t1')),
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: false }),
      ],
    },
    {
      name: 'opens the No Topic row into plain Session rows, in the order they came',
      topics: listed({
        sessions: [snapshotSession('$1', 'zeta', null), snapshotSession('$2', 'alpha', null)],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$1'), sid('$2')],
      }),
      opened: new Set<OpenableRow>(['no-topic']),
      sections: [
        topicsSection(topicRow('t1')),
        section(
          'no-topic',
          null,
          { kind: 'no-topic', count: 2, opened: true },
          { kind: 'available', name: 'zeta' },
          { kind: 'available', name: 'alpha' },
        ),
      ],
    },
    {
      name: 'has no No Topic row when every Session is in a Topic',
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1')],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
      }),
      sections: [topicsSection(topicRow('t1'))],
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
        section('no-topic', null, { kind: 'no-topic', count: 1, opened: true }, availableRow('cook')),
      ],
    },
    {
      name: 'says so when the Host has no Topics at all',
      topics: listed({}),
      sections: [topicsSection(note('No Topics yet.'))],
    },
    {
      // D2: one Session, one row. The Topic's Sessions are under the Topic.
      name: 'with every list, leaves a Session that is in a Topic out of the others',
      lists: ['topics', 'recent', 'sessions'],
      recent: [remembered('work'), remembered('cook')],
      listing: answered([running('work'), running('cook'), running('play')]),
      topics: listed({
        sessions: [
          snapshotSession('$1', 'work', 't1'),
          snapshotSession('$2', 'cook', null),
          snapshotSession('$3', 'play', null),
        ],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$2'), sid('$3')],
      }),
      sections: [
        topicsSection(topicRow('t1')),
        recentSection(recentRow('cook', 1)),
        sessionsSection(availableRow('play')),
      ],
    },
    {
      name: 'with Recent Sessions and Topics, leaves Recent Sessions out of the No Topic row',
      lists: ['recent', 'topics'],
      recent: [remembered('work'), remembered('cook')],
      listing: answered([running('work'), running('cook'), running('play')]),
      topics: listed({
        sessions: [
          snapshotSession('$1', 'work', 't1'),
          snapshotSession('$2', 'cook', null),
          snapshotSession('$3', 'play', null),
        ],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$2'), sid('$3')],
      }),
      opened: new Set<OpenableRow>(['no-topic']),
      sections: [
        recentSection(recentRow('cook', 1)),
        topicsSection(topicRow('t1')),
        section(
          'no-topic',
          null,
          { kind: 'no-topic', count: 1, opened: true },
          { kind: 'available', name: 'play' },
        ),
      ],
    },
    {
      name: 'has no No Topic row when Recent Sessions has every Session in no Topic',
      lists: ['topics', 'recent'],
      recent: [remembered('cook')],
      listing: answered([running('cook')]),
      topics: listed({
        sessions: [snapshotSession('$2', 'cook', null)],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$2')],
      }),
      sections: [topicsSection(topicRow('t1')), recentSection(recentRow('cook', 1))],
    },
    {
      name: 'with Sessions and Topics, leaves a Session in a Topic out of Sessions',
      lists: ['sessions', 'topics'],
      recent: [remembered('work')],
      listing: answered([running('work'), running('cook')]),
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1'), snapshotSession('$2', 'cook', null)],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
      }),
      sections: [allSessionsSection(availableRow('cook')), topicsSection(topicRow('t1'))],
    },
    {
      name: 'with Topics off, a Session in a Topic stays in Sessions',
      lists: ['recent', 'sessions'],
      recent: [],
      listing: answered([running('work')]),
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1')],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
      }),
      sections: [recentSection(NOTHING_OPENED), sessionsSection(availableRow('work'))],
    },
    {
      name: 'with every list and no snapshot yet, leaves no Session out',
      lists: ['topics', 'recent', 'sessions'],
      listing: answered([running('work')]),
      topics: { kind: 'absent' },
      sections: [
        topicsSection(note('No Topics on this Host')),
        recentSection(NOTHING_OPENED),
        sessionsSection(availableRow('work')),
      ],
    },
    {
      name: 'shows a check while the first read of Topics is in flight',
      topics: { kind: 'loading', last: null },
      sections: [TOPICS],
    },
    {
      name: 'draws the last snapshot while it reads again',
      topics: { kind: 'loading', last: snapshot({ unpinned: { kind: 'list', cards: [topicCard('t1')] } }) },
      sections: [topicsSection(topicRow('t1'))],
    },
    {
      name: 'says there are no Topics on a Host with no Host CLI',
      topics: { kind: 'absent' },
      sections: [topicsSection(note('No Topics on this Host'))],
    },
    {
      name: 'asks for an update on a Host whose Muxify is old',
      topics: { kind: 'old', last: null },
      sections: [topicsSection(note('Update Muxify on this Host'))],
    },
    {
      name: 'says the Host CLI is being installed on a Host with none',
      topics: withHostCli({ kind: 'absent' }, INSTALL_RUNNING),
      sections: [topicsSection({ kind: 'checking', text: 'Installing Muxify on this Host…' })],
    },
    {
      name: 'says an old Host CLI is being updated, with nothing under it without a last snapshot',
      topics: withHostCli({ kind: 'old', last: null }, INSTALL_RUNNING),
      sections: [topicsSection({ kind: 'checking', text: 'Updating Muxify on this Host…' })],
    },
    {
      name: 'says an old Host CLI is being updated above the last snapshot, which it keeps',
      topics: withHostCli(
        settled(
          { kind: 'loading', last: snapshot({ unpinned: { kind: 'list', cards: [topicCard('t1')] } }) },
          { kind: 'old' },
        ),
        INSTALL_RUNNING,
      ),
      sections: [
        topicsSection({ kind: 'checking', text: 'Updating Muxify on this Host…' }, topicRow('t1')),
      ],
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
      name: 'still asks for an update, with the reason, when an old Host CLI could not be updated',
      topics: withHostCli({ kind: 'old', last: null }, installDone('failed', 'no answer in 3 minutes')),
      sections: [
        topicsSection(note('Update Muxify on this Host. Could not update it: no answer in 3 minutes')),
      ],
    },
    {
      name: 'shows the Topics read after the install put a Host CLI there',
      topics: withHostCli(
        settled({ kind: 'loading', last: null }, {
          kind: 'listed',
          snapshot: snapshot({ unpinned: { kind: 'list', cards: [topicCard('t1')] } }),
        }),
        installDone('installed', 'abc1234 1760000000'),
      ),
      sections: [topicsSection(topicRow('t1'))],
    },
    ...(['current', 'kept', 'skipped'] as const).flatMap((outcome) => [
      {
        name: `says there are no Topics on a Host with no Host CLI after an install that answered ${outcome}`,
        topics: withHostCli({ kind: 'absent' }, installDone(outcome, 'x')),
        sections: [topicsSection(note('No Topics on this Host'))],
      },
      {
        name: `asks for an update on an old Host CLI after an install that answered ${outcome}`,
        topics: withHostCli({ kind: 'old', last: null }, installDone(outcome, 'x')),
        sections: [topicsSection(note('Update Muxify on this Host'))],
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
        last: snapshot({ unpinned: { kind: 'list', cards: [topicCard('t1')] } }),
      },
      sections: [
        topicsSection({ kind: 'refused', message: 'muxify exited with status 1' }, topicRow('t1')),
      ],
    },
  ])('$name', ({
    lists = ['topics'],
    recent = [],
    listing = UNASKED,
    topics,
    opened = CLOSED,
    appearance = 'light',
    sections,
  }) => {
    expect(
      hostScreen({
        settings: { hostScreenLists: lists },
        recent,
        listing,
        topics,
        opened,
        appearance,
      }),
    ).toEqual(sections);
  });
});

describe('hostScreen with Topics, against the snapshot `environment show` gave on the Mac', () => {
  const mac = parseEnvironment(inPlayFixture);

  it('draws the sections and cards in the order the Mac sent them', () => {
    const sections = hostScreen({
      settings: { hostScreenLists: ['topics'] },
      recent: [],
      listing: UNASKED,
      topics: { kind: 'listed', snapshot: mac },
      opened: new Set<OpenableRow>(['bench']),
      appearance: 'dark',
    });
    if (mac.unpinned.kind !== 'in_play') throw new Error('expected in_play');
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

  it('with Recent Sessions off, lists the Sessions in the order `environment show` gave', () => {
    const [sessions] = hostScreen({
      settings: { hostScreenLists: ['sessions', 'topics'] },
      recent: [remembered('chezmoi')],
      listing: answered(listedSessions(mac)),
      topics: { kind: 'listed', snapshot: mac },
      opened: CLOSED,
      appearance: 'light',
    });
    const inNoTopic = mac.sessions.filter((session) => session.topic === null);

    expect(sessions?.id).toBe('sessions');
    expect(sessions?.rows.map((row) => ('name' in row ? row.name : row.kind))).toEqual(
      inNoTopic.map((session) => session.name),
    );
    expect(sessions?.rows.find((row) => row.kind === 'recent')).toMatchObject({ name: 'chezmoi' });
  });
});

describe('topicSections, the Topics a list of Sessions shows under itself', () => {
  const mac = parseEnvironment(inPlayFixture);

  it('lists every Topic of the Host, the Bench too, and no Session or place', () => {
    if (mac.unpinned.kind !== 'in_play') throw new Error('expected in_play');
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

describe('homeRows of a Host that is not in In Play', () => {
  const input = {
    settings: { hostScreenLists: ['recent', 'sessions'] as HostScreenLists },
    recent: [remembered('a'), remembered('b')],
    listing: answered([running('a'), running('b'), running('c'), running('d')]),
    topics: TOPICS_UNASKED,
    opened: CLOSED,
    appearance: 'dark' as const,
  };
  const rowName = (row: HostScreenRow) => ('name' in row ? row.name : row.kind);

  it('keeps the first rows across the sections', () => {
    expect(homeRows(input, 3).map(rowName)).toEqual(['a', 'b', 'c']);
    expect(homeRows(input, 9).map(rowName)).toEqual(['a', 'b', 'c', 'd']);
  });
});
