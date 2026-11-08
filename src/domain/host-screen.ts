import {
  lastAnswer,
  waitingOnFirstAnswer,
  type ListedSession,
  type Listing,
} from '@/domain/host-listing';
import type { Settings } from '@/settings/settings';
import type { RecentSession } from '@/storage/records';
import type { Card, EnvironmentSnapshot, Mark, SessionId, TopicId } from '@/topics/environment';
import { lastSnapshot, type HostTopics } from '@/topics/host-topics';

/** A Session Muxify remembers opening, as the Sessions section shows it. */
export interface RecentRow {
  kind: 'recent';
  name: string;
  lastOpenedAt: string;
  windowCount: number | undefined;
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
      mark: Mark | null;
      pinned: boolean;
      dimmed: boolean;
    }
  /** A Locked Session shown as its own card. */
  | { kind: 'locked-session'; name: string; mark: Mark | null; pinned: boolean }
  | { kind: 'open-place'; id: string }
  /** A card this phone does not know, drawn as one plain line. */
  | { kind: 'unknown-card'; text: string }
  /** The Sessions that are in no Topic, as one row that opens to list them. */
  | { kind: 'no-topic'; count: number; opened: boolean };

/** The rows that the user can open in place, by the id the screen holds them under. */
export type OpenableRow = 'no-topic';

export interface HostScreenSection {
  id: 'recent' | 'available' | 'sessions' | 'topics';
  title: string;
  footer: string | null;
  rows: HostScreenRow[];
}

export interface HostScreenInput {
  settings: Pick<Settings, 'hostScreenLists' | 'recentSessionsFirst'>;
  /** This Host's Recent Sessions, newest first. */
  recent: RecentSession[];
  listing: Listing;
  topics: HostTopics;
  /** The rows the user has opened. */
  opened: ReadonlySet<OpenableRow>;
}

/**
 * The sections of the Host Screen below its Connection section, in the order
 * the user set in Settings.
 *
 * The Sessions list is two sections, because there are two different things
 * in it: the Sessions this phone has opened before, which Muxify remembers in
 * the order you last wanted them, and everything else the Host is running.
 *
 * The rule between them is mutual exclusion by name: a Session appears under
 * Recent or under Available, never both, because they are one Session and two
 * rows would be two ways to open it.
 *
 * Until the Host has answered, every remembered Session is shown (fail open).
 * A Host that is unreachable, slow, or has no tmux server yet must not look
 * like a Host you have never used. The moment a real answer arrives the list
 * narrows to it.
 *
 * A remembered Session the Host no longer has is dropped from both sections,
 * but never from the records: kill it from a laptop and make it again tomorrow
 * and the row comes back where it was, still knowing when you last opened it.
 *
 * With both lists on, a Session that is in a Topic shows under its Topic and
 * not here, once a snapshot says which they are: one Session, one row. The
 * Sessions that are in no Topic then show only in the Sessions list, so the
 * Topics list has no No Topic row. With Topics on its own, that row is the
 * only way to a Session that is in no Topic.
 */
export function hostScreen({
  settings,
  recent,
  listing,
  topics,
  opened,
}: HostScreenInput): HostScreenSection[] {
  const lists = settings.hostScreenLists;
  const sessionsShown = lists.includes('sessions');
  const snapshot = lastSnapshot(topics);
  const inTopics =
    sessionsShown && lists.includes('topics') && snapshot ? namesInTopics(snapshot) : NONE;

  const sessionsRecent = recent.filter((session) => !inTopics.has(session.name));
  const sessionsListing = without(listing, inTopics);

  return lists.flatMap((list) => {
    if (list === 'topics') return [topicsList(topics, opened, sessionsShown)];
    return settings.recentSessionsFirst
      ? sessionsList(sessionsRecent, sessionsListing)
      : [hostOrderList(sessionsRecent, sessionsListing)];
  });
}

const NONE: ReadonlySet<string> = new Set();

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

function topicsList(
  topics: HostTopics,
  opened: ReadonlySet<OpenableRow>,
  sessionsShown: boolean,
): HostScreenSection {
  const cards = (snapshot: EnvironmentSnapshot) => cardRows(snapshot, opened, !sessionsShown);
  const rows = ((): HostScreenRow[] => {
    switch (topics.kind) {
      case 'absent':
        return [{ kind: 'note', text: 'No Topics on this Host' }];
      case 'old':
        return [{ kind: 'note', text: 'Update Muxify on this Host' }];
      case 'loading':
        return topics.last ? cards(topics.last) : [{ kind: 'checking', of: 'Topics' }];
      case 'failed':
        return [{ kind: 'refused', message: topics.error }, ...(topics.last ? cards(topics.last) : [])];
      case 'listed':
        return cards(topics.snapshot);
    }
  })();
  return { id: 'topics', title: 'Topics', footer: null, rows };
}

/**
 * The cards in the order the Mac's Topics mode draws them: Pinned first, then
 * the list in the order it came, or with In Play the places, the Guests and
 * the Bench. Never sorted: the order is the Mac's, and a card the phone moved
 * would not be where the user looks for it on the Mac.
 */
function cardRows(
  snapshot: EnvironmentSnapshot,
  opened: ReadonlySet<OpenableRow>,
  withNoTopic: boolean,
): HostScreenRow[] {
  const names = new Map<SessionId, string>(
    snapshot.sessions.map((session) => [session.id, session.name]),
  );
  const { unpinned } = snapshot;
  const rest =
    unpinned.kind === 'list'
      ? unpinned.cards
      : [...unpinned.places, ...unpinned.guests, ...unpinned.bench];

  const rows = [
    ...snapshot.pinned.map((card) => cardRow(card, true, names)),
    ...rest.map((card) => cardRow(card, false, names)),
  ];

  if (withNoTopic && snapshot.no_topic.length > 0) {
    const isOpened = opened.has('no-topic');
    rows.push({ kind: 'no-topic', count: snapshot.no_topic.length, opened: isOpened });
    if (isOpened) {
      for (const id of snapshot.no_topic) {
        const name = names.get(id);
        if (name !== undefined) rows.push({ kind: 'available', name });
      }
    }
  }

  return rows.length > 0 ? rows : [{ kind: 'note', text: 'No Topics yet.' }];
}

function cardRow(card: Card, pinned: boolean, names: ReadonlyMap<SessionId, string>): HostScreenRow {
  switch (card.kind) {
    case 'topic':
      return {
        kind: 'topic',
        id: card.topic.id,
        label: card.topic.label,
        note: card.topic.note,
        mark: card.mark,
        pinned,
        dimmed: card.topic.state !== 'live',
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
 * The Sessions list with Recent Sessions first turned off: one section in the
 * order the Host lists its Sessions, which is the order the Mac shows. A
 * remembered Session keeps its Recent row here, so it can still be forgotten
 * or disconnected. Before the Host answers there is no Host order, so the
 * remembered Sessions show as they do with the switch on (fail open).
 */
function hostOrderList(recent: RecentSession[], listing: Listing): HostScreenSection {
  const listed = lastAnswer(listing);
  const remembered = new Map(recent.map((session) => [session.name, session]));

  const rows: HostScreenRow[] =
    listed === undefined
      ? [...recent.map((session) => recentRow(session, undefined)), unansweredRow(listing)]
      : listed.map((live): HostScreenRow => {
          const session = remembered.get(live.name);
          return session
            ? recentRow(session, live.windowCount)
            : { kind: 'available', name: live.name };
        });

  return {
    id: 'sessions',
    title: 'Sessions',
    footer: null,
    rows: rows.length > 0 ? rows : [{ kind: 'note', text: 'No Sessions on this Host.' }],
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

function sessionsList(recent: RecentSession[], listing: Listing): HostScreenSection[] {
  const listed = lastAnswer(listing);
  const onHost = new Map(listed?.map((session) => [session.name, session]));
  const remembered = new Set(recent.map((session) => session.name));

  const recentRows: RecentRow[] = recent.flatMap((session) => {
    const live = onHost.get(session.name);
    if (listed !== undefined && !live) return [];
    return [recentRow(session, live?.windowCount)];
  });

  const available: ListedSession[] = (listed ?? [])
    .filter((session) => !remembered.has(session.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [
    {
      id: 'recent',
      title: 'Sessions',
      footer: null,
      rows:
        recentRows.length > 0
          ? recentRows
          : [
              {
                kind: 'note',
                text: waitingOnFirstAnswer(listing)
                  ? 'Nothing opened on this Host yet.'
                  : 'Nothing opened on this Host yet. Pick one below to start.',
              },
            ],
    },
    {
      id: 'available',
      title: 'Available on Host',
      footer: available.length > 0 ? 'Opening one adds it to Sessions above.' : null,
      rows: availableRows(available, listing),
    },
  ];
}

function availableRows(available: ListedSession[], listing: Listing): HostScreenRow[] {
  if (available.length > 0) {
    return available.map((session) => ({ kind: 'available', name: session.name }));
  }
  if (lastAnswer(listing) === undefined) return [unansweredRow(listing)];
  return [{ kind: 'note', text: 'No other Sessions on this Host.' }];
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
