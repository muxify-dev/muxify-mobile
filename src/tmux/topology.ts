import type { ControlEvent } from './control-protocol';
import { parseWindowLayout } from './layout';
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
  /** The Pane that output belongs to and input is aimed at. */
  activePane?: Pane;
}

export const EMPTY_TOPOLOGY: Topology = { windows: [], panes: [] };

/**
 * What a notification did to the model, as far as this file is concerned.
 *
 * `stale` is the honest answer to most of them: `%window-add @3` says a Window
 * exists and nothing else — not its index, not its name, not what it is
 * running. Reconstructing all of that from ids would be a second model of
 * tmux's state, kept in step by hand, which is exactly the reconciler ADR 0006
 * declined to port. So the notification says *that* something changed and the
 * Topology is read again, once, rather than every time a picker opens.
 *
 * Internal. It used to be the answer `apply` gave its caller, which meant
 * every caller had to know what `'stale'` obliged it to do; the store reads
 * again itself now.
 */
type Applied = 'unchanged' | 'changed' | 'stale';

export interface TopologyStore {
  current(): Topology;
  /** Reads the whole Topology from the Host. */
  refresh(): Promise<Topology>;
  /** The Session this is the Topology of, which a switch moves. */
  attachedTo(sessionName: string): void;
  /**
   * Folds one notification in, and reads again if the notification did not
   * carry enough to be acted on.
   */
  apply(event: ControlEvent): void;
  /**
   * Moves the active Pane here, ahead of the Host being told.
   *
   * A tap on a Pane is a round trip and then a `%window-pane-changed` on top of
   * it, and a highlight that waits for both lands a beat after the finger. The
   * move is small and the Host is about to agree, so it is made here first;
   * whichever of the two comes back changes nothing further.
   *
   * Answers whether the Pane was there to move to.
   */
  activate(paneId: string): boolean;
  /** Called whenever the model changes, however it changed. */
  subscribe(listener: (topology: Topology) => void): () => void;
  /** Nothing more is wanted: no listener fires and no refresh is started. */
  dispose(): void;
}

/**
 * A Session's Windows and Panes, kept by what tmux pushes.
 *
 * The polled version read everything each time a picker opened, so a picker
 * showed what was true one round trip ago and needed a cache and a warm-up to
 * feel like it opened at all. A control client is told instead: `%layout-change`
 * carries the same `#{window_layout}` string `layout.ts` already parses, and
 * `%window-add`, `%window-close`, `%window-renamed` and `%window-pane-changed`
 * carry the rest.
 *
 * Two kinds of notification, and the difference is what they carry. A rename, a
 * close and a layout change each say enough to act on, so they are applied here
 * and the model is right before the sheet opens. An add says only that a Window
 * now exists, so it marks the model stale and the caller reads again — once,
 * when it happened, rather than every time somebody looks.
 */
export function createTopologyStore(
  reader: TopologyReader,
  sessionName: string,
  options: { onTrouble?: (error: unknown) => void } = {},
): TopologyStore {
  let topology: Topology = EMPTY_TOPOLOGY;
  let session = sessionName;
  let disposed = false;
  const listeners = new Set<(topology: Topology) => void>();

  /** A read in flight, and whether another was asked for behind it. */
  let reading = false;
  let again = false;

  function publish(next: Topology): Topology {
    topology = next;
    if (disposed) return next;
    for (const listener of listeners) listener(next);
    return next;
  }

  /**
   * Reads again, coalescing the burst of notifications one change produces.
   *
   * A `split-window` on the laptop pushes a `%layout-change`, a `%window-add`
   * and a `%window-pane-changed` in the same breath. Each one that cannot be
   * acted on asks for a read, and three reads for one split is three round
   * trips where one would do — so the round trip is the debounce, exactly as
   * it is for a Pane's repaint.
   */
  function reread(): void {
    if (disposed) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    void refreshNow()
      .catch((error: unknown) => options.onTrouble?.(error))
      .finally(() => {
        reading = false;
        if (!again) return;
        again = false;
        reread();
      });
  }

  async function refreshNow(): Promise<Topology> {
    const windows = await reader.listWindows(session);
    if (disposed) return topology;
    // tmux always marks one, but a Session read mid-change may not have one
    // yet; the first Window is a better guess than giving up.
    const activeWindow = windows.find((window) => window.active) ?? windows[0];
    if (!activeWindow) return publish({ windows, panes: [] });

    const panes = await reader.listPanes(session, activeWindow.index);
    if (disposed) return topology;
    return publish({
      windows,
      activeWindow,
      panes,
      activePane: panes.find((pane) => pane.active) ?? panes[0],
    });
  }

  /** The one place the active Pane moves, whoever asked for it. */
  function activatePane(paneId: string): Applied {
    const target = topology.panes.find((pane) => pane.id === paneId);
    if (!target) return 'stale';
    if (target.active && topology.activePane?.id === paneId) return 'unchanged';
    const panes = topology.panes.map((pane) => ({ ...pane, active: pane.id === paneId }));
    publish({ ...topology, panes, activePane: panes.find((pane) => pane.active) });
    return 'changed';
  }

  function applyEvent(event: ControlEvent): Applied {
      switch (event.kind) {
        case 'window-renamed':
        case 'unlinked-window-renamed': {
          // A Window renamed on the laptop renames here, with no round trip:
          // the notification carries the new name and the id it belongs to.
          const windows = topology.windows.map((window) =>
            window.id === event.window ? { ...window, name: event.name } : window,
          );
          if (windows.every((window, at) => window === topology.windows[at])) return 'unchanged';
          publish({
            ...topology,
            windows,
            activeWindow: windows.find((window) => window.id === topology.activeWindow?.id),
          });
          return 'changed';
        }

        case 'window-close':
        case 'unlinked-window-close': {
          // Unlinked as well as linked: tmux unlinks a Window from its Session
          // before killing it, so the Window that just vanished from under the
          // user arrives as `%unlinked-window-close`.
          if (!topology.windows.some((window) => window.id === event.window)) return 'unchanged';
          const windows = topology.windows.filter((window) => window.id !== event.window);
          publish({ ...topology, windows });
          // Which Window is active now, and what is in it, is not in the
          // notification.
          return 'stale';
        }

        case 'layout-change': {
          if (event.window !== topology.activeWindow?.id) {
            // A layout change in another Window still changes its Pane count,
            // which the Windows picker shows.
            return topology.windows.some((window) => window.id === event.window)
              ? 'stale'
              : 'unchanged';
          }
          const rects = parseWindowLayout(event.layout);
          if (rects.size === 0) return 'stale';
          // A Pane that is not in the layout is one the layout was parsed
          // before: read again rather than draw it in the wrong place.
          if (topology.panes.some((pane) => !rects.has(paneNumber(pane.id)))) return 'stale';
          if (rects.size !== topology.panes.length) return 'stale';

          const panes = topology.panes.map((pane) => ({
            ...pane,
            ...(rects.get(paneNumber(pane.id)) as NonNullable<ReturnType<typeof rects.get>>),
          }));
          // Zoom rides along in the flags, and has to: the Layout describes the
          // arrangement zoom is hiding, so the rectangles are the same whether
          // or not one Pane is filling the Window. Without reading this, a zoom
          // toggled anywhere but here would never be noticed.
          const windows = topology.windows.map((window) =>
            window.id === event.window
              ? { ...window, zoomed: event.flags.includes('Z') }
              : window,
          );
          publish({
            ...topology,
            windows,
            activeWindow: windows.find((window) => window.id === topology.activeWindow?.id),
            panes,
            activePane: panes.find((pane) => pane.id === topology.activePane?.id),
          });
          return 'changed';
        }

        case 'window-pane-changed': {
          if (event.window !== topology.activeWindow?.id) return 'unchanged';
          // Ordinarily this is tmux confirming a move already made here by a
          // tap, and there is nothing left to do; a `select-pane` on the laptop
          // is the same notification and moves it for real.
          return activatePane(event.pane);
        }

        case 'window-add':
        case 'session-window-changed':
        case 'session-changed':
          // Each says a thing exists or is current, and nothing about it.
          return 'stale';

      default:
        // `%sessions-changed`, `%pane-mode-changed`, everything tmux adds
        // later: none of it is about this Session's shape.
        return 'unchanged';
    }
  }

  return {
    current: () => topology,

    refresh: refreshNow,

    attachedTo(next: string): void {
      session = next;
    },

    apply(event: ControlEvent): void {
      if (disposed) return;
      if (applyEvent(event) === 'stale') reread();
    },

    activate: (paneId: string) => activatePane(paneId) !== 'stale',

    subscribe(listener: (topology: Topology) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
    },
  };
}

/** `%3` as the 3 the layout string names it by. */
function paneNumber(paneId: string): number {
  const parsed = Number(paneId.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : -1;
}
