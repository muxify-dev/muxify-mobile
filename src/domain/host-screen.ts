import { lastAnswer, waitingOnFirstAnswer, type Listing } from '@/domain/host-listing';
import type { Settings } from '@/settings/settings';
import type { RecentSession } from '@/storage/records';
import type { Session } from '@/tmux/tmux-client';

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
  | { kind: 'checking' }
  /** The Host could not be asked. The screen offers Retry. */
  | { kind: 'refused'; message: string }
  | { kind: 'note'; text: string };

export interface HostScreenSection {
  id: 'recent' | 'available' | 'topics';
  title: string;
  footer: string | null;
  rows: HostScreenRow[];
}

export interface HostScreenInput {
  settings: Pick<Settings, 'hostScreenLists'>;
  /** This Host's Recent Sessions, newest first. */
  recent: RecentSession[];
  listing: Listing;
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
 */
export function hostScreen({ settings, recent, listing }: HostScreenInput): HostScreenSection[] {
  return settings.hostScreenLists.flatMap((list) =>
    list === 'sessions' ? sessionsList(recent, listing) : [TOPICS_PLACEHOLDER],
  );
}

const TOPICS_PLACEHOLDER: HostScreenSection = {
  id: 'topics',
  title: 'Topics',
  footer: null,
  rows: [{ kind: 'note', text: 'Topics come in a later version.' }],
};

function sessionsList(recent: RecentSession[], listing: Listing): HostScreenSection[] {
  const listed = lastAnswer(listing);
  const onHost = new Map(listed?.map((session) => [session.name, session]));
  const remembered = new Set(recent.map((session) => session.name));

  const recentRows: RecentRow[] = recent.flatMap((session) => {
    const live = onHost.get(session.name);
    if (listed !== undefined && !live) return [];
    return [
      {
        kind: 'recent',
        name: session.name,
        lastOpenedAt: session.lastOpenedAt,
        windowCount: live?.windowCount,
      },
    ];
  });

  const available: Session[] = (listed ?? [])
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

function availableRows(available: Session[], listing: Listing): HostScreenRow[] {
  if (available.length > 0) {
    return available.map((session) => ({ kind: 'available', name: session.name }));
  }
  // Only ever the first question. A later one is answered from what is
  // already on screen while it is in flight, so there is nothing to see.
  if (waitingOnFirstAnswer(listing)) return [{ kind: 'checking' }];
  if (listing.phase === 'failed') return [{ kind: 'refused', message: listing.message }];
  return [{ kind: 'note', text: 'No other Sessions on this Host.' }];
}
