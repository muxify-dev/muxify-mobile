import { gridContentHeight } from './sheet-layout';

/** Cards 100 tall with 10 between them, two to a row. */
const GRID = { perRow: 2, cardHeight: 100, gap: 10 };

describe('gridContentHeight', () => {
  it('shows the whole grid when it fits, rather than a share of the screen', () => {
    expect(gridContentHeight({ ...GRID, count: 4 }, 1000)).toBe(210);
  });

  it('is one row tall for one card, not half a screen', () => {
    expect(gridContentHeight({ ...GRID, count: 1 }, 1000)).toBe(100);
  });

  it('counts rows, not cards', () => {
    expect(gridContentHeight({ ...GRID, count: 3 }, 1000)).toBe(210);
  });

  it('cuts through a card when the grid overflows, so the cut reads as scrollable', () => {
    // Three rows (320) into a 300 budget: two whole rows plus half of the next.
    expect(gridContentHeight({ ...GRID, count: 6 }, 300)).toBe(210 + 10 + 50);
  });

  it('gives up the peek rather than the budget when both will not fit', () => {
    expect(gridContentHeight({ ...GRID, count: 6 }, 250)).toBe(250);
  });

  it('never claims more than the budget', () => {
    expect(gridContentHeight({ ...GRID, count: 20 }, 250)).toBeLessThanOrEqual(250);
  });

  it('never claims more than the grid, so a peek cannot invent a row', () => {
    expect(gridContentHeight({ ...GRID, count: 4 }, 215)).toBe(210);
  });

  it('fills the budget when not even one row fits', () => {
    expect(gridContentHeight({ ...GRID, count: 4 }, 60)).toBe(60);
  });

  it('has no height for nothing to show', () => {
    expect(gridContentHeight({ ...GRID, count: 0 }, 1000)).toBe(0);
  });
});
