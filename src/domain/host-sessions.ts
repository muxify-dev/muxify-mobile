import type { Session } from '@/tmux/tmux-client';
import type { RecentSession } from '@/storage/records';

/** A Session Muxify remembers opening, as the Host Screen's first list shows it. */
export interface RecentRow {
  name: string;
  lastOpenedAt: string;
  windowCount: number | undefined;
}

/** The two lists the Host Screen draws, already reconciled. */
export interface HostSessions {
  recent: RecentRow[];
  available: Session[];
}

/**
 * Splits what Muxify remembers and what the Host is running into the two lists
 * the Host Screen shows.
 *
 * The rule is mutual exclusion by name: a Session appears under Recent or
 * under Available, never both, because they are one Session and two lists
 * would be two ways to open it.
 *
 * `listed` is `undefined` until a listing has actually succeeded, and that
 * case fails *open* — every remembered Session is shown. A Host that is
 * unreachable, slow, or has no tmux server yet must not look like a Host you
 * have never used; the moment a real answer arrives the list narrows to it.
 *
 * A remembered Session the Host no longer has is dropped from both lists, but
 * never from the records: kill it from a laptop and make it again tomorrow and
 * the row comes back where it was, still knowing when you last opened it.
 */
export function hostSessions(
  recent: RecentSession[],
  listed: Session[] | undefined,
): HostSessions {
  if (listed === undefined) {
    return {
      recent: recent.map((session) => ({
        name: session.name,
        lastOpenedAt: session.lastOpenedAt,
        windowCount: undefined,
      })),
      available: [],
    };
  }

  const onHost = new Map(listed.map((session) => [session.name, session]));
  const remembered = new Set(recent.map((session) => session.name));

  return {
    recent: recent.flatMap((session) => {
      const live = onHost.get(session.name);
      if (!live) return [];
      return [
        {
          name: session.name,
          lastOpenedAt: session.lastOpenedAt,
          windowCount: live.windowCount,
        },
      ];
    }),
    available: listed
      .filter((session) => !remembered.has(session.name))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}
