import { answered, asking, refused, UNASKED, type Listing } from './host-listing';
import {
  hostScreen,
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
} from '@/topics/environment';
import { TOPICS_UNASKED, type HostTopics } from '@/topics/host-topics';

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

const CHECKING = { kind: 'checking', of: 'Sessions' } as const;
const NOTHING_OPENED = note('Nothing opened on this Host yet. Pick one below to start.');
const NOTHING_OPENED_YET = note('Nothing opened on this Host yet.');
const NO_OTHERS = note('No other Sessions on this Host.');

const recentSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'recent',
  title: 'Sessions',
  footer: null,
  rows,
});

const availableSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'available',
  title: 'Available on Host',
  footer: rows.some((row) => row.kind === 'available')
    ? 'Opening one adds it to Sessions above.'
    : null,
  rows,
});

const topicsSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'topics',
  title: 'Topics',
  footer: null,
  rows,
});

// What the Topics list shows before the Host has answered about Topics.
const TOPICS = topicsSection({ kind: 'checking', of: 'Topics' });

const hostOrderSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'sessions',
  title: 'Sessions',
  footer: null,
  rows,
});

interface Case {
  name: string;
  lists?: HostScreenLists;
  recentSessionsFirst?: boolean;
  recent: RecentSession[];
  listing: Listing;
  sections: HostScreenSection[];
}

describe('hostScreen', () => {
  it.each<Case>([
    {
      // One Session, one row: two ways to open the same thing is a list that
      // lies about how many Sessions the Host has.
      name: 'keeps a Session out of Available once it is remembered',
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [recentSection(recentRow('muxify', 1)), availableSection(availableRow('cook'))],
    },
    {
      name: 'keeps the order it was given for Recent, and sorts Available by name',
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
        availableSection(availableRow('aws_terraform'), availableRow('game_server')),
      ],
    },
    {
      name: 'carries what the Host said onto the remembered row',
      recent: [remembered('muxify')],
      listing: answered([running('muxify', 4)]),
      sections: [recentSection(recentRow('muxify', 4)), availableSection(NO_OTHERS)],
    },
    {
      name: 'hides a remembered Session the Host no longer has',
      recent: [remembered('gone'), remembered('here')],
      listing: answered([running('here')]),
      sections: [recentSection(recentRow('here', 1)), availableSection(NO_OTHERS)],
    },
    {
      // Failing open is the whole point: an unreachable Host is exactly when
      // you most want to see what you had open on it.
      name: 'shows everything remembered while the first question is in flight',
      recent: [remembered('muxify'), remembered('cook')],
      listing: UNASKED,
      sections: [
        recentSection(recentRow('muxify'), recentRow('cook')),
        availableSection(CHECKING),
      ],
    },
    {
      name: 'shows everything remembered when the Host refused, with why',
      recent: [remembered('muxify')],
      listing: refused('Host unreachable'),
      sections: [
        recentSection(recentRow('muxify')),
        availableSection({ kind: 'refused', message: 'Host unreachable' }),
      ],
    },
    {
      name: 'keeps the last answer on screen while it asks again',
      recent: [remembered('muxify')],
      listing: asking(answered([running('muxify', 2), running('cook')])),
      sections: [recentSection(recentRow('muxify', 2)), availableSection(availableRow('cook'))],
    },
    {
      name: 'reads a Host with nothing running as no Sessions at all',
      recent: [remembered('gone')],
      listing: answered([]),
      sections: [recentSection(NOTHING_OPENED), availableSection(NO_OTHERS)],
    },
    {
      name: 'lists a Host that has Sessions nobody here has opened',
      recent: [],
      listing: answered([running('cook'), running('aws_terraform')]),
      sections: [
        recentSection(NOTHING_OPENED),
        availableSection(availableRow('aws_terraform'), availableRow('cook')),
      ],
    },
    {
      name: 'does not point below before the Host has answered',
      recent: [],
      listing: UNASKED,
      sections: [recentSection(NOTHING_OPENED_YET), availableSection(CHECKING)],
    },
    {
      name: 'shows only the Topics list when Topics is the one list on',
      lists: ['topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [TOPICS],
    },
    {
      name: 'puts Topics under Sessions in that order',
      lists: ['sessions', 'topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        recentSection(recentRow('muxify', 1)),
        availableSection(availableRow('cook')),
        TOPICS,
      ],
    },
    {
      name: 'puts Topics above Sessions in that order',
      lists: ['topics', 'sessions'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        TOPICS,
        recentSection(recentRow('muxify', 1)),
        availableSection(availableRow('cook')),
      ],
    },
    {
      // The Mac's Sessions mode shows the Host's order, so the phone matches
      // it rather than sorting.
      name: 'with Recent Sessions first off, keeps the Host order in one section',
      recentSessionsFirst: false,
      recent: [remembered('muxify', '2026-09-15T11:00:00Z'), remembered('gone')],
      listing: answered([running('zebra'), running('muxify', 3), running('alpha')]),
      sections: [
        hostOrderSection(
          availableRow('zebra'),
          recentRow('muxify', 3, '2026-09-15T11:00:00Z'),
          availableRow('alpha'),
        ),
      ],
    },
    {
      name: 'with Recent Sessions first off, keeps the last answer while it asks again',
      recentSessionsFirst: false,
      recent: [remembered('muxify')],
      listing: asking(answered([running('cook'), running('muxify', 2)])),
      sections: [hostOrderSection(availableRow('cook'), recentRow('muxify', 2))],
    },
    {
      name: 'with Recent Sessions first off, shows everything remembered before an answer',
      recentSessionsFirst: false,
      recent: [remembered('muxify'), remembered('cook')],
      listing: UNASKED,
      sections: [hostOrderSection(recentRow('muxify'), recentRow('cook'), CHECKING)],
    },
    {
      name: 'with Recent Sessions first off, shows why the Host refused',
      recentSessionsFirst: false,
      recent: [remembered('muxify')],
      listing: refused('Host unreachable'),
      sections: [
        hostOrderSection(recentRow('muxify'), { kind: 'refused', message: 'Host unreachable' }),
      ],
    },
    {
      name: 'with Recent Sessions first off, reads a Host with nothing running as no Sessions',
      recentSessionsFirst: false,
      recent: [remembered('gone')],
      listing: answered([]),
      sections: [hostOrderSection(note('No Sessions on this Host.'))],
    },
    {
      name: 'with Recent Sessions first off, keeps Topics in its place',
      lists: ['topics', 'sessions'],
      recentSessionsFirst: false,
      recent: [],
      listing: answered([running('cook')]),
      sections: [TOPICS, hostOrderSection(availableRow('cook'))],
    },
  ])('$name', ({ lists = ['sessions'], recentSessionsFirst = true, recent, listing, sections }) => {
    expect(
      hostScreen({
        settings: { hostScreenLists: lists, recentSessionsFirst },
        recent,
        listing,
        topics: TOPICS_UNASKED,
        opened: new Set(),
      }),
    ).toEqual(sections);
  });
});

interface TopicsCase {
  name: string;
  lists?: HostScreenLists;
  recentSessionsFirst?: boolean;
  recent?: RecentSession[];
  listing?: Listing;
  topics: HostTopics;
  opened?: ReadonlySet<OpenableRow>;
  sections: HostScreenSection[];
}

const sid = (id: string) => id as SessionId;
const tid = (id: string) => id as TopicId;

const topicCard = (
  id: string,
  over: { state?: TopicState; mark?: Mark | null; note?: string | null } = {},
): Card => ({
  kind: 'topic',
  mark: over.mark ?? null,
  sessions: [],
  topic: {
    id: tid(id),
    label: `Topic ${id}`,
    note: over.note ?? null,
    tags: [],
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
  mark: null,
  pinned: false,
  dimmed: false,
  ...over,
});

const snapshotSession = (id: string, name: string, topic: string | null) => ({
  id: sid(id),
  name,
  activity: 0,
  mark: null,
  topic: topic === null ? null : tid(topic),
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
      name: 'with In Play, draws the places, the Guests and the Bench as one list in that order',
      topics: listed({
        pinned: [topicCard('p')],
        unpinned: {
          kind: 'in_play',
          limit: 3,
          places: [topicCard('place'), { kind: 'open_place', id: 'open1' }],
          guests: [topicCard('guest')],
          bench: [topicCard('bench')],
        },
      }),
      sections: [
        topicsSection(
          topicRow('p', { pinned: true }),
          topicRow('place'),
          { kind: 'open-place', id: 'open1' },
          topicRow('guest'),
          topicRow('bench'),
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
      name: 'ends the list with one closed No Topic row when Topics stand alone',
      topics: listed({
        sessions: [snapshotSession('$1', 'cook', null), snapshotSession('$2', 'work', 't1')],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
        no_topic: [sid('$1')],
      }),
      sections: [topicsSection(topicRow('t1'), { kind: 'no-topic', count: 1, opened: false })],
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
        topicsSection(
          topicRow('t1'),
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
      name: 'says so when the Host has no Topics at all',
      topics: listed({}),
      sections: [topicsSection(note('No Topics yet.'))],
    },
    {
      // D2: one Session, one row. The Topic's Sessions are under the Topic.
      name: 'with both lists, leaves a Session that is in a Topic out of Sessions',
      lists: ['topics', 'sessions'],
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
        availableSection(availableRow('play')),
      ],
    },
    {
      name: 'with both lists and Recent Sessions first off, leaves a Session in a Topic out too',
      lists: ['sessions', 'topics'],
      recentSessionsFirst: false,
      recent: [remembered('work')],
      listing: answered([running('work'), running('cook')]),
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1'), snapshotSession('$2', 'cook', null)],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
      }),
      sections: [
        hostOrderSection(availableRow('cook')),
        topicsSection(topicRow('t1')),
      ],
    },
    {
      name: 'with Sessions only, a Session in a Topic stays in Sessions',
      lists: ['sessions'],
      recent: [],
      listing: answered([running('work')]),
      topics: listed({
        sessions: [snapshotSession('$1', 'work', 't1')],
        unpinned: { kind: 'list', cards: [topicCard('t1')] },
      }),
      sections: [
        recentSection(NOTHING_OPENED),
        availableSection(availableRow('work')),
      ],
    },
    {
      name: 'with both lists and no snapshot yet, leaves no Session out',
      lists: ['topics', 'sessions'],
      listing: answered([running('work')]),
      topics: { kind: 'absent' },
      sections: [
        topicsSection(note('No Topics on this Host')),
        recentSection(NOTHING_OPENED),
        availableSection(availableRow('work')),
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
      name: 'says there are no Topics on a Host with no desktop Muxify',
      topics: { kind: 'absent' },
      sections: [topicsSection(note('No Topics on this Host'))],
    },
    {
      name: 'asks for an update on a Host whose Muxify is old',
      topics: { kind: 'old' },
      sections: [topicsSection(note('Update Muxify on this Host'))],
    },
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
    recentSessionsFirst = true,
    recent = [],
    listing = UNASKED,
    topics,
    opened = CLOSED,
    sections,
  }) => {
    expect(
      hostScreen({
        settings: { hostScreenLists: lists, recentSessionsFirst },
        recent,
        listing,
        topics,
        opened,
      }),
    ).toEqual(sections);
  });
});
