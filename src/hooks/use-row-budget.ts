import { useCallback, useEffect, useState } from 'react';

/**
 * The rows one render may mount. A row costs the main thread about 9 ms in
 * Expo UI, so two rows a frame leave it free for the keys and the animation.
 */
export const ROWS_PER_FRAME = 2;

/** More rows than a phone or an iPad shows at once. */
export const SCREENFUL = 16;

export interface RowBudget {
  /** How many rows the list mounts now. */
  budget: number;
  /** Raises the budget by one screenful, as the row at the end of the list appears. */
  more(): void;
}

/**
 * How many of a list's `total` rows to mount, so that no render mounts more
 * than a few (ADR 0041). The budget grows by `ROWS_PER_FRAME` in each
 * animation frame up to one screenful, and by a screenful each time `more`
 * is called. While `running` is false, the budget is 0 and starts again from
 * 0: a pushed screen waits until its push ends, and Go to while it is closed.
 */
export function useRowBudget(total: number, running = true): RowBudget {
  const [target, setTarget] = useState(SCREENFUL);
  const [budget, setBudget] = useState(0);
  const goal = Math.min(target, total);
  // A stop starts the budget again from 0, in the render that stops it.
  const [ranBefore, setRanBefore] = useState(running);
  if (ranBefore !== running) {
    setRanBefore(running);
    if (!running) {
      setBudget(0);
      setTarget(SCREENFUL);
    }
  }
  useEffect(() => {
    if (!running || budget >= goal) return;
    const frame = requestAnimationFrame(() => setBudget((now) => Math.min(now + ROWS_PER_FRAME, goal)));
    return () => cancelAnimationFrame(frame);
  }, [running, budget, goal]);
  const more = useCallback(() => setTarget((now) => now + SCREENFUL), []);
  return { budget: running ? Math.min(budget, total) : 0, more };
}

/** The sections cut to their first `limit` rows in all, in order. A section past the limit goes. */
export function limitRows<S extends { rows: readonly unknown[] }>(sections: readonly S[], limit: number): S[] {
  const kept: S[] = [];
  let left = limit;
  for (const section of sections) {
    if (left <= 0) break;
    kept.push(section.rows.length <= left ? section : { ...section, rows: section.rows.slice(0, left) });
    left -= section.rows.length;
  }
  return kept;
}
