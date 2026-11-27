import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { limitRows, ROWS_PER_FRAME, SCREENFUL, useRowBudget, type RowBudget } from './use-row-budget';

let renderer: ReactTestRenderer;
let rows: RowBudget;
// Made inside a function, as the other hook tests make theirs, so it can hand the budget out.
function listOf() {
  return function List({ total, running }: { total: number; running: boolean }) {
    rows = useRowBudget(total, running);
    return null;
  };
}
const List = listOf();
const show = (total: number, running = true) => act(async () => {
  if (renderer) renderer.update(<List total={total} running={running} />);
  else renderer = create(<List total={total} running={running} />);
});
// One act for each frame, so each frame's render runs its effect and asks for the next frame.
async function frames(count: number) {
  for (let i = 0; i < count; i++) await act(async () => { jest.advanceTimersByTime(17); });
}

beforeEach(() => {
  jest.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined as unknown as ReactTestRenderer;
  jest.useRealTimers();
});

it('mounts no row in the first render, then a few rows in each frame up to a screenful', async () => {
  await show(40);
  expect(rows.budget).toBe(0);
  await frames(1);
  expect(rows.budget).toBe(ROWS_PER_FRAME);
  await frames(SCREENFUL);
  expect(rows.budget).toBe(SCREENFUL);
});

it('mounts the next screenful when the row at the end appears, and never more than the list has', async () => {
  await show(20);
  await frames(SCREENFUL);
  act(() => rows.more());
  await frames(SCREENFUL);
  expect(rows.budget).toBe(20);
});

it('waits while it does not run, and starts again from no rows', async () => {
  await show(40, false);
  await frames(5);
  expect(rows.budget).toBe(0);
  await show(40, true);
  await frames(SCREENFUL);
  expect(rows.budget).toBe(SCREENFUL);
  await show(40, false);
  expect(rows.budget).toBe(0);
  await show(40, true);
  expect(rows.budget).toBe(0);
});

it('cuts sections to their first rows in all, in order', () => {
  const sections = [{ id: 'a', rows: [1, 2] }, { id: 'b', rows: [3, 4, 5] }, { id: 'c', rows: [6] }];
  expect(limitRows(sections, 3)).toEqual([{ id: 'a', rows: [1, 2] }, { id: 'b', rows: [3] }]);
  expect(limitRows(sections, 0)).toEqual([]);
  expect(limitRows(sections, 9)).toEqual(sections);
});
