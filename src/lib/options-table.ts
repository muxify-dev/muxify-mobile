import type { OptionsItem } from '@/components/terminal-header';

/**
 * What the Options table does for the entry `id`, for a Grip action to run:
 * the same verbs as the header's ⋯ menu, from the same table, so the two
 * cannot drift. An entry inside a menu counts, and a toggle flips. It is
 * undefined for an entry that is missing or disabled.
 */
export function optionRun(items: readonly OptionsItem[], id: string): (() => void) | undefined {
  for (const item of items) {
    if (item.kind === 'menu') {
      const inner = optionRun(item.items, id);
      if (inner) return inner;
    } else if (item.id === id) {
      if (item.kind === 'toggle') return () => item.set(!item.isOn);
      if (item.kind === 'action') return item.disabled ? undefined : item.run;
    }
  }
  return undefined;
}

export type OptionsEntry = Exclude<OptionsItem, { kind: 'divider' }>;

/**
 * The table's entries in the groups its dividers make, with no empty group.
 * The header's menu and the Options sheet both draw one group after another,
 * so a divider means the same in each.
 */
export function optionGroups(items: readonly OptionsItem[]): { id: string; items: OptionsEntry[] }[] {
  const groups: { id: string; items: OptionsEntry[] }[] = [{ id: 'first', items: [] }];
  for (const item of items) {
    if (item.kind === 'divider') groups.push({ id: item.id, items: [] });
    else groups[groups.length - 1].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}
