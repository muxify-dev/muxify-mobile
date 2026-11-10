/**
 * The axis lock for a one-finger drag on a Pane.
 *
 * A drag is one thing for its whole life: a vertical drag moves the
 * Scrollback, and a horizontal drag is a swipe to another Pane. The axis is
 * decided once, when the finger leaves the tap slop, from the travel so far.
 *
 * The Surface's own gesture makes the same decisions in the terminal library
 * (`touchPanMayBegin` and `handleHorizontalPan` in
 * patches/expo-libghostty.patch), with the same numbers. These are for the
 * layers that take the finger before the Surface does.
 */

export type PanAxis = 'vertical' | 'horizontal';

/** Which way the finger moved. */
export type SwipeDirection = 'left' | 'right';

/**
 * A drag is horizontal when it starts this many times further sideways than up
 * or down. A scroll is the common gesture, so a diagonal drag stays a scroll.
 */
export const HORIZONTAL_PAN_RATIO = 1.5;

/**
 * The part of the Surface's width a horizontal drag must cross to be a swipe.
 * The terminal library has the same number: `swipeCommitFraction`.
 */
export const SWIPE_COMMIT_FRACTION = 0.25;

/**
 * A finger that lifts faster than this, in points a second, makes a swipe
 * however short the drag was. `swipeFlickVelocity` in the terminal library.
 */
export const SWIPE_FLICK_VELOCITY = 600;

/** How much of the finger's travel past the commit point the Pane follows. */
const RESISTANCE = 0.3;

/** The axis of a drag, from how far the finger has moved since it landed. */
export function panAxis(dx: number, dy: number): PanAxis {
  return Math.abs(dx) > Math.abs(dy) * HORIZONTAL_PAN_RATIO ? 'horizontal' : 'vertical';
}

/** Whether a drag of `dx` on a Surface this wide would be a swipe if it ended here. */
export function isPastCommit(dx: number, width: number): boolean {
  return width > 0 && Math.abs(dx) >= width * SWIPE_COMMIT_FRACTION;
}

/**
 * The swipe a horizontal drag was, from where the finger lifted and how fast
 * it was going. A flick counts only the way the drag went.
 */
export function swipeOf(dx: number, width: number, velocity: number): SwipeDirection | null {
  if (dx === 0) return null;
  const flick = Math.abs(velocity) > SWIPE_FLICK_VELOCITY && velocity < 0 === dx < 0;
  if (!isPastCommit(dx, width) && !flick) return null;
  return dx < 0 ? 'left' : 'right';
}

/**
 * How far the Pane is from its place while the finger is `dx` from where the
 * drag began: with the finger up to the commit point, then slower.
 */
export function followOffset(dx: number, width: number): number {
  const commit = width * SWIPE_COMMIT_FRACTION;
  const past = Math.abs(dx) - commit;
  if (past <= 0) return dx;
  return Math.sign(dx) * (commit + past * RESISTANCE);
}
