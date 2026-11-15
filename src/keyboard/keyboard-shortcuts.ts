/**
 * What a hardware keyboard's ⌘ keys do in Muxify, and which keys the user
 * gave each of them.
 *
 * Every Keyboard Shortcut holds ⌘. tmux has no ⌘ to give a Pane, so a key
 * with ⌘ is never one a program in a Pane waits for, and taking it costs the
 * Pane nothing. A chord without ⌘ would take a key away from the Pane.
 */

export const KEYBOARD_ACTIONS = [
  'open-settings',
  'split-right',
  'split-down',
  'pane-left',
  'pane-down',
  'pane-up',
  'pane-right',
  'copy-pane',
  'clear-pane',
] as const;
export type KeyboardAction = (typeof KEYBOARD_ACTIONS)[number];

export const KEYBOARD_ACTION_TITLES: Record<KeyboardAction, string> = {
  'open-settings': 'Open Settings',
  'split-right': 'Split right',
  'split-down': 'Split down',
  'pane-left': 'Pane to the left',
  'pane-down': 'Pane below',
  'pane-up': 'Pane above',
  'pane-right': 'Pane to the right',
  'copy-pane': 'Copy Pane text',
  'clear-pane': 'Clear Pane',
};

/**
 * A key and the modifiers held with ⌘. `key` is what UIKit's key command
 * takes as its input: a lowercase character, or one of the arrow names.
 */
export interface KeyChord {
  key: string;
  shift: boolean;
  option: boolean;
  control: boolean;
}

/** The chords the user has changed. An action not in it has its default. */
export type KeyboardShortcuts = Partial<Record<KeyboardAction, KeyChord>>;

const chord = (key: string, shift = false): KeyChord => ({ key, shift, option: false, control: false });

export const DEFAULT_CHORDS: Readonly<Record<KeyboardAction, KeyChord>> = {
  'open-settings': chord(','),
  'split-right': chord('d'),
  'split-down': chord('d', true),
  'pane-left': chord('h', true),
  'pane-down': chord('j', true),
  'pane-up': chord('k', true),
  'pane-right': chord('l', true),
  'copy-pane': chord('c'),
  'clear-pane': chord('k'),
};

export function chordFor(shortcuts: KeyboardShortcuts | undefined, action: KeyboardAction): KeyChord {
  return shortcuts?.[action] ?? DEFAULT_CHORDS[action];
}

/** Every action's chord, the user's where there is one. */
export function chordsInForce(shortcuts: KeyboardShortcuts | undefined): Record<KeyboardAction, KeyChord> {
  return { ...DEFAULT_CHORDS, ...shortcuts };
}

export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && a.shift === b.shift && a.option === b.option && a.control === b.control;
}

const KEY_NAMES: Record<string, string> = {
  UIKeyInputLeftArrow: '←',
  UIKeyInputRightArrow: '→',
  UIKeyInputUpArrow: '↑',
  UIKeyInputDownArrow: '↓',
  UIKeyInputEscape: '⎋',
  '\r': '↩',
  '\t': '⇥',
  ' ': 'Space',
  '\b': '⌫',
};

/** The chord as the system writes one, modifiers in Apple's order: ⌃⌥⇧⌘D. */
export function chordLabel(value: KeyChord): string {
  const modifiers = `${value.control ? '⌃' : ''}${value.option ? '⌥' : ''}${value.shift ? '⇧' : ''}⌘`;
  return modifiers + (KEY_NAMES[value.key] ?? value.key.toUpperCase());
}

/** A key the recorder took, with every modifier it saw, ⌘ included. */
export interface RecordedKey extends KeyChord {
  command: boolean;
}

export type Rebinding =
  | { kind: 'bound'; shortcuts: KeyboardShortcuts }
  | { kind: 'no-command' }
  | { kind: 'taken'; by: KeyboardAction };

/**
 * Gives an action the recorded key. Refused without ⌘, and refused when
 * another action has the key already, so one press never means two things.
 * A key equal to the default drops the override, so a later change of the
 * default reaches this action.
 */
export function rebind(
  shortcuts: KeyboardShortcuts | undefined,
  action: KeyboardAction,
  recorded: RecordedKey,
): Rebinding {
  if (!recorded.command) return { kind: 'no-command' };
  const { command: _, ...next } = recorded;
  const by = KEYBOARD_ACTIONS.find(
    (other) => other !== action && sameChord(chordFor(shortcuts, other), next),
  );
  if (by !== undefined) return { kind: 'taken', by };
  const { [action]: _old, ...rest } = shortcuts ?? {};
  return {
    kind: 'bound',
    shortcuts: sameChord(next, DEFAULT_CHORDS[action]) ? rest : { ...rest, [action]: next },
  };
}

/** The changed chords a saved value names. Anything unrecognised is dropped. */
export function parseKeyboardShortcuts(raw: unknown): KeyboardShortcuts | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const entries = KEYBOARD_ACTIONS.flatMap((action): [KeyboardAction, KeyChord][] => {
    const value = parseChord(record[action]);
    return value ? [[action, value]] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseChord(raw: unknown): KeyChord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { key, shift, option, control } = raw as Record<string, unknown>;
  if (typeof key !== 'string' || key === '') return undefined;
  return { key, shift: shift === true, option: option === true, control: control === true };
}
