/**
 * Unread on visit, as the Mac's rule: an entry reads every shown Pane, and
 * after it only a Pane that newly shows, such as after an unzoom, a split or
 * a move to another Window. Nothing is read while the Terminal Screen is out
 * of focus, nor before what it shows has settled.
 */
export interface PaneVisit {
  /** The Terminal Screen came into focus, which is an entry. Returns the call that says it lost focus. */
  focus(): () => void;
  /** The Attach moved to another Session: the next look reads every shown Pane. */
  enter(): void;
  /**
   * Looks at the Panes shown now and reads the new ones with `read`, which
   * answers whether it sent them. Panes it did not send stay new for the
   * next look.
   */
  observe(shown: readonly string[], settled: boolean, read: (panes: string[]) => boolean): void;
}

export function createPaneVisit(): PaneVisit {
  // A count, not a flag: focus can overlap, one Terminal Screen gaining it before another loses it.
  let focusCount = 0;
  /** The Panes read since the last entry that are still shown. */
  let read: ReadonlySet<string> = new Set();

  return {
    focus() {
      focusCount += 1;
      read = new Set();
      let focused = true;
      return () => {
        if (!focused) return;
        focused = false;
        focusCount -= 1;
      };
    },

    enter() {
      read = new Set();
    },

    observe(shown, settled, send) {
      if (focusCount === 0 || !settled) return;
      const fresh = shown.filter((pane) => !read.has(pane));
      if (fresh.length > 0 && !send(fresh)) return;
      read = new Set(shown);
    },
  };
}
