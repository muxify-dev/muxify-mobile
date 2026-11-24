import type { RecentSession } from '@/storage/records';
import { availableName, folderSessionName } from '@/topics/add-session';
import { searchFields, type SessionPathRow } from '@/topics/session-paths';

/** A running Session as Go to lists it: the Listing joined with the Host's Topics. */
export interface GoToSession {
  name: string;
  /** The Topic it is in, or null for a Session in no Topic or a Host with no Topics. */
  topicLabel: string | null;
}

export type GoToRow =
  | ({ kind: 'session' } & GoToSession)
  | { kind: 'path'; path: SessionPathRow }
  /** A folder the user typed, where a leading `~` is the Host's home folder. */
  | { kind: 'typed'; directory: string };

/** `all` is Go to. `paths` is New Session at a folder and Add a Session, which list no running Session. */
export type GoToMode = 'all' | 'paths';

/** The Session Paths the phone holds, and the text of the field that the Host ranked them for. */
export interface RankedPaths {
  query: string;
  rows: readonly SessionPathRow[];
}

export interface GoToInput {
  query: string;
  mode: GoToMode;
  /** In the order tmux lists them. */
  sessions: readonly GoToSession[];
  paths: RankedPaths;
  recent: readonly RecentSession[];
}

/**
 * The one list of Go to: the running Sessions, then the Session Paths and
 * Worktrees, then the folder the user typed.
 *
 * The Host ranks the paths, with the Mac's match, so they keep the order they
 * came in. While the Host has not answered for the text in the field, the
 * paths on hand are for other text: the phone then keeps the ones that match,
 * in their order, and with an empty field puts the last visited first, as the
 * Host does. The Host's answer replaces them.
 *
 * The phone matches the running Sessions itself. The ones this phone opened
 * come first, newest first, and the rest follow in tmux's order.
 */
export function goToRows({ query, mode, sessions, paths, recent }: GoToInput): GoToRow[] {
  const text = query.trim();

  return [
    ...(mode === 'all' ? rankedSessions(sessions, recent, text) : []).map((session): GoToRow => ({ kind: 'session', ...session })),
    ...shownPaths(paths, text).map((path): GoToRow => ({ kind: 'path', path })),
    ...typedFolderRows(text),
  ];
}

export function typedFolderRows(query: string): Extract<GoToRow, { kind: 'typed' }>[] {
  const directory = query.trim();
  return directory.startsWith('~') || directory.startsWith('/') ? [{ kind: 'typed', directory }] : [];
}

function rankedSessions(sessions: readonly GoToSession[], recent: readonly RecentSession[], text: string): GoToSession[] {
  const openedAt = new Map(recent.map((session) => [session.name, session.lastOpenedAt]));
  return sessions
    .filter((session) => matches(text, [session.name, session.topicLabel ?? '']))
    .map((session, index) => ({ session, index, opened: openedAt.get(session.name) ?? '' }))
    .sort((left, right) => (left.opened === right.opened ? left.index - right.index : left.opened < right.opened ? 1 : -1))
    .map(({ session }) => session);
}

function shownPaths(paths: RankedPaths, text: string): readonly SessionPathRow[] {
  if (paths.query.trim() === text) return paths.rows;
  const matching = paths.rows.filter((row) => matches(text, searchFields(row)));
  if (text !== '') return matching;
  return matching
    .map((row, index) => ({ row, index, visited: row.lastVisit ?? '' }))
    .sort((left, right) => (left.visited === right.visited ? left.index - right.index : left.visited < right.visited ? 1 : -1))
    .map(({ row }) => row);
}

/** Whether the letters of `text` come in this order in one of the fields, in either case. */
function matches(text: string, fields: readonly string[]): boolean {
  const wanted = text.toLocaleLowerCase();
  return fields.some((field) => {
    const within = field.toLocaleLowerCase();
    let at = 0;
    for (const letter of wanted) {
      at = within.indexOf(letter, at) + 1;
      if (at === 0) return false;
    }
    return true;
  });
}

/** What a pick of a folder does: goes to the Session that runs there, or makes one with this name. */
export type PathOpening = { kind: 'go'; directory: string; session: string } | { kind: 'new'; directory: string; name: string };

/**
 * What a pick of a path row does, by the Mac's rule for Go to. A Session in
 * no Topic has the name of its Session Path, so a running Session with that
 * name is the one at the folder, and the pick goes to it. Otherwise the pick
 * makes it. `another` is New Session here: it always makes one, with the next
 * free name (`+2`, `+3`).
 */
export function pathOpening(
  row: Extract<GoToRow, { kind: 'path' | 'typed' }>,
  sessionNames: readonly string[],
  another: boolean,
): PathOpening {
  const directory = row.kind === 'path' ? row.path.directory : row.directory;
  const base = row.kind === 'path' ? row.path.name : folderSessionName(directory);
  return folderOpening(directory, base, sessionNames, another);
}

export function folderOpening(directory: string, base: string, sessionNames: readonly string[], another: boolean): PathOpening {
  const taken = new Set(sessionNames);
  if (!another && taken.has(base)) return { kind: 'go', directory, session: base };
  return { kind: 'new', directory, name: availableName(base, taken) };
}
