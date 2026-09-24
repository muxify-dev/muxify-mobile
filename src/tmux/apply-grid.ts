import type { Grid } from './tmux-client';

/** The two sizes that have to agree, and the repaint that follows them. */
export interface GridTargets {
  /** The tmux Window: what tmux draws for. A round trip. */
  setWindowSize(grid: Grid): Promise<void>;
  /** The Client's pty: what tmux believes it is drawing onto. A round trip. */
  setClientSize(grid: Grid): Promise<void>;
  redraw(): Promise<void>;
}

/**
 * Resizes the remote without ever showing tmux's padding.
 *
 * tmux pads the difference whenever it thinks the **Client is bigger than the
 * Window**, and those padded rows land past the end of the Surface's grid, so
 * the Surface scrolls to fit them and fills with dots. Both sizes have to
 * change and they cannot change at the same instant, so the order matters:
 * whichever is getting smaller goes first.
 *
 * - Shrinking: the Client first. A Client smaller than the Window only means
 *   tmux draws less than it has; the other order pads.
 * - Growing: the Window first, then the Client.
 *
 * Both halves go over the exec channel — the Window through tmux, the Client
 * through `stty` on the Host — so both land, and the order above is the whole
 * of the guarantee. In the gap between them the Client is the smaller of the
 * two in either direction, which is the state tmux does not pad.
 */
export async function applyGrid(
  targets: GridTargets,
  next: Grid,
  previous: Grid | null,
): Promise<void> {
  const shrinking = previous !== null && next.rows < previous.rows;

  // Shrinking, the Client goes first so the Window is never the larger of the
  // two. It is then set again afterwards: the SSH library only seems to flush
  // a pending window-change once the channel sees other traffic, and the
  // Window resize is what provides it. Repeating the same size costs nothing.
  if (shrinking) {
    await targets.setClientSize(next);
    await targets.setWindowSize(next);
  } else {
    await targets.setWindowSize(next);
    await targets.setClientSize(next);
  }

  await targets.redraw();
}
