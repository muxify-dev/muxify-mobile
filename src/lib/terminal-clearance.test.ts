import { terminalClearance, type ScreenRect } from './terminal-clearance';

const bounds: ScreenRect = { x: 0, y: 100, width: 400, height: 700 };
const keyboard: ScreenRect = { x: 0, y: 500, width: 400, height: 300 };

it('keeps the home indicator clear with no keyboard', () => {
  expect(terminalClearance(bounds, null, 34)).toEqual({ resting: 34, bottom: 34 });
  expect(terminalClearance(bounds, null, 0)).toEqual({ resting: 0, bottom: 0 });
});

it('keeps a docked keyboard clear, with no gap above it', () => {
  expect(terminalClearance(bounds, keyboard, 34)).toEqual({ resting: 34, bottom: 300 });
});

it('uses the current app bounds after rotation or multitasking', () => {
  expect(terminalClearance({ ...bounds, height: 500 }, keyboard, 20).bottom).toBe(100);
  expect(terminalClearance({ ...bounds, x: 100, width: 200 }, keyboard, 20).bottom).toBe(300);
});

it('leaves a floating, split or offscreen keyboard over the content', () => {
  expect(terminalClearance(bounds, { ...keyboard, x: 100, width: 200 }, 20).bottom).toBe(20);
  expect(terminalClearance(bounds, { ...keyboard, y: 800 }, 20).bottom).toBe(20);
});
