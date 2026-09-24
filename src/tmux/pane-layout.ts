import type { Pane } from './tmux-client';

/** Where one Pane's Surface goes, in points. */
export interface PaneBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The size of the Window the Panes are laid out in, in cells. */
export interface WindowGrid {
  cols: number;
  rows: number;
}

/**
 * How big the Window is, read from where its Panes end.
 *
 * tmux tiles a Window exactly, so the far edge of the rightmost Pane is the
 * Window's width and the bottom of the lowest one is its height — including
 * the single cell tmux keeps between neighbours for the separator. That makes
 * the Layout string self-describing: nothing has to be asked for, and nothing
 * has to be remembered from a Surface that may not be mounted.
 */
export function windowGridOf(panes: Pane[]): WindowGrid | undefined {
  let cols = 0;
  let rows = 0;
  for (const pane of panes) {
    if (pane.width <= 0 || pane.height <= 0) continue;
    cols = Math.max(cols, pane.left + pane.width);
    rows = Math.max(rows, pane.top + pane.height);
  }
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
}

/**
 * Where each Pane's Surface belongs inside a container, in points.
 *
 * One cell metric for the whole Window, taken from the container and the grid
 * rather than from any Surface — which is what keeps the Panes on the same
 * baseline. Sizing each Surface to its own share independently would let two
 * neighbours round to different cell heights, and a split whose halves are a
 * pixel out of step is the kind of thing that reads as a rendering bug.
 *
 * The cell tmux keeps between neighbours is shared out rather than left empty.
 * It is where tmux would draw a separator line for a client that renders one,
 * and this one does not — so leaving it showed a strip of ground between the
 * Panes, which reads as two windows rather than one split. Each neighbour
 * takes half of it, which closes the seam and leaves both Surfaces a whisker
 * under their own cell count, so each still reports the width tmux is wrapping
 * for. Taking the whole cell would round them a column *wider* than the Pane,
 * and then nothing would wrap where tmux wrapped it.
 */
export function paneBoxes(
  panes: Pane[],
  container: { width: number; height: number },
): Map<string, PaneBox> {
  const boxes = new Map<string, PaneBox>();
  const grid = windowGridOf(panes);
  if (!grid || container.width <= 0 || container.height <= 0) return boxes;

  const cellWidth = container.width / grid.cols;
  const cellHeight = container.height / grid.rows;

  // Edges are rounded, not sizes. A fractional width is rounded down to whole
  // pixels when it is laid out, and a Pane a third of a point short of 24
  // cells is a Pane of 23 — which then wraps every line tmux wrote for 24.
  // Rounding where the Panes meet keeps each one a whole number of points wide
  // and stops the loss compounding across a split.
  for (const pane of panes) {
    if (pane.width <= 0 || pane.height <= 0) continue;
    const left = edge(pane.left, grid.cols, cellWidth, container.width, true);
    const top = edge(pane.top, grid.rows, cellHeight, container.height, true);
    boxes.set(pane.id, {
      left,
      top,
      width: edge(pane.left + pane.width, grid.cols, cellWidth, container.width, false) - left,
      height: edge(pane.top + pane.height, grid.rows, cellHeight, container.height, false) - top,
    });
  }
  return boxes;
}

/**
 * Where one edge of a Pane sits in points.
 *
 * An edge against the Window's own border is that border exactly, so nothing
 * is lost at the outside. An edge against a neighbour moves half a cell into
 * the separator between them, so the two meet in the middle of it and no
 * ground shows through.
 */
function edge(
  cells: number,
  extentCells: number,
  cellSize: number,
  extent: number,
  leading: boolean,
): number {
  if (cells <= 0) return 0;
  if (cells >= extentCells) return extent;
  return Math.round((cells + (leading ? -0.5 : 0.5)) * cellSize);
}

/**
 * The grid a container of this size holds, at the cell metric a Window of this
 * grid implies.
 *
 * What the Client's size is recomputed from when the container changes — the
 * keyboard rising, a rotation. A split mounts no Surface that spans the whole
 * Window, so there is nothing to report the new grid; it is worked out from
 * the cell size instead, which the font fixes and a resize does not change.
 */
export function gridForContainer(
  cell: { width: number; height: number },
  container: { width: number; height: number },
): WindowGrid | undefined {
  if (cell.width <= 0 || cell.height <= 0) return undefined;
  const cols = Math.floor(container.width / cell.width);
  const rows = Math.floor(container.height / cell.height);
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
}

/** The size of one cell, from a container known to hold exactly this grid. */
export function cellSizeOf(
  grid: WindowGrid,
  container: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (grid.cols <= 0 || grid.rows <= 0) return undefined;
  if (container.width <= 0 || container.height <= 0) return undefined;
  return { width: container.width / grid.cols, height: container.height / grid.rows };
}
