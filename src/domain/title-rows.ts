import type { TopicDetail } from '@/topics/topic-detail';
import type { Mark } from '@/topics/environment';
import type { Topology } from '@/tmux/topology';

/** One Window in the Title Sheet. */
export interface TitleWindowRow {
  kind: 'window';
  index: number;
  name: string;
  /** What its active Pane runs, from the Topology; null for a Window of another Session. */
  program: string | null;
  /** The Agent mark the Mac gave it; null for a Window the Mac did not describe. */
  mark: Mark | null;
  /** Whether it is the Window on screen. */
  current: boolean;
}

/**
 * What the Title Sheet lists: the Windows of the attached Session, or one
 * section per live Session of the Topic with that Session's Windows under it.
 */
export type TitleRow =
  | TitleWindowRow
  | { kind: 'session'; name: string; current: boolean; windows: TitleWindowRow[] };

/** The Windows of the attached Session, from the Topology tmux keeps current. */
export function sessionTitleRows(topology: Topology): TitleWindowRow[] {
  return topology.windows.map((window) => ({
    kind: 'window',
    index: window.index,
    name: window.name,
    program: window.command,
    mark: null,
    current: window.active,
  }));
}

/**
 * Each live Session of a Topic with its Windows, in the Mac's order.
 *
 * The attached Session's Windows also carry the program and the active mark
 * from the Topology, which is current; the Mac's read is a moment old and
 * knows neither. A Session the Mac listed with no Windows yet shows as a row
 * on its own.
 */
export function topicTitleRows(
  topic: TopicDetail,
  attached: { session: string; topology: Topology },
): TitleRow[] {
  const sessions: Extract<TitleRow, { kind: 'session' }>[] = topic.sessions.map((session) => {
    const current = session.name === attached.session;
    const marks = new Map((session.windows ?? []).map((window) => [window.id, window.mark]));
    return {
      kind: 'session' as const,
      name: session.name,
      current,
      windows: current ? attached.topology.windows.map((window) => ({
        kind: 'window' as const, index: window.index, name: window.name, program: window.command,
        mark: marks.get(window.id) ?? null, current: window.active,
      })) : (session.windows ?? []).map((window) => ({
        kind: 'window' as const, index: window.index, name: window.name, program: null,
        mark: window.mark, current: false,
      })),
    };
  });
  if (!sessions.some((session) => session.current)) {
    sessions.push({ kind: 'session', name: attached.session, current: true,
      windows: sessionTitleRows(attached.topology) });
  }
  return sessions;
}

/** How many rows a list of them draws, Sessions and their Windows alike. */
export function countTitleRows(rows: TitleRow[]): number {
  return rows.reduce((count, row) => count + 1 + (row.kind === 'session' ? row.windows.length : 0), 0);
}
