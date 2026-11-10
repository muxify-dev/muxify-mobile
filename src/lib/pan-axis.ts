/**
 * The axis lock for a one-finger drag on a Pane.
 *
 * A drag is one thing for its whole life: a vertical drag moves the
 * Scrollback, and a horizontal drag is a swipe to another Pane. The axis is
 * decided once, when the finger leaves the tap slop, from the travel so far.
 *
 * The Surface's own gesture makes the same decision in the terminal library
 * (`touchPanMayBegin` in patches/expo-libghostty.patch), with the same two
 * numbers. These are for the layers that take the finger before the Surface
 * does.
 */

export type PanAxis = 'vertical' | 'horizontal';

/** Which way the finger moved. */
export type SwipeDirection = 'left' | 'right';

/**
 * A drag is horizontal when it starts this many times further sideways than up
 * or down. A scroll is the common gesture, so a diagonal drag stays a scroll.
 */
export const HORIZONTAL_PAN_RATIO = 1.5;

/** How far a horizontal drag must travel, in points, to be a swipe. */
export const SWIPE_DISTANCE = 40;

/** The axis of a drag, from how far the finger has moved since it landed. */
export function panAxis(dx: number, dy: number): PanAxis {
  return Math.abs(dx) > Math.abs(dy) * HORIZONTAL_PAN_RATIO ? 'horizontal' : 'vertical';
}

/** The swipe a horizontal drag was, from where the finger lifted. */
export function swipeOf(dx: number): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_DISTANCE) return null;
  return dx < 0 ? 'left' : 'right';
}
