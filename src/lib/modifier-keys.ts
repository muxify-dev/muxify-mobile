/**
 * Sticky ctrl, option and command, for a keyboard that has none of them.
 *
 * A phone's keyboard has no modifier keys and no way to hold one down while
 * pressing another. The Key Row's answer is the one every mobile terminal
 * arrives at: arm the modifier with a tap, and it applies to the next key
 * typed. Which is why these are *sticky* — armed, then spent — rather than
 * held.
 *
 * The armed modifiers and the next key go into the Surface as one key press,
 * the way a hardware keyboard's go in. ghostty applies its keybinds and
 * encodes the key, so nothing here knows what a chord types. This file
 * answers the two questions that come before the press: which keys were
 * typed, and which chord a key with command armed is.
 *
 * Pure: bytes and flags in, keys or a chord out.
 */

import type { KeyChord } from '@/keyboard/keyboard-shortcuts';
import { bytesToUtf8 } from '@/lib/utf8';

export type Modifier = 'ctrl' | 'alt' | 'cmd';

/** Which sticky modifiers are armed. */
export type Modifiers = Record<Modifier, boolean>;

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, cmd: false };

export function anyArmed(modifiers: Modifiers): boolean {
  return modifiers.ctrl || modifiers.alt || modifiers.cmd;
}

/** The named keys as a Keyboard Shortcut's chord has them, which is UIKit's way. */
const CHORD_KEYS: Record<string, string> = {
  Escape: 'UIKeyInputEscape',
  Tab: '\t',
  Enter: '\r',
  Backspace: '\b',
  Up: 'UIKeyInputUpArrow',
  Down: 'UIKeyInputDownArrow',
  Left: 'UIKeyInputLeftArrow',
  Right: 'UIKeyInputRightArrow',
};

/**
 * The chord this key and the armed modifiers make, as a hardware keyboard
 * would make it, or undefined without command. Whether a Keyboard Shortcut
 * claims the chord is the native module's to say, for both keyboards.
 */
export function commandChord(key: string, modifiers: Modifiers): KeyChord | undefined {
  if (!modifiers.cmd) return undefined;
  return {
    key: CHORD_KEYS[key] ?? key.toLowerCase(),
    // A capital letter is the software keyboard's shift.
    shift: /^[A-Z]$/.test(key),
    option: modifiers.alt,
    control: modifiers.ctrl,
  };
}

/**
 * The keys the system keyboard has that are not characters, by the byte the
 * Surface sends for each. Return arrives as CR because toShellInput has
 * already turned the Surface's LF into one. Delete arrives as DEL from
 * ghostty, with BS kept for a keyboard that sends that instead.
 */
const NAMED_KEYS: Record<string, string> = {
  '\r': 'Enter',
  '\t': 'Tab',
  '\x7f': 'Backspace',
  '\b': 'Backspace',
};

/**
 * The keys that the system keyboard typed for these bytes, each by the name
 * the Surface presses it by: a named key, or the character itself.
 *
 * More than one, because the keyboard gives a swiped word or a dictated
 * phrase as one piece. Undefined when the bytes are not typing: an escape
 * sequence that the Surface wrote by itself, or a character cut in two.
 */
export function typedKeys(bytes: Uint8Array): string[] | undefined {
  const keys = Array.from(bytesToUtf8(bytes), (character) => NAMED_KEYS[character] ?? character);
  const typing = keys.every((key) => key.length > 1 || (key >= ' ' && key !== '�'));
  return typing && keys.length > 0 ? keys : undefined;
}
