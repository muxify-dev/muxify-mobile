import type { BrowserTab } from '@/browser/tabs';
import type { Pane } from '@/tmux/tmux-client';

import type { TitleRow, TitleWindowRow } from './title-rows';

/**
 * One row of the Edge Drawer. Each kind but `topic` is a Destination: a pick
 * on it goes there.
 *
 * `session` is the Session the row sits under, so a pick names it even when
 * it is the attached one.
 */
export type DestinationRow =
  | { kind: 'topic'; key: string; label: string }
  | { kind: 'session'; key: string; name: string; current: boolean }
  | { kind: 'window'; key: string; session: string; window: TitleWindowRow }
  | { kind: 'pane'; key: string; pane: Pane }
  | { kind: 'tab'; key: string; session: string; window: TitleWindowRow; tab: BrowserTab };

export interface DestinationInput {
  /** The label of the Topic the Attach holds, or null when it holds none. */
  topic: string | null;
  /** What the Title Sheet's Windows list shows: the Topic's Sessions with their Windows, or the attached Session's Windows. */
  rows: TitleRow[];
  attachedSession: string;
  /** The Panes of the Window on screen. */
  panes: Pane[];
  /** The Browser Tabs read so far, by Window id. A Window not read yet has none. */
  tabs: ReadonlyMap<string, BrowserTab[]>;
}

/**
 * The Edge Drawer's rows, in reading order: the Topic the Attach holds, or
 * the attached Session when it holds none, with every Window, the Panes of
 * the Window on screen and the Tabs of each Window. Nothing of other Topics
 * or Sessions: the Host Screen reaches those. See D4 of the proposal.
 */
export function destinationRows(input: DestinationInput): DestinationRow[] {
  const rows: DestinationRow[] = [];
  if (input.topic !== null) rows.push({ kind: 'topic', key: 'topic', label: input.topic });
  for (const row of input.rows) {
    if (row.kind === 'window') {
      pushWindow(rows, input, input.attachedSession, row);
      continue;
    }
    rows.push({ kind: 'session', key: `session:${row.name}`, name: row.name, current: row.current });
    for (const window of row.windows) pushWindow(rows, input, row.name, window);
  }
  return rows;
}

function pushWindow(rows: DestinationRow[], input: DestinationInput, session: string, window: TitleWindowRow) {
  rows.push({ kind: 'window', key: `window:${session}:${window.id}`, session, window });
  // One Pane is the Window itself: a row for it would go nowhere new.
  if (window.current && input.panes.length > 1) {
    for (const pane of input.panes) rows.push({ kind: 'pane', key: `pane:${pane.id}`, pane });
  }
  for (const tab of input.tabs.get(window.id) ?? []) {
    rows.push({ kind: 'tab', key: `tab:${window.id}:${tab.id}`, session, window, tab });
  }
}

/** The Window ids whose Tabs the drawer reads when it opens: every Window it lists. */
export function listedWindows(rows: TitleRow[]): string[] {
  return rows.flatMap((row) => (row.kind === 'window' ? [row.id] : row.windows.map((window) => window.id)));
}
