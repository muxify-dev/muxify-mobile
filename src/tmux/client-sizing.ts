import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import type { Clock, Timer } from '@/lib/clock';
import { systemClock } from '@/lib/clock';

import { cellSizeOf, gridForContainer, type Extent } from './pane-layout';
import { createResizeScheduler } from './resize-scheduler';
import { sameGrid, type Grid } from './tmux-client';

/**
 * How long to let a reported grid stop moving before it is believed.
 *
 * Short enough to disappear inside the Connection it precedes, long enough to
 * outlast a SwiftUI measure pass. Measured on a device; the tests are what
 * keep it measured.
 */
export const GRID_SETTLE_MS = 80;

/**
 * How many settle windows a grid may keep moving through before the latest one
 * is taken anyway. A Surface that will not settle is still better sized from
 * its last word than not sized at all.
 */
export const GRID_SETTLE_TRIES = 12;

export interface ClientSizing {
  /**
   * A Surface spanning the whole Window reported a grid, and the size in
   * points it was laid out at.
   *
   * Only a spanning Surface: a Pane in a split reports its own share, which
   * would size the Window to a fraction of itself.
   */
  windowGridReported(grid: Grid, surface: Extent): void;
  /** The area every Pane is placed inside was laid out. */
  containerLaidOut(container: Extent): void;
  /** Whether anything on screen currently spans the whole Window. */
  spanningSurface(present: boolean): void;
  /**
   * A sheet is up, or is not.
   *
   * Told the state rather than the edge, because the edge is what the caller
   * would otherwise have to keep a flag to find — and a flag in a component
   * that exists only to notice a transition is a flag that gets out of step
   * with the transition. On the way down the Client says its size again: a
   * sheet is where a Window's shape is changed, and the Surfaces behind it
   * have not moved, so nothing else would think to mention it.
   */
  sheetPresented(open: boolean): void;
  /** The Client is pointed at another Session, whose Window is somebody else's shape. */
  sessionSwitched(): void;
  /** The Attach is up and wants its first size. */
  attached(): void;
  /**
   * Resolves with the first grid that has stopped moving.
   *
   * What Attach waits on instead of polling a ref. Resolves immediately when
   * one has already settled, so a reconnect does not wait for the Surface to
   * say anything it has already said.
   */
  settledGrid(): Promise<Grid>;
  /**
   * The last grid that stood still.
   *
   * What a reconnect is sized from, and deliberately not the latest reported
   * one: a grid read while the screen is still turning is a shape nobody asked
   * for.
   */
  stableGrid(): Grid | null;
  /**
   * The size the active Window has now, read from its Layout. Different from
   * the size this Client last asked for means another Client has the Window.
   */
  windowSized(grid: Grid): void;
  /**
   * The user did something on the phone. If another Client has the Window,
   * take it back: the phone is the one in use now.
   */
  reclaim(): void;
  /** Nothing more is wanted. Cancels the settle and strands no waiter. */
  dispose(): void;
}

/**
 * Decides how big the Client is, and says so.
 *
 * Everything that can change a Client's size enters here and nowhere else: a
 * grid a Surface reported, the container being laid out, a sheet closing, a
 * Session being switched into, the Attach coming up. What leaves is
 * `refresh-client -C`, at most one in flight, and only when it is worth
 * sending. See ADR 0006 for why that is the only command involved and why no
 * Session option is touched.
 *
 * **A grid is believed only once it has stopped moving.** A Surface used to
 * report 32x11 on a phone whose Window is 49x41, six milliseconds before it
 * reported the real one — ghostty's own default grid, announced from inside
 * surface creation before the view's size had been given to it. Sent straight
 * through, that first value squashed the Window to eleven rows, tmux
 * redistributed the Panes to fit, and growing back gave a split whose halves
 * bore no relation to the ones the user had set. tmux keeps split sizes across
 * a resize perfectly well; what it cannot do is undo a trip through a size
 * nobody asked for. The Surface no longer passes that grid on at all (ADR
 * 0009), but a Surface being laid out still reports more than once — a
 * rotation, a sheet closing — so a grid is believed only once the next settle
 * window passes without it changing.
 *
 * **A split has nothing that spans the Window**, so nothing reports the
 * Window's grid. It is worked out from the cell metric instead, measured while
 * a spanning Surface was up and kept — the font fixes the cell and a resize
 * does not change it.
 *
 * **Something has to be the ruler.** Before there is a Topology there are no
 * Panes to mount and so nothing to measure a cell from, and no arithmetic here
 * can invent one: the cell is the font's, and only a Surface knows the font.
 * So the Terminal Screen still mounts one Surface before the first Topology
 * arrives, and that is this module's decision rather than the screen's — it is
 * recorded here so the next reader does not try to delete it.
 *
 * **Nothing is sent before Attach.** Grids reported before `attached()` are
 * remembered and settled; the first size goes out when Attach asks for it, in
 * the order Attach needs — size first, so the capture that follows is of a
 * Pane the size of the Surface.
 */
export function createClientSizing(
  send: (grid: Grid) => Promise<void>,
  options: { clock?: Clock; onSettled?: (grid: Grid) => void; log?: Log } = {},
): ClientSizing {
  const clock = options.clock ?? systemClock;
  const say = speakingAs(options.log ?? silentLog, 'sizing');
  const scheduler = createResizeScheduler(send);

  /** The grid last reported, which may still be moving. */
  let reported: Grid | null = null;
  /** The size in points that produced `reported`, for the cell metric. */
  let reportedAt: Extent = { width: 0, height: 0 };
  /** The last grid that stood still for a whole settle window. */
  let stable: Grid | null = null;
  /** How big one cell is, learned from a Surface that filled the container. */
  let cell: Extent | null = null;
  let container: Extent = { width: 0, height: 0 };
  /** True until something on screen says otherwise; a single Pane spans. */
  let spanning = true;
  /** Whether there is a Client to size at all. */
  let live = false;
  /** Whether a sheet is up, so its closing can be noticed here. */
  let sheetUp = false;
  /** The grid last asked of tmux, to compare the Window against. */
  let asked: Grid | null = null;
  /** Whether the Window is at a size this Client did not ask for. */
  let taken = false;
  let disposed = false;

  let settleTimer: Timer | null = null;
  /** The grid the settle window opened on, compared against when it closes. */
  let settling: Grid | null = null;
  /** How many settle windows the current grid has been moving through. */
  let tries = 0;
  const waiting: ((grid: Grid) => void)[] = [];

  /** The grid the Client should be, from what is on screen right now. */
  function currentGrid(): Grid | null {
    if (spanning) return stable;
    if (!cell) return null;
    return gridForContainer(cell, container) ?? null;
  }

  function push(force: boolean): void {
    if (!live || disposed) return;
    const next = currentGrid();
    if (!next) {
      say(`nothing to size from: ${spanning ? 'no settled grid' : 'no cell measured'}`);
      return;
    }
    say(`asking for ${next.cols}x${next.rows}${force ? ', even if unchanged' : ''}`);
    asked = next;
    taken = false;
    scheduler.request(next, force);
  }

  /** Believes a grid: measures the cell from it, wakes Attach, and sends it. */
  function adopt(grid: Grid): void {
    stable = grid;
    // Measured here and kept, because a split mounts nothing that spans the
    // Window and so has nothing to measure. A pre-layout grid against a
    // container this size would imply a cell nothing is drawn at, which is the
    // other reason it is settled first.
    const measured = cellSizeOf(grid, reportedAt);
    if (measured) cell = measured;
    say(
      `settled on ${grid.cols}x${grid.rows}` +
        (measured ? `, cell ${measured.width.toFixed(2)}x${measured.height.toFixed(2)}` : ''),
    );

    for (const wake of waiting.splice(0)) wake(grid);
    options.onSettled?.(grid);
    push(false);
  }

  function armSettle(): void {
    clock.cancel(settleTimer);
    settleTimer = clock.after(GRID_SETTLE_MS, () => {
      settleTimer = null;
      if (disposed) return;
      const latest = reported;
      if (!latest) return;
      // Still moving. Given long enough it is taken anyway: a Surface that
      // will not settle still has to be sized for.
      if (!sameGrid(latest, settling) && tries < GRID_SETTLE_TRIES) {
        tries += 1;
        settling = latest;
        armSettle();
        return;
      }
      if (tries >= GRID_SETTLE_TRIES) say('grid would not settle; taking the latest anyway');
      tries = 0;
      settling = null;
      if (!sameGrid(latest, stable)) adopt(latest);
      else say(`grid ${latest.cols}x${latest.rows} settled where it already was`);
    });
  }

  return {
    windowGridReported(grid: Grid, surface: Extent): void {
      if (disposed) return;
      say(
        `Window grid ${grid.cols}x${grid.rows} reported at ` +
          `${Math.round(surface.width)}x${Math.round(surface.height)}`,
      );
      reported = { cols: grid.cols, rows: grid.rows };
      reportedAt = surface;
      if (settleTimer === null) {
        tries = 0;
        settling = reported;
        armSettle();
      }
    },

    containerLaidOut(next: Extent): void {
      if (disposed) return;
      container = next;
      say(`container ${Math.round(next.width)}x${Math.round(next.height)}`);
      // A spanning Surface answers a container change by reporting a new grid,
      // which is a better answer than this one — it is the Surface's own
      // measurement rather than arithmetic over a remembered cell.
      if (!spanning) push(false);
    },

    spanningSurface(present: boolean): void {
      if (disposed || present === spanning) return;
      spanning = present;
      say(present ? 'a Surface spans the Window again' : 'nothing spans the Window: a split');
      if (!present) push(false);
    },

    // Sent whatever the size says, because it is the target that moved rather
    // than the Surface. A sheet is where a Window's shape is changed — a split
    // made, a Window or Session switched into, zoom turned off — and every one
    // of those lands tmux in a Window laid out for whatever Client it last
    // heard from. A Session switched into has its own Window, sized for
    // whoever attached to it last.
    sheetPresented(open: boolean): void {
      const closing = sheetUp && !open;
      sheetUp = open;
      if (closing) {
        say('a sheet closed; saying the size again');
        push(true);
      }
    },

    sessionSwitched(): void {
      say('Session switched; saying the size again');
      push(true);
    },

    attached(): void {
      if (disposed) return;
      live = true;
      say('attached; first size');
      push(true);
    },

    settledGrid(): Promise<Grid> {
      if (stable) return Promise.resolve(stable);
      return new Promise<Grid>((resolve) => {
        waiting.push(resolve);
      });
    },

    stableGrid: () => stable,

    windowSized(grid: Grid): void {
      if (disposed || !asked) return;
      const now = !sameGrid(grid, asked);
      if (now === taken) return;
      taken = now;
      say(
        now
          ? `the Window is ${grid.cols}x${grid.rows}, not the ${asked.cols}x${asked.rows} asked for: another Client has it`
          : `the Window is back at ${grid.cols}x${grid.rows}`,
      );
    },

    reclaim(): void {
      if (disposed || !taken) return;
      say('the phone is in use; taking the Window back');
      push(true);
    },

    dispose(): void {
      disposed = true;
      clock.cancel(settleTimer);
      settleTimer = null;
      waiting.length = 0;
    },
  };
}
