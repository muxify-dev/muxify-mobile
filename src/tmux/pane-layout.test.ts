import {
  cellSizeOf,
  gridForContainer,
  paneBoxes,
  windowGridOf,
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
