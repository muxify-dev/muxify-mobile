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
 * What a notification did to the model.
 *
 * `stale` is the honest answer to most of them: `%window-add @3` says a Window
 * exists and nothing else — not its index, not its name, not what it is
 * running. Reconstructing all of that from ids would be a second model of
 * tmux's state, kept in step by hand, which is exactly the reconciler ADR 0006
 * declined to port. So the notification says *that* something changed and the
 * Topology is read again, once, rather than every time a picker opens.
 */
export type Applied = 'unchanged' | 'changed' | 'stale';

export interface TopologyStore {
  current(): Topology;
  /** Reads the whole Topology from the Host. */
  refresh(sessionName: string): Promise<Topology>;
  /**
   * Folds one notification in.
   *
   * Returns `changed` when the model is now right, `stale` when the caller
   * should read again, and `unchanged` when the notification was about
   * something this Session does not hold.
   */
  apply(event: ControlEvent): Applied;
  /** Called whenever the model changes, however it changed. */
  subscribe(listener: (topology: Topology) => void): () => void;
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
export function createTopologyStore(reader: TopologyReader): TopologyStore {
  let topology: Topology = EMPTY_TOPOLOGY;
  const listeners = new Set<(topology: Topology) => void>();

  function publish(next: Topology): Topology {
    topology = next;
    for (const listener of listeners) listener(next);
    return next;
  }

  return {
    current: () => topology,

    async refresh(sessionName: string): Promise<Topology> {
      const windows = await reader.listWindows(sessionName);
      // tmux always marks one, but a Session read mid-change may not have one
      // yet; the first Window is a better guess than giving up.
      const activeWindow = windows.find((window) => window.active) ?? windows[0];
      if (!activeWindow) return publish({ windows, panes: [] });

      const panes = await reader.listPanes(sessionName, activeWindow.index);
      return publish({
        windows,
        activeWindow,
        panes,
        activePane: panes.find((pane) => pane.active) ?? panes[0],
      });
    },

    apply(event: ControlEvent): Applied {
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
          publish({
            ...topology,
            panes,
            activePane: panes.find((pane) => pane.id === topology.activePane?.id),
          });
          return 'changed';
        }

        case 'window-pane-changed': {
          if (event.window !== topology.activeWindow?.id) return 'unchanged';
          if (!topology.panes.some((pane) => pane.id === event.pane)) return 'stale';
          const panes = topology.panes.map((pane) => ({
            ...pane,
            active: pane.id === event.pane,
          }));
          publish({ ...topology, panes, activePane: panes.find((pane) => pane.active) });
          return 'changed';
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
    },

    subscribe(listener: (topology: Topology) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `%3` as the 3 the layout string names it by. */
function paneNumber(paneId: string): number {
  const parsed = Number(paneId.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : -1;
}
