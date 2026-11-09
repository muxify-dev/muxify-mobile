/**
 * How tall a picker sheet should be.
 *
 * A sheet given a fraction of the screen is the wrong height twice: too tall
 * for three Windows, and too short for nine, with the actions marooned at the
 * bottom either way. So the height is measured from what is actually in it.
 *
 * The rule for a grid, taken from remux: show the whole thing whenever it fits,
 * and when it does not, show complete rows plus half of the next one — so the
 * cut is unmistakably an invitation to scroll rather than a row that happens to
 * be missing its bottom edge.
 */
export interface GridShape {
  /** How many cards there are to place. */
  count: number;
  perRow: number;
  cardHeight: number;
  gap: number;
}

export function gridContentHeight(grid: GridShape, budget: number): number {
  if (grid.count <= 0) return 0;

  const rows = Math.ceil(grid.count / grid.perRow);
  const heightOf = (count: number) =>
    count * grid.cardHeight + Math.max(0, count - 1) * grid.gap;

  const whole = heightOf(rows);
  if (whole <= budget) return whole;
  if (budget <= 0) return 0;

  let shown = 0;
  while (heightOf(shown + 1) <= budget) shown += 1;
  // Not even one row fits: fill what there is rather than show nothing.
  if (shown === 0) return budget;

  const peek = heightOf(shown) + grid.gap + grid.cardHeight / 2;
  return Math.min(peek, whole, budget);
}

export const SHEET_PADDING = 16;
/** The gaps between the sheet's parts, top to bottom. */
export const HEADER_HEIGHT = 38;
export const HEADER_TO_CONTENT = 12;
export const CONTENT_TO_ACTIONS = 16;
export const ACTION_BAR_HEIGHT = 44;
export const GRID_GAP = 10;
const LIST_CARD_HEIGHT = 150;
/** Room below the action bar for the home indicator. */
const SAFE_BOTTOM = 24;

/** Everything in the sheet that is not the content: the height its cards have to fit around. */
const CHROME_HEIGHT =
  SHEET_PADDING * 2 +
  HEADER_HEIGHT +
  HEADER_TO_CONTENT +
  CONTENT_TO_ACTIONS +
  ACTION_BAR_HEIGHT +
  SAFE_BOTTOM;

export interface Size {
  width: number;
  height: number;
}

export interface SheetMetrics {
  contentWidth: number;
  gridCard: Size;
  listCard: Size;
  /** The Pane diagram: 4:3, and never taller than the sheet can hold. */
  board: Size;
  /** What is left for cards when the sheet is as tall as it is allowed to get. */
  contentBudget: number;
}

/**
 * Every size in a picker sheet, from the sheet's own width and the window's height.
 *
 * The width is the sheet's, not the screen's. The sheet is narrower than the
 * screen: on iPad it is a centred card, and on iPhone it stands in from the
 * edges. Sizes taken from the screen push the Pane diagram and the action bar
 * past its edges. The height is the window's, because the sheet's own height
 * is the detent this produces.
 */
export function sheetMetrics(sheetWidth: number, windowHeight: number): SheetMetrics {
  const contentWidth = Math.max(0, sheetWidth - SHEET_PADDING * 2);
  const contentBudget = Math.max(0, windowHeight * 0.9 - CHROME_HEIGHT);

  const gridWidth = Math.max(0, Math.floor((contentWidth - GRID_GAP) / 2));
  // Window tiles are slightly taller than they are wide, so the chip fits.
  const gridCard = { width: gridWidth, height: Math.ceil(gridWidth * 1.1) };

  const fullBoardHeight = Math.ceil(contentWidth * 0.75);
  const board =
    fullBoardHeight <= contentBudget
      ? { width: contentWidth, height: fullBoardHeight }
      : { width: Math.floor((Math.floor(contentBudget) * 4) / 3), height: Math.floor(contentBudget) };

  return {
    contentWidth,
    gridCard,
    listCard: { width: contentWidth, height: LIST_CARD_HEIGHT },
    board,
    contentBudget,
  };
}

/**
 * How tall this sheet should be.
 *
 * Measured, never a fraction of the screen: a fraction is the wrong height
 * twice, too tall for three Windows and too short for nine, and either way the
 * actions end up marooned below a gap. The Pane diagram is a fixed shape; a
 * grid takes what its rows need, up to the budget. See gridContentHeight.
 */
export function sheetHeight(
  metrics: SheetMetrics,
  layout: 'grid' | 'panes' | 'list',
  count: number,
): number {
  if (layout === 'panes') return CHROME_HEIGHT + metrics.board.height;
  const card = layout === 'grid' ? metrics.gridCard : metrics.listCard;
  const content = gridContentHeight(
    { count, perRow: layout === 'grid' ? 2 : 1, cardHeight: card.height, gap: GRID_GAP },
    metrics.contentBudget,
  );
  return CHROME_HEIGHT + content;
}
