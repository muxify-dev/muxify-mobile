export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the Terminal Screen keeps clear under its content, in points.
 *
 * `resting` is the home indicator's inset, with no keyboard to dock on.
 * `bottom` is what is under the content now: the docked keyboard where it
 * covers more than that. The Key Row sits on whichever it is, flush.
 *
 * Only a keyboard docked across the screen's bottom counts. A floating or
 * split iPad keyboard sits over the content and leaves the row at the bottom.
 */
export function terminalClearance(
  bounds: ScreenRect,
  keyboard: ScreenRect | null,
  safeBottom: number,
): { resting: number; bottom: number } {
  const resting = Math.max(0, safeBottom);
  const bottom = bounds.y + bounds.height;
  const docked = keyboard !== null
    && keyboard.x <= bounds.x + 1
    && keyboard.x + keyboard.width >= bounds.x + bounds.width - 1
    && keyboard.y + keyboard.height >= bottom - 1;
  const overlap = docked ? Math.max(0, Math.min(bounds.height, bottom - keyboard.y)) : 0;
  return { resting, bottom: Math.max(resting, overlap) };
}
