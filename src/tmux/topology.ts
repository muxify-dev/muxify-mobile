import type { Pane, Window } from './tmux-client';

/** The slice of TmuxClient a Topology read needs. */
export interface TopologyReader {
  listWindows(sessionName: string): Promise<Window[]>;
  listPanes(sessionName: string, windowIndex: number): Promise<Pane[]>;
}

/** A Session's Windows, and the Panes of whichever one is current. */
export interface Topology {
  windows: Window[];
  /** Undefined only when the Session has no Windows, which means it is gone. */
  activeWindow?: Window;
  /** Panes of `activeWindow`; empty when there is none. */
  panes: Pane[];
}

/**
 * Reads a Session's Topology.
 *
 * Two round trips, because Panes belong to a Window and tmux will not say
 * which Window is active without being asked. Called on demand — every picker
 * re-reads rather than trusting anything held from last time, see ADR 0001.
 */
export async function readTopology(
  reader: TopologyReader,
  sessionName: string,
): Promise<Topology> {
  const windows = await reader.listWindows(sessionName);

  // tmux always marks one, but a Session read mid-change may not have one yet;
  // the first Window is a better guess than giving up.
  const activeWindow = windows.find((window) => window.active) ?? windows[0];
  if (!activeWindow) {
    return { windows, panes: [] };
  }

  return {
    windows,
    activeWindow,
    panes: await reader.listPanes(sessionName, activeWindow.index),
  };
}
