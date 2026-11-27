import type { SFSymbol } from 'expo-symbols';

/** How a Grip action is named and drawn in the Fan and in Settings. */
interface GripActionLook {
  title: string;
  symbol: SFSymbol;
}

/** The Fan's straight-up slot, which is not a choice: it always opens the Edge Drawer. */
export const DESTINATIONS_ACTION = { title: 'Destinations', symbol: 'sidebar.right' } as const satisfies GripActionLook;

/**
 * The Grip actions Settings offers for the three slots beside Destinations,
 * in the order Settings lists them. Each is something the app does already.
 */
export const GRIP_ACTIONS = {
  'go-to': { title: 'Go to', symbol: 'magnifyingglass' },
  compose: { title: 'Compose', symbol: 'square.and.pencil' },
  options: { title: 'Options', symbol: 'ellipsis' },
  keyboard: { title: 'Keyboard', symbol: 'keyboard' },
  'title-sheet': { title: 'Title Sheet', symbol: 'list.bullet.rectangle' },
  'host-screen': { title: 'Host Screen', symbol: 'house' },
  'split-right': { title: 'Split right', symbol: 'rectangle.split.2x1' },
  'split-down': { title: 'Split down', symbol: 'rectangle.split.1x2' },
  'new-window': { title: 'New Window', symbol: 'plus.rectangle' },
  'zoom-pane': { title: 'Zoom Pane', symbol: 'arrow.up.left.and.arrow.down.right' },
  paste: { title: 'Paste', symbol: 'doc.on.clipboard' },
  'copy-pane': { title: 'Copy Pane text', symbol: 'doc.on.doc' },
} as const satisfies Record<string, GripActionLook>;

export type GripActionId = keyof typeof GRIP_ACTIONS;
export const GRIP_ACTION_IDS = Object.keys(GRIP_ACTIONS) as GripActionId[];

/**
 * What a screen can run for each Grip action, or undefined for one it cannot:
 * the Fan draws that slot dimmed, and a lift on it runs nothing. Every action
 * has an entry, so the slots never move between screens.
 */
export type GripActionRuns = Readonly<Record<GripActionId, (() => void) | undefined>>;

/** A screen that can run no Grip action: every slot is dimmed. A screen starts from it and adds what it runs. */
export const NO_GRIP_ACTIONS: GripActionRuns = Object.fromEntries(GRIP_ACTION_IDS.map((id) => [id, undefined])) as GripActionRuns;

/** Titles that a screen gives an action in place of the catalog's, as Compose says "Close composer" while the Composer is open. */
export type GripActionTitles = Partial<Record<GripActionId, string>>;

type Slot = GripActionId | null;
/** The Fan's three slots beside Destinations, at 11, 10 and 9 o'clock. An empty slot stays empty. */
export type GripActionSlots = readonly [Slot, Slot, Slot];

export const DEFAULT_GRIP_ACTIONS: GripActionSlots = ['go-to', 'compose', 'options'];

/** The slots a saved value names: an action this version does not know, or one that is already in an earlier slot, leaves its slot empty. */
export function gripActionSlots(raw: unknown): GripActionSlots {
  if (!Array.isArray(raw)) return DEFAULT_GRIP_ACTIONS;
  const slot = (index: number): Slot => {
    const action = GRIP_ACTION_IDS.find((id) => id === raw[index]);
    return action && raw.indexOf(action) === index ? action : null;
  };
  return [slot(0), slot(1), slot(2)];
}

export function parseGripActions(raw: unknown): GripActionSlots | undefined {
  return Array.isArray(raw) ? gripActionSlots(raw) : undefined;
}

/** One slot of the Fan as it is drawn. A dimmed slot is one that the screen cannot run. */
export interface FanItem {
  id: 'destinations' | GripActionId;
  title: string;
  symbol: SFSymbol;
  dimmed: boolean;
}

/**
 * The Fan's four slots, from Destinations at 12 o'clock round to 9 o'clock,
 * which the slot numbers of navigation/grip.ts index. An empty slot is null.
 * Destinations is always there and never dimmed: the Edge Drawer runs on
 * both screens.
 */
export function fanItems(slots: GripActionSlots, runs: GripActionRuns, titles: GripActionTitles = {}): readonly (FanItem | null)[] {
  return [
    { id: 'destinations', ...DESTINATIONS_ACTION, dimmed: false },
    ...slots.map((id): FanItem | null => id === null ? null : {
      id, title: titles[id] ?? GRIP_ACTIONS[id].title, symbol: GRIP_ACTIONS[id].symbol, dimmed: runs[id] === undefined,
    }),
  ];
}
