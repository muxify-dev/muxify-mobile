import { lastAnswer, type Listing } from '@/domain/host-listing';
import type { Settings } from '@/settings/settings';
import type { RecentSession } from '@/storage/records';
import type { Card, EnvironmentSnapshot, Mark, SessionId, TopicId } from '@/topics/environment';
import { lastSnapshot, type HostTopics } from '@/topics/host-topics';
import { tagColorHex, type ColorAppearance } from '@/topics/tag-color';
import { seededTopic, type TopicDetail } from '@/topics/topic-detail';

/** A Session Muxify remembers opening, as the Recent Sessions and Sessions lists show it. */
export interface RecentRow {
  kind: 'recent';
  name: string;
  lastOpenedAt: string;
  windowCount: number | undefined;
}

/**
 * One Tag of a Topic, with the colour to draw it in. The colour is null for a
 * Tag the Config no longer defines, or one with a colour the phone cannot read.
 */
export interface TagMark {
  name: string;
  color: string | null;
}

/** One row of a Host Screen section. A section with no Session rows has one of the others. */
export type HostScreenRow =
  | RecentRow
  | { kind: 'available'; name: string }
  /** The first question to the Host is still in flight. */
  | { kind: 'checking'; of: 'Sessions' | 'Topics' }
  /** The Host could not be asked. The screen offers Retry. */
  | { kind: 'refused'; message: string }
  | { kind: 'note'; text: string }
  /** A Topic. Dimmed when it has no live Session, and the screen says so. */
  | {
      kind: 'topic';
      id: TopicId;
      label: string;
      note: string | null;
      tags: TagMark[];
      mark: Mark | null;
      pinned: boolean;
      dimmed: boolean;
      /** What the Attach can show before its first Topic read. */
      seed: TopicDetail;
    }
  /** A Locked Session shown as its own card. */
  | { kind: 'locked-session'; name: string; mark: Mark | null; pinned: boolean }
  /** An empty In Play place. */
  | { kind: 'open-place'; id: string }
  /** The In Play Bench, as one row that opens to show its cards. */
  | { kind: 'bench'; opened: boolean }
  /** A card this phone does not know, drawn as one plain line. */
  | { kind: 'unknown-card'; text: string }
  /** The Sessions that are in no Topic, as one row that opens to list them. */
  | { kind: 'no-topic'; count: number; opened: boolean };

/** The rows that the user can open in place, by the id the screen holds them under. */
export type OpenableRow = 'no-topic' | 'bench';

export interface HostScreenSection {
  id: 'recent' | 'sessions' | 'topics' | 'pinned' | 'in-play' | 'guests' | 'bench' | 'no-topic';
  /** Null when the section starts with its own named row. */
  title: string | null;
  footer: string | null;
  rows: HostScreenRow[];
}

export interface HostScreenInput {
  settings: Pick<Settings, 'hostScreenLists'>;
  /** This Host's Recent Sessions, newest first. */
  recent: RecentSession[];
  listing: Listing;
  topics: HostTopics;
  /** The rows the user has opened. */
  opened: ReadonlySet<OpenableRow>;
  /** The appearance the screen is drawn in, which picks each Tag's colour. */
  appearance: ColorAppearance;
}

/**
 * The sections of the Host Screen, in the order the user set in Settings.
 *
 * A Session shows in one list only, because two rows would be two ways to open
 * one Session. Its Topic comes first, once a snapshot says which Topic that is.
 * Recent Sessions comes next, and the Sessions list has the rest. With the
 * Sessions list off, the Topics list ends with a No Topic row in its place, and
 * the same rule holds for the Sessions under it.
 *
 * Until the Host has answered, every remembered Session is shown (fail open).
 * A Host that is unreachable, slow, or has no tmux server yet must not look
 * like a Host you have never used. The moment a real answer arrives the list
 * narrows to it.
 *
 * A remembered Session the Host no longer has is dropped from the lists, but
 * never from the records: kill it from a laptop and make it again tomorrow
 * and the row comes back where it was, still knowing when you last opened it.
 */
export function hostScreen({
  settings,
  recent,
  listing,
  topics,
  opened,
  appearance,
}: HostScreenInput): HostScreenSection[] {
  const lists = settings.hostScreenLists;
  const recentOn = lists.includes('recent');
  const snapshot = lastSnapshot(topics);
  const inTopics = lists.includes('topics') && snapshot ? namesInTopics(snapshot) : NONE;

  const outOfTopics = recent.filter((session) => !inTopics.has(session.name));
  const listingOutOfTopics = without(listing, inTopics);
  const inRecent: ReadonlySet<string> = recentOn
    ? new Set(outOfTopics.map((session) => session.name))
    : NONE;

  return lists.flatMap((list) => {
    switch (list) {
      case 'topics':
        return topicsList(topics, {
          opened,
          appearance,
          withNoTopic: !lists.includes('sessions'),
          leaveOut: inRecent,
        });
      case 'recent':
        return [recentList(outOfTopics, listingOutOfTopics)];
      case 'sessions':
        return [sessionsList(outOfTopics, listingOutOfTopics, recentOn)];
    }
  });
}

/**
 * The rows Home shows of one Host. With the Topics list on and the Mac in In
 * Play, that is every Pinned, In Play and Guest card: the Host's live work
 * must not fall off Home behind an empty place. Otherwise the first `limit`
 * rows of the Host Screen, counted across its sections.
 */
export function homeRows(input: HostScreenInput, limit: number): HostScreenRow[] {
  const sections = hostScreen(input);
  const snapshot = lastSnapshot(input.topics);
  if (input.settings.hostScreenLists.includes('topics') && snapshot?.unpinned.kind === 'in_play') {
    return sections
      .filter((section) => HOME_SECTIONS.has(section.id))
      .flatMap((section) => section.rows.filter((row) => row.kind !== 'open-place'));
  }
  return sections.flatMap((section) => section.rows).slice(0, limit);
}

const HOME_SECTIONS: ReadonlySet<HostScreenSection['id']> = new Set(['pinned', 'in-play', 'guests']);

const NONE: ReadonlySet<string> = new Set();

/**
 * The Host's Topics alone, for a list that shows the Host's Sessions itself:
 * every Topic in the sections of the Topics list, and the rows that say why
 * there are none. The Bench is open, because nothing opens in place there.
 */
export function topicSections(topics: HostTopics, appearance: ColorAppearance): HostScreenSection[] {
  return topicsList(topics, { opened: BENCH_OPENED, appearance, withNoTopic: false, leaveOut: NONE })
    .map((section) => ({
      ...section,
      title: SECTION_TITLES[section.id],
      rows: section.rows.filter((row) => ABOUT_TOPICS.has(row.kind)),
    }))
    .filter((section) => section.rows.length > 0);
}

const SECTION_TITLES: Record<HostScreenSection['id'], string> = {
  recent: 'Recent Sessions',
  sessions: 'Sessions',
  topics: 'Topics',
  pinned: 'Pinned',
  'in-play': 'In Play',
  guests: 'Guests',
  bench: 'Bench',
  'no-topic': 'No Topic',
};

const BENCH_OPENED: ReadonlySet<OpenableRow> = new Set(['bench']);

const ABOUT_TOPICS: ReadonlySet<HostScreenRow['kind']> = new Set(['topic', 'checking', 'refused', 'note']);

function namesInTopics(snapshot: EnvironmentSnapshot): ReadonlySet<string> {
  return new Set(
    snapshot.sessions.filter((session) => session.topic !== null).map((session) => session.name),
  );
}

/** The Listing with some Sessions taken out of what it last answered. */
function without(listing: Listing, names: ReadonlySet<string>): Listing {
  if (names.size === 0 || listing.phase === 'failed' || listing.sessions === undefined) {
    return listing;
  }
  return { ...listing, sessions: listing.sessions.filter((session) => !names.has(session.name)) };
}

interface CardsContext {
  opened: ReadonlySet<OpenableRow>;
  appearance: ColorAppearance;
  /** Whether the list ends with the No Topic row. */
  withNoTopic: boolean;
  /** Sessions another list already shows, which the No Topic row leaves out. */
  leaveOut: ReadonlySet<string>;
}

/**
 * The Topics list. Before a snapshot, it is one Topics section with a row that
 * says why. A failed read puts its error above the last snapshot's cards.
 */
function topicsList(topics: HostTopics, context: CardsContext): HostScreenSection[] {
  const only = (row: HostScreenRow): HostScreenSection[] => [topicsSection('topics', 'Topics', [row])];
  switch (topics.kind) {
    case 'absent':
      return only({ kind: 'note', text: 'No Topics on this Host' });
    case 'old':
      return only({ kind: 'note', text: 'Update Muxify on this Host' });
    case 'loading':
      return topics.last ? cardSections(topics.last, context) : only({ kind: 'checking', of: 'Topics' });
    case 'failed': {
      const refused: HostScreenRow = { kind: 'refused', message: topics.error };
      if (!topics.last) return only(refused);
      const [first, ...rest] = cardSections(topics.last, context);
      return [{ ...first, rows: [refused, ...first.rows] }, ...rest];
    }
    case 'listed':
      return cardSections(topics.snapshot, context);
  }
}

function topicsSection(
  id: HostScreenSection['id'],
  title: string | null,
  rows: HostScreenRow[],
): HostScreenSection {
  return { id, title, footer: null, rows };
}

/**
 * The cards in the sections the Mac's Topics mode draws. With a list, that is
 * the Pinned cards, with a pin, and then the list, under one header. With In
 * Play, it is Pinned, the In Play places, the Guests, and then the Bench as one
 * row that opens. Never sorted: the order is the Mac's, and a card the phone
 * moved would not be where the user looks for it on the Mac.
 *
 * Always at least one section, so a failed read has a place for its error.
 */
function cardSections(snapshot: EnvironmentSnapshot, context: CardsContext): HostScreenSection[] {
  const names = new Map<SessionId, string>(
    snapshot.sessions.map((session) => [session.id, session.name]),
  );
  const colors = new Map(
    snapshot.tags.map((tag) => {
      const color = tag.color[context.appearance];
      return [tag.name, color ? tagColorHex(color, context.appearance) : null];
    }),
  );
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const rows = (cards: Card[], pinned = false) =>
    cards.map((card) => cardRow(card, { pinned, names, colors, sessions }));
  const pinned = rows(snapshot.pinned, true);
  const noTopic = noTopicRows(snapshot, names, context);
  const { unpinned } = snapshot;

  if (unpinned.kind === 'list') {
    const sections = [
      topicsSection('topics', 'Topics', [...pinned, ...rows(unpinned.cards)]),
      topicsSection('no-topic', null, noTopic),
    ].filter((section) => section.rows.length > 0);
    return sections.length > 0
      ? sections
      : [topicsSection('topics', 'Topics', [{ kind: 'note', text: 'No Topics yet.' }])];
  }

  const benchOpened = context.opened.has('bench');
  const bench: HostScreenRow[] =
    unpinned.bench.length === 0
      ? []
      : [{ kind: 'bench', opened: benchOpened }, ...(benchOpened ? rows(unpinned.bench) : [])];
  const sections = [
    topicsSection('pinned', 'Pinned', pinned),
    topicsSection('in-play', 'In Play', rows(unpinned.places)),
    topicsSection('guests', 'Guests', rows(unpinned.guests)),
    topicsSection('bench', null, bench),
    topicsSection('no-topic', null, noTopic),
  ].filter((section) => section.rows.length > 0);
  return sections.length > 0
    ? sections
    : [topicsSection('in-play', 'In Play', [{ kind: 'note', text: 'No Topics yet.' }])];
}

/** The No Topic row, and the Sessions under it once it is opened, in the order they came. */
function noTopicRows(
  snapshot: EnvironmentSnapshot,
  names: ReadonlyMap<SessionId, string>,
  context: CardsContext,
): HostScreenRow[] {
  if (!context.withNoTopic) return [];
  const sessions = snapshot.no_topic.flatMap((id) => {
    const name = names.get(id);
    return name === undefined || context.leaveOut.has(name) ? [] : [name];
  });
  if (sessions.length === 0) return [];
  const opened = context.opened.has('no-topic');
  return [
    { kind: 'no-topic', count: sessions.length, opened },
    ...(opened ? sessions.map((name): HostScreenRow => ({ kind: 'available', name })) : []),
  ];
}

/**
 * A Topic's Tags in Config order, as the Mac draws its Tag Marks. A Tag the
 * Config no longer defines comes last, with no colour.
 */
function tagMarks(tags: string[], colors: ReadonlyMap<string, string | null>): TagMark[] {
  const defined = [...colors.keys()].filter((name) => tags.includes(name));
  const undefinedTags = tags.filter((name) => !colors.has(name));
  return [...defined, ...undefinedTags].map((name) => ({ name, color: colors.get(name) ?? null }));
}

interface CardRowContext {
  sessions: ReadonlyMap<SessionId, EnvironmentSnapshot['sessions'][number]>;
  pinned: boolean;
  names: ReadonlyMap<SessionId, string>;
  /** Each Tag the Config defines, in Config order, with its colour in this appearance. */
  colors: ReadonlyMap<string, string | null>;
}

function cardRow(card: Card, { pinned, names, colors, sessions }: CardRowContext): HostScreenRow {
  switch (card.kind) {
    case 'topic':
      return {
        kind: 'topic',
        id: card.topic.id,
        label: card.topic.label,
        note: card.topic.note,
        tags: tagMarks(card.topic.tags, colors),
        mark: card.mark,
        pinned,
        dimmed: card.topic.state !== 'live',
        seed: seededTopic(card, sessions),
      };
    case 'session': {
      const name = names.get(card.sessions[0]);
      return name === undefined
        ? { kind: 'unknown-card', text: card.sessions[0] }
        : { kind: 'locked-session', name, mark: card.mark, pinned };
    }
    case 'open_place':
      return { kind: 'open-place', id: card.id };
    case 'unknown': {
      const sessions = card.sessions.flatMap((id) => names.get(id) ?? []);
      return { kind: 'unknown-card', text: sessions.length > 0 ? sessions.join(', ') : card.sourceKind };
    }
  }
}

/**
 * The Recent Sessions list: the Sessions this phone opened that the Host still
 * has, newest first. Before the Host answers, every one of them (fail open).
 */
function recentList(recent: RecentSession[], listing: Listing): HostScreenSection {
  const listed = lastAnswer(listing);
  const onHost = new Map(listed?.map((session) => [session.name, session]));
  const rows: HostScreenRow[] = recent.flatMap((session) => {
    const live = onHost.get(session.name);
    if (listed !== undefined && !live) return [];
    return [recentRow(session, live?.windowCount)];
  });
  return {
    id: 'recent',
    title: 'Recent Sessions',
    footer: null,
    rows: rows.length > 0 ? rows : [{ kind: 'note', text: 'Nothing opened on this Host yet.' }],
  };
}

/**
 * The Sessions list: the Host's Sessions in the order the Host lists them,
 * which is the order the Mac shows. With Recent Sessions on, the ones in it
 * are left out. With it off, a remembered Session keeps its Recent row here,
 * so it can still be forgotten or disconnected, and before the Host answers
 * the remembered Sessions show (fail open).
 */
function sessionsList(
  recent: RecentSession[],
  listing: Listing,
  recentOn: boolean,
): HostScreenSection {
  const listed = lastAnswer(listing);
  const remembered = new Map(recent.map((session) => [session.name, session]));

  const rows: HostScreenRow[] =
    listed === undefined
      ? [
          ...(recentOn ? [] : recent.map((session) => recentRow(session, undefined))),
          unansweredRow(listing),
        ]
      : listed.flatMap((live): HostScreenRow[] => {
          const session = remembered.get(live.name);
          if (!session) return [{ kind: 'available', name: live.name }];
          return recentOn ? [] : [recentRow(session, live.windowCount)];
        });

  return {
    id: 'sessions',
    title: 'Sessions',
    footer:
      recentOn && rows.some((row) => row.kind === 'available')
        ? 'Opening one adds it to Recent Sessions.'
        : null,
    rows:
      rows.length > 0
        ? rows
        : [{ kind: 'note', text: recentOn ? 'No other Sessions on this Host.' : 'No Sessions on this Host.' }],
  };
}

function recentRow(session: RecentSession, windowCount: number | undefined): RecentRow {
  return {
    kind: 'recent',
    name: session.name,
    lastOpenedAt: session.lastOpenedAt,
    windowCount,
  };
}

/**
 * What stands in for the Host's Sessions while it has no answer: the first
 * question is still in flight, or the Host refused it. A later question is
 * answered from what is already on screen while it is in flight, so it has
 * nothing to show.
 */
function unansweredRow(listing: Listing): HostScreenRow {
  if (listing.phase === 'failed') return { kind: 'refused', message: listing.message };
  return { kind: 'checking', of: 'Sessions' };
}
