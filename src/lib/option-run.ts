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
