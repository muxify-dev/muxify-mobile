import type { Pane } from './tmux-client';

/** Where something sits inside its Window, as fractions of the Window. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** tmux's address for a Window — which resolves to its active Pane. */
export function windowPreviewTarget(sessionName: string, windowIndex: number): string {
  return `${sessionName}:${windowIndex}`;
}

/** tmux's address for one Pane. */
export function panePreviewTarget(
  sessionName: string,
  windowIndex: number,
  paneIndex: number,
): string {
  return `${sessionName}:${windowIndex}.${paneIndex}`;
}

/**
 * Cuts captured content down to what a preview box can actually show.
 *
 * Trailing blank lines go first: a shell Pane is mostly empty below the
 * prompt, and a preview of nothing tells the user nothing. Interior blanks
 * stay, because they are part of what the Pane looks like.
 */
export function trimPreview(lines: string[], maxLines: number, maxColumns: number): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;

  return lines.slice(0, Math.max(0, Math.min(end, maxLines))).map((line) =>
    line.length > maxColumns ? line.slice(0, maxColumns) : line,
  );
}

/**
 * Turns Pane geometry into fractions of the Window, so a preview can be laid
 * out the way the Window actually is rather than as a plain list.
 *
 * The Window's size is taken from the Panes themselves — the furthest right and
 * lowest edges — because that is always consistent with the coordinates being
 * divided, even mid-resize when a separately-read Window size would not be.
 *
 * tmux's coordinates exclude the one-cell divider between Panes, so adjacent
 * Panes come out with a small gap. That reads as the divider it is.
 *
 * A Pane with no size is left out rather than given a frame of nothing: it is a
 * Pane the Window's layout did not mention, and an invisible tile would be a
 * Pane that cannot be picked. Whoever draws it can fall back to the whole
 * board, which is wrong but reachable.
 */
export function paneFrames(panes: Pane[]): Map<number, Frame> {
  const frames = new Map<number, Frame>();
  const placed = panes.filter((pane) => pane.width > 0 && pane.height > 0);

  const cols = Math.max(...placed.map((pane) => pane.left + pane.width), 1);
  const rows = Math.max(...placed.map((pane) => pane.top + pane.height), 1);

  for (const pane of placed) {
    frames.set(pane.index, {
      x: pane.left / cols,
      y: pane.top / rows,
      width: pane.width / cols,
      height: pane.height / rows,
    });
  }
  return frames;
}
