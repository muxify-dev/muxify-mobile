export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which Key Row the Terminal Screen shows: none, under a physical keyboard;
 * one that always floats, on iPhone; or one that docks on the top edge of a
 * docked keyboard, on iPad.
 */
export type KeyRowMode = 'hidden' | 'floating' | 'dockable';

/** How the Key Row sits now: glass floating over the keyboard, or a strip on its top edge. */
export type KeyRowPlacement = 'floating' | 'docked';

/** The least space under the Key Row with no keyboard up, for the glass to clear the screen's edge. */
const RESTING_MARGIN = 8;

/** The space between the floating Key Row's glass and the top of a docked keyboard. */
export const KEYBOARD_GAP = 2;

export function terminalClearance(
  bounds: ScreenRect,
  keyboard: ScreenRect | null,
  safeBottom: number,
  row: KeyRowMode,
): { resting: number; bottom: number; placement: KeyRowPlacement } {
  const rowVisible = row !== 'hidden';
  const resting = Math.max(rowVisible ? RESTING_MARGIN : 0, safeBottom);
  const bottom = bounds.y + bounds.height;
  const docked = keyboard !== null
    && keyboard.x <= bounds.x + 1
    && keyboard.x + keyboard.width >= bounds.x + bounds.width - 1
    && keyboard.y + keyboard.height >= bottom - 1;
  const overlap = docked ? Math.max(0, Math.min(bounds.height, bottom - keyboard.y)) : 0;
  if (overlap === 0) return { resting, bottom: resting, placement: 'floating' };
  // A docked strip with no keyboard under it would hang in the air, so the
  // row docks only on a docked keyboard that is up.
  if (row === 'dockable') return { resting, bottom: Math.max(resting, overlap), placement: 'docked' };
  return {
    resting,
    bottom: Math.max(resting, overlap + (rowVisible ? KEYBOARD_GAP : 0)),
    placement: 'floating',
  };
}
