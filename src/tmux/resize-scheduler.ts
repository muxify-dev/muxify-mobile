import { sameGrid, type Grid } from './tmux-client';

/** Pushes one size to the remote Session. Resolves when the Host has it. */
export type ApplyGrid = (grid: Grid) => Promise<void>;

export interface ResizeScheduler {
  /**
   * Asks for the remote Session to be this size, eventually.
   *
   * `force` sends it even when it is the size already applied, for when the
   * *target* has changed rather than the size: a Session switched into has its
   * own Window, sized for whoever attached to it last, and a Window reshaped
   * behind a sheet has been laid out for whatever Client last spoke.
   */
  request(grid: Grid, force?: boolean): void;
}

/**
 * Coalesces remote resizes so a burst of them cannot flood the Host.
 *
 * A Surface being laid out reports a grid more than once — a rotation, a sheet
 * closing, the first frames after mounting — and each one would otherwise
 * become its own Control Command: several round trips for one change, landing
 * out of order, tmux reflowing for every size the Surface passed through on
 * its way to the one it settled at. (The keyboard used to be the worst of
 * these, a grid per frame of its animation; it no longer resizes the Window at
 * all — see ADR 0008.)
 *
 * So: at most one resize in flight, and only the newest size behind it. The
 * first request of a burst goes immediately, because a Surface waiting for its
 * size is a Surface showing the wrong thing, and everything that arrives
 * mid-flight collapses into a single follow-up. The round trip is the debounce
 * window, which is why there is no timer here: a slow Host coalesces harder, a
 * fast one barely at all, and neither needs a tuned delay.
 *
 * Implementation of `createClientSizing`, which is the only thing that builds
 * one. It used to be reached for directly by the Terminal Screen, which meant
 * every caller had to know it dedups in order to defeat the dedup — see the
 * `force` flag, which is the whole of what `reset()` used to be.
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
    request(grid: Grid, force = false): void {
      if (force) applied = null;
      if (inFlight) {
        pending = grid;
        return;
      }
      if (sameGrid(grid, applied)) return;
      run(grid);
    },
  };
}
