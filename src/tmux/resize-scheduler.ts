import type { Grid } from './tmux-client';

/** Pushes one size to the remote Session. Resolves when the Host has it. */
export type ApplyGrid = (grid: Grid) => Promise<void>;

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
 * Coalesces remote resizes so a burst of them cannot flood the Host.
 *
 * The Surface reports a new grid on every frame of the keyboard animation, and
 * each one would otherwise become its own Control Command — dozens of round
 * trips for one gesture, landing out of order, tmux reflowing for every size
 * the Surface passed through on its way to the one it settled at.
 *
 * So: at most one resize in flight, and only the newest size behind it. The
 * first request of a burst goes immediately, because a Surface waiting for its
 * size is a Surface showing the wrong thing, and everything that arrives
 * mid-flight collapses into a single follow-up. The round trip is the debounce
 * window, which is why there is no timer here: a slow Host coalesces harder, a
 * fast one barely at all, and neither needs a tuned delay.
 */
export function createResizeScheduler(apply: ApplyGrid): ResizeScheduler {
  let inFlight = false;
  let applied: Grid | null = null;
  let pending: Grid | null = null;

  function run(grid: Grid): void {
    inFlight = true;

    const settle = (landed: boolean) => {
      inFlight = false;
      // Only a resize that actually happened counts as applied. Recording it
      // up front was a quiet way to lose one: a size that failed to send was
      // remembered as if it had, so the next request for the same size was
      // skipped as redundant and the Surface stayed a different shape from the
      // Window until something else moved.
      if (landed) applied = grid;
      const next = pending;
      pending = null;
      // A burst that ends where it started needs no second round trip.
      if (next && !sameGrid(next, applied)) run(next);
    };

    // A failed resize must not wedge the scheduler: the Session is still
    // usable, and the next size should still get its chance. It is not retried
    // here either — a Host that is refusing will refuse in a loop.
    apply(grid).then(
      () => settle(true),
      () => settle(false),
    );
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
