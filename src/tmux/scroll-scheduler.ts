/** Scrolls the Pane by this many lines. Positive goes back into the past. */
export type ApplyScroll = (lines: number) => Promise<void>;

export interface ScrollScheduler {
  /** Asks for this many more lines of scroll, eventually. */
  request(lines: number): void;
  /** Throws away anything not yet sent. For leaving, or switching Session. */
  reset(): void;
}

/**
 * Coalesces scrolling so a flick cannot flood the Host.
 *
 * A finger produces deltas at sixty a second and each one would otherwise be
 * its own Control Command. So: at most one in flight, and everything that
 * arrives behind it is *added* rather than replaced — which is the whole
 * difference from resizing, where only the newest size matters. A scroll that
 * is dropped is distance the user asked for and did not get.
 *
 * This is why the distance can be honest where remux's cannot. Its wheel
 * reports cost the remote application one repaint each, so it has to cap the
 * rate and throw away the excess — a violent flick scrolls less than the
 * finger asked. Here the whole accumulated distance rides one `-N` count, so
 * a flick of four hundred lines is the same single command as a flick of four.
 *
 * The round trip is the debounce window: a slow Host coalesces harder, a fast
 * one barely at all, and neither needs a tuned delay.
 */
export function createScrollScheduler(apply: ApplyScroll): ScrollScheduler {
  let inFlight = false;
  let pending = 0;

  function run(lines: number): void {
    inFlight = true;

    const settle = () => {
      inFlight = false;
      const next = pending;
      pending = 0;
      if (next !== 0) run(next);
    };

    // A failed scroll must not wedge the scheduler: the Pane is still usable,
    // and the next flick should still get its chance.
    apply(lines).then(settle, settle);
  }

  return {
    request(lines: number): void {
      if (lines === 0) return;
      if (inFlight) {
        pending += lines;
        return;
      }
      run(lines);
    },

    reset(): void {
      pending = 0;
    },
  };
}
