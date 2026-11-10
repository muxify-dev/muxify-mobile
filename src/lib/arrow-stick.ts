/**
 * The Key Row's arrow key: one key that sends the arrow it is dragged towards.
 *
 * A touch on its own sends nothing. Once the finger is DEAD_ZONE away from
 * where it landed, the axis it has moved further along picks the arrow, and
 * it is read again on every move, so that the finger can change the arrow
 * without lifting.
 */

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/** How far, in points, a touch must move before it means an arrow. */
export const DEAD_ZONE = 12;

/** How long a held arrow waits before it repeats, in milliseconds. */
export const REPEAT_DELAY = 400;

/** The gap between repeats of a held arrow: about 12 a second. */
export const REPEAT_INTERVAL = 1000 / 12;

/** The arrow for a touch that has moved this far since it landed, or none inside the dead zone. */
export function stickDirection(dx: number, dy: number): ArrowDirection | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
