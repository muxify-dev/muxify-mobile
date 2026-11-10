import { terminalClearance, type ScreenRect } from './terminal-clearance';

const bounds: ScreenRect = { x: 0, y: 100, width: 400, height: 700 };
const keyboard: ScreenRect = { x: 0, y: 500, width: 400, height: 300 };

it('reserves the home indicator with no software keyboard', () => {
  expect(terminalClearance(bounds, null, 34, true)).toEqual({ resting: 34, bottom: 34 });
  expect(terminalClearance(bounds, null, 0, false)).toEqual({ resting: 0, bottom: 0 });
});

it('keeps software keyboard clearance when the physical keyboard hides the row', () => {
  expect(terminalClearance(bounds, keyboard, 34, true).bottom).toBe(308);
  expect(terminalClearance(bounds, keyboard, 34, false).bottom).toBe(300);
});

it('uses the current app bounds after rotation or multitasking', () => {
  expect(terminalClearance({ ...bounds, height: 500 }, keyboard, 20, false).bottom).toBe(100);
  expect(terminalClearance({ ...bounds, x: 100, width: 200 }, keyboard, 20, true).bottom).toBe(308);
});

it('does not shrink the whole Terminal for a floating or offscreen keyboard', () => {
  expect(terminalClearance(bounds, { ...keyboard, width: 200 }, 34, true).bottom).toBe(34);
  expect(terminalClearance(bounds, { ...keyboard, y: 800 }, 34, true).bottom).toBe(34);
});
