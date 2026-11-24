import {
  chordFor, chordLabel, KEYBOARD_ACTION_TITLES, type KeyboardShortcuts,
} from '@/keyboard/keyboard-shortcuts';

export const CONTROL_ACTIONS = {
  interrupt: { title: 'Interrupt', keys: ['c'] },
  'end-of-input': { title: 'End of input', keys: ['d'] },
  'clear-screen': { title: 'Clear screen', keys: ['l'] },
  'interrupt-twice': { title: 'Interrupt twice', keys: ['c', 'c'] },
  suspend: { title: 'Suspend', keys: ['z'] },
} as const;

const COMMAND_ACTIONS = ['split-right', 'split-down', 'paste', 'copy-pane', 'clear-pane'] as const;
export type QuickAction = keyof typeof CONTROL_ACTIONS | typeof COMMAND_ACTIONS[number];
export type QuickActionKey = 'ctrl' | 'cmd';
type Slot = QuickAction | null;
export type QuickActionSlots = readonly [Slot, Slot, Slot, Slot];
export type QuickActions = Readonly<Record<QuickActionKey, QuickActionSlots>>;

export const QUICK_ACTION_CATALOG: Readonly<Record<QuickActionKey, readonly QuickAction[]>> = {
  ctrl: ['interrupt', 'end-of-input', 'clear-screen', 'interrupt-twice', 'suspend'],
  cmd: COMMAND_ACTIONS,
};

export const DEFAULT_QUICK_ACTIONS: QuickActions = {
  ctrl: ['interrupt', 'end-of-input', 'clear-screen', 'interrupt-twice'],
  cmd: ['split-right', 'split-down', 'paste', null],
};

export function quickActionLabel(action: QuickAction, shortcuts?: KeyboardShortcuts) {
  switch (action) {
    case 'paste':
      return { title: 'Paste', chord: '⌘V' };
    case 'split-right':
    case 'split-down':
    case 'copy-pane':
    case 'clear-pane':
      return { title: KEYBOARD_ACTION_TITLES[action], chord: chordLabel(chordFor(shortcuts, action)) };
    default: {
      const { title, keys } = CONTROL_ACTIONS[action];
      const chord = '⌃' + keys[0].toUpperCase();
      return { title, chord: keys.length === 1 ? chord : chord + ' ×2' };
    }
  }
}

export function quickActionSlots(key: QuickActionKey, raw: unknown): QuickActionSlots {
  if (!Array.isArray(raw)) return DEFAULT_QUICK_ACTIONS[key];
  const slot = (index: number) => {
    const action = QUICK_ACTION_CATALOG[key].find((item) => item === raw[index]);
    return action && raw.indexOf(action) === index ? action : null;
  };
  return [slot(0), slot(1), slot(2), slot(3)];
}

export function parseQuickActions(raw: unknown): QuickActions | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  return {
    ctrl: quickActionSlots('ctrl', 'ctrl' in raw ? raw.ctrl : undefined),
    cmd: quickActionSlots('cmd', 'cmd' in raw ? raw.cmd : undefined),
  };
}
