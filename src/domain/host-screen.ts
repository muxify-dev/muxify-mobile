import { lastAnswer, type Listing } from '@/domain/host-listing';
import type { Card, EnvironmentSnapshot, Mark, SessionId, SnapshotSession, TopicId } from '@/topics/environment';
import { lastSnapshot, topicsUnavailable, type HostTopics } from '@/topics/host-topics';
import type { CardSection } from '@/topics/topic-action';
import { tagColorHex, type ColorAppearance } from '@/topics/tag-color';
import type { SessionOnHost } from '@/topics/tmux-order';
import { seededTopic, type TopicDetail } from '@/topics/topic-detail';

/**
 * The two views of the Host Screen, which are the two views of the Mac's
 * Sidebar: the Host's Board, or every running Session.
 */
export type HostScreenTab = 'board' | 'sessions';

/**
 * The tabs the Host Screen shows, in their order. The Host's Config decides,
 * through `sidebar` in the snapshot, so the Mac and the phone show the same
 * views. A Host CLI that does not say shows both. A Host with no Topics to
 * read (no Host CLI, one being updated, or no snapshot yet) shows the Sessions only.
 */
export function hostScreenTabs(topics: HostTopics): readonly [HostScreenTab, ...HostScreenTab[]] {
  const snapshot = lastSnapshot(topics);
  if (snapshot === null || topics.kind === 'updating') return ['sessions'];
  const { sidebar } = snapshot;
  if (sidebar === null || sidebar.topics === sidebar.sessions) return ['board', 'sessions'];
  return sidebar.topics ? ['board'] : ['sessions'];
}

/** The tab to show: the one the user last chose on this Host when it is on show, else the first. */
export function tabOnShow(last: HostScreenTab | undefined, tabs: readonly [HostScreenTab, ...HostScreenTab[]]): HostScreenTab {
  return last !== undefined && tabs.includes(last) ? last : tabs[0];
}

/**
 * One Tag of a Topic, with the colour to draw it in. The colour is null for a
 * Tag the Config no longer defines, or one with a colour the phone cannot read.
 */
export interface TagMark {
  name: string;
  color: string | null;
}

/** A running Session of the Host. */
export interface SessionRow {
  kind: 'session';
  name: string;
  windowCount: number | undefined;
  /** The Topic it is in, or "No Topic". Null where the row says nothing about Topics. */
  topicLabel: string | null;
  /** What the Host Server says of it, for its Actions. Undefined where the row offers none, as in Sessions only. */
  onHost?: SessionOnHost;
}

/** One row of a Host Screen section. A section with no Session rows has one of the others. */
export type HostScreenRow =
  | SessionRow
  /** The first question to the Host is still in flight, or the Host CLI install is running. */
  | { kind: 'checking'; text: string }
  /** The Host answered, and refused. The screen offers Try again. */
  | { kind: 'refused'; message: string }
  /** The Host could not be used: its Host Problem, the one row that says so. The screen offers Try again. */
  | { kind: 'host-problem'; title: string; detail: string | null }
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
      /** Where the card sits, which says what its menu offers. */
      section: CardSection;
      dimmed: boolean;
      /** What the Attach can show before its first Topic read. */
      seed: TopicDetail;
    }
  /** A Locked Session shown as its own card. */
  | { kind: 'locked-session'; session: SessionId; name: string; mark: Mark | null; pinned: boolean }
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
  id: 'sessions' | 'topics' | 'pinned' | 'in-play' | 'guests' | 'bench' | 'no-topic';
  /** Null when the section starts with its own named row. */
  title: string | null;
  rows: HostScreenRow[];
}

/** Where the Attach is, for the Bench peek. */
export interface AttachPlace {
  sessionName: string;
  /** The Topic the Attach holds, or null when it holds none. */
  topic: TopicId | null;
}

export interface HostScreenInput {
  tab: HostScreenTab;
  listing: Listing;
  topics: HostTopics;
  /** The Attach on this Host, or null when there is none. */
  attach: AttachPlace | null;
  /** The rows the user has opened. */
  opened: ReadonlySet<OpenableRow>;
  /** The appearance the screen is drawn in, which picks each Tag's colour. */
  appearance: ColorAppearance;
  /** The Host Problem in the words the user reads, or null. */
  problem: { title: string; detail: string | null } | null;
}

/**
 * The sections of one tab of the Host Screen.
 *
 * The Board tab is the Mac's Board: Pinned, In Play, the Guests, the
 * Bench row, and the No Topic row. The Sessions tab is the Mac's Sessions
 * view: every running Session in the order the Host lists them, with its Topic
 * under the name, and no Bench.
 */
export function hostScreen({ tab, listing, topics, attach, opened, appearance, problem }: HostScreenInput): HostScreenSection[] {
  const sections = tab === 'board'
    ? topicsList(topics, { opened, appearance, withNoTopic: true, attach })
    : [sessionsList(listing, topics)];
  if (problem === null) return sections;
  // One row for the Host Problem, however many reads of the Host met it.
  const [first, ...rest] = sections;
  return [{ ...first, rows: [{ kind: 'host-problem', ...problem }, ...first.rows] }, ...rest];
}

/**
 * Whether the Host Screen has its first answer from the Host.
 *
 * Until then the screen draws none of the Host's rows: the tabs come from the
 * first Topics read, and a screen drawn before it would change its tabs under
 * the user. A later read carries the last answer, so only the first read
 * waits. A refusal counts as an answer, whatever the Topics are doing: a Host
 * that is no longer saved never gets its Topics read.
 */
export function firstReadAnswered({ listing, topics }: Pick<HostScreenInput, 'listing' | 'topics'>): boolean {
  if (listing.phase === 'failed' || listing.phase === 'host-problem') return true;
  if (listing.sessions === undefined) return false;
  return !(topics.kind === 'loading' && topics.last === null);
}

/**
 * The Host's Topics alone, for a list that shows the Host's Sessions itself:
 * every Topic in the sections of the Topics list, and the rows that say why
 * there are none. The Bench is open, because nothing opens in place there.
 */
export function topicSections(topics: HostTopics, appearance: ColorAppearance): HostScreenSection[] {
  return topicsList(topics, { opened: BENCH_OPENED, appearance, withNoTopic: false, attach: null })
    .map((section) => ({
      ...section,
      title: SECTION_TITLES[section.id],
      rows: section.rows.filter((row) => ABOUT_TOPICS.has(row.kind)),
    }))
    .filter((section) => section.rows.length > 0);
}

const SECTION_TITLES: Record<HostScreenSection['id'], string> = {
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

interface CardsContext {
  opened: ReadonlySet<OpenableRow>;
  appearance: ColorAppearance;
  /** Whether the list ends with the No Topic row. */
  withNoTopic: boolean;
  /** Where the Attach is, or null when the list has no Bench peek. */
  attach: AttachPlace | null;
}

/**
 * The Topics list. Before a snapshot, it is one Topics section with a row that
 * says why. A failure and a Host CLI update put their row above
 * the last snapshot's cards. A Host Problem drops the list: one empty section
 * with no title, where the Host Screen puts the Host Problem row.
 */
function topicsList(topics: HostTopics, context: CardsContext): HostScreenSection[] {
  if (topics.kind === 'host-problem') return [topicsSection('topics', null, [])];
  const last = lastSnapshot(topics);
  if (topics.kind === 'absent') return [topicsSection('topics', 'Topics', [{ kind: 'note', text: 'No Topics on this Host' }])];
  if (topics.kind === 'loading' && last === null) {
    return [topicsSection('topics', 'Topics', [{ kind: 'checking', text: 'Checking Topics…' }])];
  }
  const notice = topicsNotice(topics);
  if (last === null) return [topicsSection('topics', 'Topics', notice)];
  const [first, ...rest] = cardSections(last, context);
  return [{ ...first, rows: [...notice, ...first.rows] }, ...rest];
}

/** The row that says why the Topics are not as the Host has them now: an install or update, a failure, or no Host Server. */
function topicsNotice(topics: HostTopics): HostScreenRow[] {
  switch (topics.kind) {
    case 'installing':
      return [{ kind: 'checking', text: 'Installing Muxify on this Host…' }];
    case 'updating':
      return [{ kind: 'checking', text: 'Updating Muxify on this Host…' }];
    case 'failed':
      return [{ kind: 'refused', message: topics.error }];
    case 'unavailable':
      return [{ kind: 'note', text: topicsUnavailable(topics.host, topics.reason) }];
    case 'absent':
    case 'loading':
    case 'listed':
    case 'host-problem':
      return [];
  }
}

function topicsSection(
  id: HostScreenSection['id'],
  title: string | null,
  rows: HostScreenRow[],
): HostScreenSection {
  return { id, title, rows };
}

/**
 * The cards in the sections the Mac draws: Pinned, the In Play places, the
 * Guests, and then the Bench as one row that opens. Never sorted: the order is
 * the Mac's, and a card the phone moved would not be where the user looks for it
 * on the Mac.
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
  const rows = (cards: Card[], section: CardSection) =>
    cards.map((card) => cardRow(card, { section, names, colors, sessions }));
  const { unpinned } = snapshot;
  const noTopicOpened = context.opened.has('no-topic');
  const peek = benchPeek(snapshot, context.attach);

  const benchOpened = context.opened.has('bench');
  const benchCards = benchOpened ? unpinned.bench : unpinned.bench.filter((card) => card === peek.card);
  const bench: HostScreenRow[] = [
    ...(unpinned.bench.length === 0 ? [] : [{ kind: 'bench' as const, opened: benchOpened }]),
    // The opened No Topic row lists the Session itself.
    ...(peek.session === null || noTopicOpened || !context.withNoTopic ? [] : [sessionRow(peek.session, null)]),
    ...rows(benchCards, 'bench'),
  ];
  const noTopic = context.withNoTopic ? snapshot.no_topic.flatMap((id) => sessions.get(id) ?? []) : [];
  const sections = [
    topicsSection('pinned', 'Pinned', rows(snapshot.pinned, 'pinned')),
    topicsSection('in-play', 'In Play', rows(unpinned.places, 'in-play')),
    topicsSection('guests', 'Guests', rows(unpinned.guests, 'guests')),
    topicsSection('bench', null, bench),
    topicsSection('no-topic', null, noTopic.length === 0 ? [] : [
      { kind: 'no-topic', count: noTopic.length, opened: noTopicOpened },
      ...(noTopicOpened ? noTopic.map((session) => sessionRow(session, null)) : []),
    ]),
  ].filter((section) => section.rows.length > 0);
  return sections.length > 0
    ? sections
    : [topicsSection('in-play', 'In Play', [{ kind: 'note', text: 'No Topics yet.' }])];
}

/**
 * What shows of the place the Attach is in while the Bench row hides it, as
 * the Mac shows the card of its Location: the Benched card of the Attach's
 * Topic or Locked Session, or the Attach's Session when it is in No Topic.
 */
function benchPeek(
  snapshot: EnvironmentSnapshot,
  attach: AttachPlace | null,
): { card: Card | null; session: SnapshotSession | null } {
  const session = attach === null ? undefined : snapshot.sessions.find(({ name }) => name === attach.sessionName);
  if (attach === null || session === undefined) return { card: null, session: null };
  const topic = attach.topic ?? session.topic;
  const card = snapshot.unpinned.bench.find((candidate) =>
    candidate.kind === 'topic' ? candidate.topic.id === topic : candidate.kind === 'session' && candidate.sessions[0] === session.id);
  return {
    card: card ?? null,
    session: topic === null && snapshot.no_topic.includes(session.id) ? session : null,
  };
}

function sessionRow(session: SnapshotSession, topicLabel: string | null): SessionRow {
  return { kind: 'session', name: session.name, windowCount: session.windows?.length, topicLabel };
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
  section: CardSection;
  names: ReadonlyMap<SessionId, string>;
  /** Each Tag the Config defines, in Config order, with its colour in this appearance. */
  colors: ReadonlyMap<string, string | null>;
}

function cardRow(card: Card, { section, names, colors, sessions }: CardRowContext): HostScreenRow {
  const pinned = section === 'pinned';
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
        section,
        dimmed: card.topic.state !== 'live',
        seed: seededTopic(card, sessions),
      };
    case 'session': {
      const name = names.get(card.sessions[0]);
      return name === undefined
        ? { kind: 'unknown-card', text: card.sessions[0] }
        : { kind: 'locked-session', session: card.sessions[0], name, mark: card.mark, pinned };
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
 * The Sessions tab: every running Session in the order the Host lists them,
 * which is the order the Mac's Sessions view shows. A Host with Topics says
 * which Topic each Session is in. A row above them says why the Host has no
 * Board tab, when the Host CLI is being installed or updated, or failed.
 */
function sessionsList(listing: Listing, topics: HostTopics): HostScreenSection {
  const running = runningSessions(listing, topics);
  const rows: HostScreenRow[] = running === undefined
    ? unansweredRows(listing)
    : running.length === 0
      ? [{ kind: 'note', text: 'No Sessions on this Host.' }]
      : running.map((session) => ({
        kind: 'session',
        name: session.name,
        windowCount: session.windowCount,
        topicLabel: session.topicLabel === undefined ? null : session.topicLabel ?? 'No Topic',
        ...(session.onHost === undefined ? {} : { onHost: session.onHost }),
      }));
  const notice = hostScreenTabs(topics).includes('board') ? [] : topicsNotice(topics);
  return { id: 'sessions', title: null, rows: [...notice, ...rows] };
}

/** A running Session of the Listing, joined with what the Host's Topics say of it. */
export interface RunningSession {
  name: string;
  windowCount: number | undefined;
  /** The label of its Topic, or null for a Session in no Topic. Undefined when the Host has not said. */
  topicLabel: string | null | undefined;
  /** Its id and whether it is in a Topic, from the Host Server's snapshot. Undefined when the Host has not said. */
  onHost?: SessionOnHost;
}

/** The Host's Sessions in the order the Host lists them, or undefined while the Host has no answer. */
export function runningSessions(listing: Listing, topics: HostTopics): RunningSession[] | undefined {
  const snapshot = lastSnapshot(topics);
  const bySession = new Map(snapshot?.sessions.map((session) => [session.name, session]));
  const labels = new Map(
    snapshot === null ? [] : [...snapshot.pinned, ...snapshot.unpinned.places, ...snapshot.unpinned.guests, ...snapshot.unpinned.bench]
      .flatMap((card): [TopicId, string][] => (card.kind === 'topic' ? [[card.topic.id, card.topic.label]] : [])),
  );
  return lastAnswer(listing)?.map((live) => {
    const known = bySession.get(live.name);
    return {
      name: live.name,
      windowCount: live.windowCount ?? known?.windows?.length,
      topicLabel: known === undefined ? undefined : known.topic === null ? null : labels.get(known.topic),
      ...(known === undefined ? {} : { onHost: { id: known.id, inTopic: known.topic !== null } }),
    };
  });
}

/**
 * What stands in for the Host's Sessions while it has no answer: the first
 * question is still in flight, or the Host refused it. A later question is
 * answered from what is already on screen while it is in flight, so it has
 * nothing to show. A Host that could not be asked has its Host Problem row.
 */
function unansweredRows(listing: Listing): HostScreenRow[] {
  switch (listing.phase) {
    case 'failed':
      return [{ kind: 'refused', message: listing.message }];
    case 'host-problem':
      return [];
    case 'reading':
    case 'read':
      return [{ kind: 'checking', text: 'Checking Sessions…' }];
  }
}
