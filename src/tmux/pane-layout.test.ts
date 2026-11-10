import {
  cellOf,
  clippedRowHeight,
  cellSizeOf,
  gridForContainer,
  paneBoxes,
  windowGridOf,
  windowSlide,
  type PaneBox,
} from './pane-layout';
import type { Pane } from './tmux-client';

const pane = (over: Partial<Pane>): Pane => ({
  index: 0,
  id: '%0',
  command: 'bash',
  active: false,
  path: '/home/user',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  ...over,
});

/**
 * A real side-by-side split, as tmux reported it: a 49x41 Window holding two
 * 24-wide Panes with one cell between them for the separator.
 */
const SIDE_BY_SIDE = [
  pane({ id: '%0', left: 0, top: 0, width: 24, height: 41 }),
  pane({ id: '%12', left: 25, top: 0, width: 24, height: 41 }),
];

/** The same Window split the other way: 41 rows as 20, a separator, then 20. */
const STACKED = [
  pane({ id: '%0', left: 0, top: 0, width: 49, height: 20 }),
  pane({ id: '%12', left: 0, top: 21, width: 49, height: 20 }),
];

describe('how big the Window is', () => {
  it('reads the Window from where its Panes end', () => {
    expect(windowGridOf(SIDE_BY_SIDE)).toEqual({ cols: 49, rows: 41 });
    expect(windowGridOf(STACKED)).toEqual({ cols: 49, rows: 41 });
  });

  it('reads a Window holding one Pane', () => {
    expect(windowGridOf([pane({ width: 80, height: 24 })])).toEqual({ cols: 80, rows: 24 });
  });

  it('says nothing about Panes the Layout could not place', () => {
    // parseWindowLayout gives a Pane it cannot read zeroes throughout, and a
    // Window measured from those would be no size at all.
    expect(windowGridOf([pane({ width: 0, height: 0 })])).toBeUndefined();
    expect(windowGridOf([])).toBeUndefined();
  });

  it('ignores an unplaceable Pane among placed ones', () => {
    expect(windowGridOf([...SIDE_BY_SIDE, pane({ id: '%9' })])).toEqual({ cols: 49, rows: 41 });
  });
});

describe('where each Pane goes', () => {
  const container = { width: 490, height: 410 };

  it('places two Panes side by side, meeting in the middle of the separator', () => {
    const boxes = paneBoxes(SIDE_BY_SIDE, container);
    // 24 cells of 10, plus half the separator cell they share.
    expect(boxes.get('%0')).toEqual({ left: 0, top: 0, width: 245, height: 410 });
    expect(boxes.get('%12')).toEqual({ left: 245, top: 0, width: 245, height: 410 });
  });

  it('leaves no gap for the ground to show through', () => {
    const boxes = paneBoxes(SIDE_BY_SIDE, container);
    const left = boxes.get('%0') as { left: number; width: number };
    const right = boxes.get('%12') as { left: number };
    expect(right.left).toBe(left.left + left.width);
  });

  it('reaches the Window’s own edges exactly', () => {
    const boxes = paneBoxes(SIDE_BY_SIDE, container);
    const left = boxes.get('%0') as PaneBox;
    const right = boxes.get('%12') as PaneBox;
    expect(left.left).toBe(0);
    expect(right.left + right.width).toBe(container.width);
    expect(left.top).toBe(0);
    expect(left.top + left.height).toBe(container.height);
  });

  it('keeps each Surface inside the column count tmux wraps for', () => {
    // Half a separator wider than the Pane, never a whole one: a Surface a
    // column *wider* than the Pane would stop wrapping where tmux wrapped.
    const boxes = paneBoxes(SIDE_BY_SIDE, container);
    const cell = container.width / 49;
    for (const box of boxes.values()) {
      expect(Math.floor(box.width / cell)).toBe(24);
    }
  });

  it('places two Panes stacked', () => {
    const boxes = paneBoxes(STACKED, container);
    expect(boxes.get('%0')).toEqual({ left: 0, top: 0, width: 490, height: 205 });
    expect(boxes.get('%12')).toEqual({ left: 0, top: 205, width: 490, height: 205 });
  });

  it('gives neighbours the same cell height, whatever the rounding', () => {
    // A container that does not divide evenly is the ordinary case; what must
    // not happen is two halves settling on different metrics.
    const boxes = paneBoxes(STACKED, { width: 403, height: 874 });
    const first = boxes.get('%0') as { height: number };
    const second = boxes.get('%12') as { height: number };
    expect(first.height).toBe(second.height);
  });

  it('fills the container with one Pane', () => {
    const boxes = paneBoxes([pane({ width: 80, height: 24 })], container);
    expect(boxes.get('%0')).toEqual({ left: 0, top: 0, width: 490, height: 410 });
  });

  it('places nothing in a container with no size yet', () => {
    expect(paneBoxes(SIDE_BY_SIDE, { width: 0, height: 0 }).size).toBe(0);
  });

  it('leaves out a Pane the Layout could not place, rather than stacking it at the origin', () => {
    const boxes = paneBoxes([...SIDE_BY_SIDE, pane({ id: '%9' })], container);
    expect(boxes.has('%9')).toBe(false);
    expect(boxes.size).toBe(2);
  });
});

describe('the cell metric', () => {
  it('comes from a container known to hold exactly one grid', () => {
    expect(cellSizeOf({ cols: 49, rows: 41 }, { width: 490, height: 410 })).toEqual({
      width: 10,
      height: 10,
    });
  });

  it('says nothing when there is nothing to measure', () => {
    expect(cellSizeOf({ cols: 0, rows: 0 }, { width: 490, height: 410 })).toBeUndefined();
    expect(cellSizeOf({ cols: 49, rows: 41 }, { width: 0, height: 0 })).toBeUndefined();
  });

  it('works back to the grid a container holds', () => {
    expect(gridForContainer({ width: 10, height: 10 }, { width: 490, height: 410 })).toEqual({
      cols: 49,
      rows: 41,
    });
  });

  it('rounds a grid down, because a part-cell is not a cell', () => {
    expect(gridForContainer({ width: 10, height: 10 }, { width: 495, height: 418 })).toEqual({
      cols: 49,
      rows: 41,
    });
  });

  it('says nothing for a container too small to hold a cell', () => {
    expect(gridForContainer({ width: 10, height: 10 }, { width: 4, height: 4 })).toBeUndefined();
  });
});

describe('cellOf', () => {
  // The numbers are the ones measured on an iPhone 17 Pro with a Pane 717
  // points tall at 40 rows: the font's cell is 17.667 points, and dividing the
  // Pane by its rows says 17.925.
  const PANE = 717;
  const ROWS = 40;
  const CELL = 17.667;

  it('maps a point by the cell, not by dividing the Pane', () => {
    // A quarter of a point a row is nothing at the top…
    expect(cellOf(20, CELL, PANE, ROWS)).toBe(2);
    expect(cellOf(20, undefined, PANE, ROWS)).toBe(2);
    // …and a whole row by the bottom, which is where a terminal application
    // puts its buttons.
    expect(cellOf(698, CELL, PANE, ROWS)).toBe(40);
    expect(cellOf(698, undefined, PANE, ROWS)).toBe(39);
  });

  it('can reach the last row at all, which dividing cannot', () => {
    // The whole of the bug. The grid is 40 cells of 17.667 and stops at 706.7
    // points; the Pane runs to 717. Dividing spreads that strip over every row
    // instead of leaving it at the bottom, so the last row — drawn from 689 to
    // 707 — is only itself for the lower half of its own height.
    const lastRowDrawn = [690, 695, 700, 705];
    expect(lastRowDrawn.map((y) => cellOf(y, CELL, PANE, ROWS))).toEqual([40, 40, 40, 40]);
    expect(lastRowDrawn.map((y) => cellOf(y, undefined, PANE, ROWS))).toEqual([39, 39, 40, 40]);
  });

  it('clamps to the grid, for the strip the cells do not cover', () => {
    // 40 cells of 17.667 reach 706.7 points and the Pane is 717, so the last
    // ten belong to the last row rather than to one that is not there.
    expect(cellOf(716, CELL, PANE, ROWS)).toBe(ROWS);
    expect(cellOf(0, CELL, PANE, ROWS)).toBe(1);
    expect(cellOf(-4, CELL, PANE, ROWS)).toBe(1);
  });

  it('divides the Pane when no Surface has reported a cell yet', () => {
    // A frame or two at most, and better than refusing the tap.
    expect(cellOf(358.5, undefined, PANE, ROWS)).toBe(21);
    expect(cellOf(358.5, 0, PANE, ROWS)).toBe(21);
  });
});

describe('windowSlide', () => {
  // An iPhone 17 Pro: 40 rows of 17.667 points with the keyboard down, and the
  // keyboard leaves 24 of them showing.
  const CELL = { width: 8, height: 17.667 };
  const WINDOW = 717;
  const VISIBLE = 424;
  const HIDDEN = WINDOW - VISIBLE;

  it('slides nothing while nothing is covered', () => {
    expect(windowSlide(WINDOW, WINDOW, CELL, 39)).toBe(0);
    expect(windowSlide(WINDOW + 10, WINDOW, CELL, 0)).toBe(0);
  });

  it('slides a full Pane by the whole of what the keyboard covers', () => {
    // The cursor on the last row: the shape a full terminal has always had
    // with the keyboard up, only without the Host being told to reflow it.
    expect(windowSlide(VISIBLE, WINDOW, CELL, 39)).toBe(HIDDEN);
  });

  it('leaves a short Pane where it is', () => {
    // Three lines after a `clear`. Slid, they would be behind the status bar
    // and sixteen blank rows would be showing in their place.
    expect(windowSlide(VISIBLE, WINDOW, CELL, 2)).toBe(0);
    // Right up to the row that still fits above the keys.
    expect(windowSlide(VISIBLE, WINDOW, CELL, 21)).toBe(0);
  });

  it('slides just enough once the cursor passes the fold', () => {
    // Row 30 of 40 (0-based 29) is 6 rows below the 24 that show. Slid by
    // those 6 rows and the half-row of headroom, and nothing more.
    const slid = windowSlide(VISIBLE, WINDOW, CELL, 29);
    expect(slid).toBeCloseTo((29 + 1.5) * CELL.height - VISIBLE, 5);
    expect(slid).toBeLessThan(HIDDEN);
    // The row is on screen: its bottom edge is above the keys.
    expect((29 + 1) * CELL.height - slid).toBeLessThanOrEqual(VISIBLE);
  });

  it('never slides further than there is hidden height to slide into', () => {
    // A cursor row past the Window's end, which a stale reading can say.
    expect(windowSlide(VISIBLE, WINDOW, CELL, 60)).toBe(HIDDEN);
  });

  it('slides all the way while the shape of the Pane is unknown', () => {
    expect(windowSlide(VISIBLE, WINDOW, null, 5)).toBe(HIDDEN);
    expect(windowSlide(VISIBLE, WINDOW, CELL, null)).toBe(HIDDEN);
    expect(windowSlide(VISIBLE, WINDOW, { width: 8, height: 0 }, 5)).toBe(HIDDEN);
  });
});


describe('the partial row clipped above the Window', () => {
  const cell = { width: 8, height: 17.667 };

  it('covers only the rest of the row that crosses the top edge', () => {
    const slide = windowSlide(424, 717, cell, 39);
    const clipped = clippedRowHeight(slide, cell);
    expect(clipped).toBeGreaterThan(0);
    expect(clipped).toBeLessThan(cell.height);
    expect((slide + clipped) / cell.height).toBeCloseTo(17);
  });

  it('covers nothing at a row boundary or before the cell is known', () => {
    expect(clippedRowHeight(0, cell)).toBe(0);
    expect(clippedRowHeight(cell.height * 4, cell)).toBe(0);
    expect(clippedRowHeight(10, null)).toBe(0);
  });
});
