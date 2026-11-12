import { terminalClearance, type ScreenRect } from './terminal-clearance';

const bounds: ScreenRect = { x: 0, y: 100, width: 400, height: 700 };
const keyboard: ScreenRect = { x: 0, y: 500, width: 400, height: 300 };

it('reserves the home indicator with no software keyboard', () => {
  expect(terminalClearance(bounds, null, 34, 'floating')).toEqual({ resting: 34, bottom: 34, placement: 'floating' });
  expect(terminalClearance(bounds, null, 0, 'hidden')).toEqual({ resting: 0, bottom: 0, placement: 'floating' });
});

it('keeps software keyboard clearance when the physical keyboard hides the row', () => {
  expect(terminalClearance(bounds, keyboard, 34, 'floating').bottom).toBe(302);
  expect(terminalClearance(bounds, keyboard, 34, 'hidden').bottom).toBe(300);
});

it('uses the current app bounds after rotation or multitasking', () => {
  expect(terminalClearance({ ...bounds, height: 500 }, keyboard, 20, 'hidden').bottom).toBe(100);
  expect(terminalClearance({ ...bounds, x: 100, width: 200 }, keyboard, 20, 'floating').bottom).toBe(302);
});

it('does not shrink the whole Terminal for a floating or offscreen keyboard', () => {
  expect(terminalClearance(bounds, { ...keyboard, width: 200 }, 34, 'floating').bottom).toBe(34);
  expect(terminalClearance(bounds, { ...keyboard, y: 800 }, 34, 'floating').bottom).toBe(34);
});

it('docks the iPad row on a docked keyboard, with no gap', () => {
  expect(terminalClearance(bounds, keyboard, 20, 'dockable')).toEqual({ resting: 20, bottom: 300, placement: 'docked' });
});

it('floats the iPad row when the keyboard is down, floating, split or offscreen', () => {
  expect(terminalClearance(bounds, null, 20, 'dockable')).toEqual({ resting: 20, bottom: 20, placement: 'floating' });
  // A floating iPad keyboard is not full width.
  expect(terminalClearance(bounds, { ...keyboard, x: 100, width: 200 }, 20, 'dockable').placement).toBe('floating');
  expect(terminalClearance(bounds, { ...keyboard, y: 800 }, 20, 'dockable').placement).toBe('floating');
});

it('never docks the iPhone row', () => {
  expect(terminalClearance(bounds, keyboard, 34, 'floating').placement).toBe('floating');
});
