import type { Grid } from './tmux-client';

/**
 * Pushes one size to the remote Session, told what the previous one was so it
 * can decide which half of the resize to do first. Resolves when the Host has
 * it.
 */
export type ApplyGrid = (grid: Grid, previous: Grid | null) => Promise<void>;

export interface ResizeScheduler {
  /** Asks for the remote Session to be this size, eventually. */
  request(grid: Grid): void;
  /**
   * Forgets what has been applied, so the next request is sent even if the
   * size has not changed. For when the target has: a Session switched to has
   * its own Window, sized for whoever attached to it last.
   */
  reset(): void;
}

/**
 * Coalesces remote resizes so a burst of them cannot flicker the Surface.
 *
 * The Surface reports a new grid on every frame of the keyboard animation, and
 * each one used to become its own Control Command. Those land out of order and
 * at their own pace, so tmux bounces between sizes; while its Window is smaller
 * than the Surface, tmux pads the rows it is not drawing and the user sees them
 * fill with dots.
 *
 * So: at most one resize in flight, and only the newest size behind it. The
 * first request of a burst goes immediately — a resize that is late is exactly
 * what shows the padding, so growth must never be deferred — and everything
 * that arrives mid-flight collapses into a single follow-up. The round trip is
 * the debounce window, which is why there is no timer here: a slow Host
 * coalesces harder, a fast one barely at all, and neither needs a tuned delay.
 */
export function createResizeScheduler(apply: ApplyGrid): ResizeScheduler {
  let inFlight = false;
  let applied: Grid | null = null;
  let pending: Grid | null = null;

  function run(grid: Grid): void {
    const previous = applied;
    inFlight = true;
    applied = grid;

    const settle = () => {
      inFlight = false;
      const next = pending;
      pending = null;
      // A burst that ends where it started needs no second round trip.
      if (next && !sameGrid(next, applied)) run(next);
    };

    // A failed resize must not wedge the scheduler: the Session is still
    // usable, and the next size should still get its chance.
    apply(grid, previous).then(settle, settle);
  }

  return {
    request(grid: Grid): void {
      if (inFlight) {
        pending = grid;
        return;
      }
      if (sameGrid(grid, applied)) return;
      run(grid);
    },

    reset(): void {
      applied = null;
      pending = null;
    },
  };
}

function sameGrid(a: Grid, b: Grid | null): boolean {
  return b !== null && a.cols === b.cols && a.rows === b.rows;
}
