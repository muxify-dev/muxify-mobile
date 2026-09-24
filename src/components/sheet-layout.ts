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
