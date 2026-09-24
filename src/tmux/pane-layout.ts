import type { Pane } from './tmux-client';

/**
 * A size in points: what a container or a Surface was laid out at.
 *
 * Here rather than written out at each of the half-dozen places that take one,
 * because a width and a height travelling together this often is a type asking
 * to exist.
 */
export interface Extent {
  width: number;
  height: number;
}

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
  container: Extent,
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
  cell: Extent,
  container: Extent,
): WindowGrid | undefined {
  if (cell.width <= 0 || cell.height <= 0) return undefined;
  const cols = Math.floor(container.width / cell.width);
  const rows = Math.floor(container.height / cell.height);
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
}

/** The size of one cell, from a container known to hold exactly this grid. */
export function cellSizeOf(
  grid: WindowGrid,
  container: Extent,
): Extent | undefined {
  if (grid.cols <= 0 || grid.rows <= 0) return undefined;
  if (container.width <= 0 || container.height <= 0) return undefined;
  return { width: container.width / grid.cols, height: container.height / grid.rows };
}
/**
 * Which cell a point lands in, 1-based as SGR counts them.
 *
 * By the cell the Surface reported, never by dividing the Pane by its grid.
 * That division is the obvious thing and it is wrong, because the grid does
 * not fill the Pane: it is a whole number of cells and the Pane is whatever
 * the layout gave it, so there is a strip left over. Dividing spreads that
 * strip evenly over every row instead of leaving it where it is, and the error
 * grows with the row number.
 *
 * Measured on an iPhone 17 Pro, a Pane 717 points tall at 40 rows: the cell is
 * 17.67 points and the division says 17.93. A quarter of a point a row, which
 * is nothing at the top and a whole row by the bottom — so a tap on the last
 * row landed on the one above it, and a terminal application's buttons, which
 * are at the bottom, could not be pressed.
 *
 * The grid is taken to start at the Pane's top left. It very nearly does:
 * ghostty keeps a couple of points of its own padding there and puts the rest
 * of the strip at the far edge — measured, eight pixels at the top against
 * twenty-three at the bottom — and nothing across the bridge reports which is
 * which. Ignoring it leaves the same eighth of a cell wrong everywhere rather
 * than a whole row wrong at the bottom, which is the difference between a
 * button that can be pressed and one that cannot. Setting ghostty's padding to
 * zero to make it exact was tried and reverted: the surface it rebuilds comes
 * back measured at whatever size the view happened to be, and the Pane stuck
 * at 33x11.
 *
 * Falls back to the division before any Surface has reported a cell, which is
 * a frame or two at most and better than refusing the tap.
 *
 * Clamped to the grid: a tap in the leftover strip at the far edge belongs to
 * the last cell rather than to one that is not there.
 */
export function cellOf(
  point: number,
  cell: number | undefined,
  extent: number,
  cells: number,
): number {
  const size = cell && cell > 0 ? cell : extent / cells;
  return Math.min(cells, Math.max(1, Math.floor(point / size) + 1));
}

/**
 * How far the Window is slid up under the keyboard, in points.
 *
 * The keyboard does not resize the Window — see ADR 0008. The Window keeps the
 * height it has with the keyboard down, the container clips it, and this is
 * how much of its top is pushed out of view so that the row being typed on
 * stays above the keys. Just enough and no more: a Pane with three lines on it
 * is not slid at all, because sliding it would put those lines behind the
 * status bar and show sixteen blank rows in their place. A Pane with the
 * cursor on its last row is slid by the whole of what the keyboard covers,
 * which is the shape a full terminal has always had with the keyboard up.
 *
 * Half a row of headroom under the cursor, because ghostty keeps a couple of
 * points of its own padding above the grid and reports them nowhere — anchored
 * on the row's exact bottom edge, the descenders of the line being typed were
 * the part behind the keys.
 *
 * Before a Surface has said how big a cell is, or before the Pane's cursor has
 * been read, the whole of the hidden height: a Pane whose shape is not known
 * yet is most likely a full one, and a full one is slid all the way.
 */
export function windowSlide(
  visibleHeight: number,
  windowHeight: number,
  cell: Extent | null,
  cursorRow: number | null,
): number {
  const hidden = Math.max(0, windowHeight - visibleHeight);
  if (hidden === 0) return 0;
  if (!cell || cell.height <= 0 || cursorRow === null || cursorRow < 0) return hidden;
  const cursorBottom = (cursorRow + 1.5) * cell.height;
  const slid = Math.min(hidden, Math.max(0, cursorBottom - visibleHeight));
  // Within a row of the end, all the way. The container is not a whole number
  // of rows, so a cursor on the last row would otherwise stop a strip short of
  // the bottom and leave that strip of the Window's ground under the keys.
  return hidden - slid < cell.height ? hidden : slid;
}
