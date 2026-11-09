import { gridContentHeight, sheetHeight, sheetMetrics } from './sheet-layout';

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

/** iPhone 17, and an iPad Pro 11-inch card as the sheet measures it. */
const IPHONE = { width: 402, height: 874 };
const IPAD_CARD = { width: 834, portraitHeight: 1210, landscapeHeight: 834 };

describe('sheetMetrics', () => {
  it('gives a sheet as wide as an iPhone screen the sizes it had before', () => {
    const metrics = sheetMetrics(IPHONE.width, IPHONE.height);
    expect(metrics.contentWidth).toBe(370);
    expect(metrics.listCard).toEqual({ width: 370, height: 150 });
    expect(metrics.board).toEqual({ width: 370, height: 278 });
  });

  it('fits everything inside the width of the sheet it is given', () => {
    const metrics = sheetMetrics(IPAD_CARD.width, IPAD_CARD.portraitHeight);
    expect(metrics.contentWidth).toBe(IPAD_CARD.width - 32);
    expect(metrics.board.width).toBeLessThanOrEqual(metrics.contentWidth);
    expect(metrics.listCard.width).toBe(metrics.contentWidth);
  });

  it('keeps a whole Pane diagram on a short landscape screen, at 4:3', () => {
    const metrics = sheetMetrics(IPAD_CARD.width, IPAD_CARD.landscapeHeight);
    const panes = sheetHeight(metrics, 'panes', 3);
    expect(panes).toBeLessThanOrEqual(IPAD_CARD.landscapeHeight * 0.9);
    expect(metrics.board.height).toBeLessThan(Math.ceil(metrics.contentWidth * 0.75));
    expect(metrics.board.width / metrics.board.height).toBeCloseTo(4 / 3, 1);
  });

  it('gives a list the same height budget as the diagram', () => {
    const metrics = sheetMetrics(IPAD_CARD.width, IPAD_CARD.landscapeHeight);
    expect(sheetHeight(metrics, 'list', 40)).toBeLessThanOrEqual(IPAD_CARD.landscapeHeight * 0.9);
  });

  it('never goes negative on a very narrow sheet', () => {
    const metrics = sheetMetrics(20, 300);
    expect(metrics.contentWidth).toBe(0);
    expect(metrics.listCard.width).toBe(0);
    expect(metrics.board).toEqual({ width: 0, height: 0 });
  });
});
