import { quickActionLabel } from '@/lib/quick-actions';
import { runQuickAction } from './run-quick-action';

test('Interrupt twice sends two Control presses to the chosen target', () => {
  const target = { control: jest.fn(), shortcut: jest.fn(), paste: jest.fn(), goTo: jest.fn() };
  runQuickAction('interrupt-twice', target);
  expect(target.control.mock.calls.map(([key]) => key)).toEqual(['c', 'c']);
  expect(target.shortcut).not.toHaveBeenCalled();
});

test('Split down uses its action even when its chord has changed', () => {
  const shortcuts = { 'split-down': { key: 's', shift: true, option: false, control: false } };
  const target = { control: jest.fn(), shortcut: jest.fn(), paste: jest.fn(), goTo: jest.fn() };
  expect(quickActionLabel('split-down', shortcuts).chord).toBe('⇧⌘S');
  runQuickAction('split-down', target);
  expect(target.shortcut.mock.calls).toEqual([['split-down']]);
  expect(target.control).not.toHaveBeenCalled();
});

test('Paste uses the system paste action even when a shortcut has Command-V', () => {
  const target = { control: jest.fn(), shortcut: jest.fn(), paste: jest.fn(), goTo: jest.fn() };
  runQuickAction('paste', target);
  expect(target.paste).toHaveBeenCalledTimes(1);
  expect(target.shortcut).not.toHaveBeenCalled();
});

test('Go to opens Go to and shows the chord the user gave it', () => {
  const shortcuts = { 'go-to': { key: 'o', shift: false, option: false, control: false } };
  const target = { control: jest.fn(), shortcut: jest.fn(), paste: jest.fn(), goTo: jest.fn() };
  expect(quickActionLabel('go-to', shortcuts)).toEqual({ title: 'Go to', chord: '⌘O' });
  runQuickAction('go-to', target);
  expect(target.goTo).toHaveBeenCalledTimes(1);
  expect(target.shortcut).not.toHaveBeenCalled();
});
