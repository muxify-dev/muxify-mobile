import type { Grid } from './tmux-client';

/** The two sizes that have to agree, and the repaint that follows them. */
export interface GridTargets {
  /** The tmux Window: what tmux draws for. A round trip. */
  setWindowSize(grid: Grid): Promise<void>;
  /** The Client's PTY: what tmux believes it is drawing onto. Fire and forget. */
  setClientSize(grid: Grid): void;
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
 * The Client half is best effort and nothing here depends on it. The SSH
 * library's `resize` does not reliably deliver a window-change at all —
 * measured with a scripted sequence, six calls over eighteen seconds moved the
 * remote not at all, while the same call inside this sequence sometimes does.
 * It is sent because it is free and correct when it lands. What actually keeps
 * the Surface clean is the Window size, which goes over the exec channel, and
 * the redraw that follows it.
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
  if (shrinking) targets.setClientSize(next);
  await targets.setWindowSize(next);
  targets.setClientSize(next);

  await targets.redraw();
}
