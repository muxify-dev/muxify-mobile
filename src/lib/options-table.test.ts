import type { OptionsItem } from '@/components/terminal-header';

import { optionGroups, optionRun } from './options-table';

const run = jest.fn();
const set = jest.fn();
const items: OptionsItem[] = [
  { kind: 'action', id: 'compose', label: 'Compose', systemImage: 'square.and.pencil', run },
  { kind: 'action', id: 'new-window', label: 'New Window', systemImage: 'plus.rectangle', run: jest.fn(), disabled: true },
  { kind: 'toggle', id: 'zoom', label: 'Zoom Pane', systemImage: 'arrow.up.left.and.arrow.down.right', isOn: true, set },
  { kind: 'divider', id: 'divider' },
  {
    kind: 'menu', id: 'split', label: 'Split Pane', systemImage: 'rectangle.split.2x1',
    items: [{ kind: 'action', id: 'split-right', label: 'Split →', systemImage: 'rectangle.split.2x1', run }],
  },
];

beforeEach(() => jest.clearAllMocks());

it('runs the entry that the header menu runs', () => {
  optionRun(items, 'compose')?.();
  expect(run).toHaveBeenCalledTimes(1);
});

it('finds an entry inside a menu', () => {
  optionRun(items, 'split-right')?.();
  expect(run).toHaveBeenCalledTimes(1);
});

it('flips a toggle', () => {
  optionRun(items, 'zoom')?.();
  expect(set).toHaveBeenCalledWith(false);
});

it('groups the entries by the dividers, and drops a group with no entry', () => {
  const grouped = optionGroups([...items, { kind: 'divider', id: 'again' }, { kind: 'divider', id: 'last' }]);
  expect(grouped.map((group) => [group.id, group.items.map((item) => item.id)])).toEqual([
    ['first', ['compose', 'new-window', 'zoom']],
    ['divider', ['split']],
  ]);
});

it('gives nothing for an entry that is disabled or not in the table', () => {
  expect(optionRun(items, 'new-window')).toBeUndefined();
  expect(optionRun(items, 'paste')).toBeUndefined();
  expect(optionRun(items, 'divider')).toBeUndefined();
});
