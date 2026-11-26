/**
 * The keys typed while a split or a New Window is being made, as a value and
 * one function.
 *
 * Between the tap and the answer of tmux, the Pane the user will type into
 * does not exist yet, and the Pane that is on screen is the one about to lose
 * the keyboard. A key typed then is for the new Pane. So it waits here, and
 * `stepHold` says where it goes when the verb ends: into the new Pane's Lane,
 * or, when the verb never made a Pane, back onto the Pane it was typed in,
 * as Held keys that the user decides about.
 *
 * No clock, no promise and no tmux words in here: the Attach feeds the events
 * in and runs the effects.
 */
import type { Key, Typed } from './input-lane';
import type { VerbFate } from './verb-guard';

/** One tap that has not ended yet, or whose new Pane the Topology has not listed yet. */
export type MakeHold =
  /** Waiting for tmux. Keys typed now are kept. */
  | { readonly kind: 'open'; readonly id: number; readonly from: string; readonly keys: readonly Typed[] }
  /**
   * tmux made `paneId`, and the Topology does not list it yet, so the Attach
   * does not know it as the active Pane. Keys typed now go straight to it.
   */
  | { readonly kind: 'routed'; readonly id: number; readonly paneId: string };

export type HoldEvent =
  /** The user tapped a verb in `from`, the active Pane. Taps come in the order they are made. */
  | { readonly kind: 'tapped'; readonly id: number; readonly from: string }
  /** A key for the newest tap's Pane. */
  | { readonly kind: 'typed'; readonly key: Key; readonly at: number }
  /** The verb of tap `id` ended. `listed`: the Topology already lists the Pane it made. */
  | { readonly kind: 'settled'; readonly id: number; readonly fate: VerbFate; readonly listed: boolean }
  /** The Topology lists these Panes now. A Pane it lists is the active Pane's business again. */
  | { readonly kind: 'listed'; readonly panes: ReadonlySet<string> }
  /** The active Pane is known again: the Topology was read after the verbs, or the user picked a Pane. */
  | { readonly kind: 'known' };

export type HoldEffect =
  /** The new Pane's Lane takes these keys, in order. */
  | { readonly kind: 'send'; readonly paneId: string; readonly keys: readonly Typed[] }
  /** No Pane was made: these keys wait on the Pane they were typed in, for the user to decide. */
  | { readonly kind: 'park'; readonly paneId: string; readonly keys: readonly Typed[] };

export const NO_HOLDS: readonly MakeHold[] = [];

export function stepHold(
  holds: readonly MakeHold[],
  event: HoldEvent,
): { holds: readonly MakeHold[]; effects: HoldEffect[] } {
  switch (event.kind) {
    case 'tapped':
      return { holds: [...holds, { kind: 'open', id: event.id, from: event.from, keys: [] }], effects: [] };

    case 'typed': {
      const newest = holds.at(-1);
      if (!newest) return { holds, effects: [] };
      const typed: Typed = { ...event.key, typedAt: event.at };
      if (newest.kind === 'routed') {
        return { holds, effects: [{ kind: 'send', paneId: newest.paneId, keys: [typed] }] };
      }
      return { holds: [...holds.slice(0, -1), { ...newest, keys: appended(newest.keys, typed) }], effects: [] };
    }

    case 'settled': {
      const at = holds.findIndex((hold) => hold.id === event.id);
      const hold = holds[at];
      if (hold?.kind !== 'open') return { holds, effects: [] };
      const keys = hold.keys.length > 0 ? [hold.keys] : [];
      const { fate } = event;
      if (fate.kind === 'made') {
        const next = event.listed ? [] : [{ kind: 'routed', id: hold.id, paneId: fate.paneId } as const];
        return {
          holds: [...holds.slice(0, at), ...next, ...holds.slice(at + 1)],
          effects: keys.map((each) => ({ kind: 'send', paneId: fate.paneId, keys: each })),
        };
      }
      return {
        holds: [...holds.slice(0, at), ...holds.slice(at + 1)],
        effects: keys.map((each) => ({ kind: 'park', paneId: hold.from, keys: each })),
      };
    }

    case 'listed':
      return { holds: holds.filter((hold) => hold.kind === 'open' || !event.panes.has(hold.paneId)), effects: [] };

    case 'known':
      return { holds: holds.filter((hold) => hold.kind === 'open'), effects: [] };
  }
}

/** Text typed one after another is one Key, as a Lane has it. */
function appended(keys: readonly Typed[], key: Typed): Typed[] {
  const last = keys.at(-1);
  if (last && last.kind === 'text' && key.kind === 'text' && last.gesture === key.gesture) {
    return [...keys.slice(0, -1), { ...last, bytes: [...last.bytes, ...key.bytes] }];
  }
  return [...keys, key];
}
