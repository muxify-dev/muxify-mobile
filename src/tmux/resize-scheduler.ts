import type { Grid } from './tmux-client';

/** Pushes one size to the remote Session. Resolves when the Host has it. */
export type ApplyGrid = (grid: Grid) => Promise<void>;

export interface ResizeScheduler {
  /** Asks for the remote Session to be this size, eventually. */
  request(grid: Grid): void;
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
    apply(grid).then(settle, settle);
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
  };
}

function sameGrid(a: Grid, b: Grid | null): boolean {
  return b !== null && a.cols === b.cols && a.rows === b.rows;
}
