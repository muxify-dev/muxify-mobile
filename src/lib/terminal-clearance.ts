export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function terminalClearance(
  bounds: ScreenRect,
  keyboard: ScreenRect | null,
  safeBottom: number,
  rowVisible: boolean,
) {
  const resting = Math.max(rowVisible ? 8 : 0, safeBottom);
  const bottom = bounds.y + bounds.height;
  const docked = keyboard !== null
    && keyboard.x <= bounds.x + 1
    && keyboard.x + keyboard.width >= bounds.x + bounds.width - 1
    && keyboard.y + keyboard.height >= bottom - 1;
  const overlap = docked ? Math.max(0, Math.min(bounds.height, bottom - keyboard.y)) : 0;
  return {
    resting,
    bottom: overlap > 0 ? Math.max(resting, overlap + (rowVisible ? 8 : 0)) : resting,
  };
}
