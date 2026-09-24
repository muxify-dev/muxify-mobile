/**
 * Sticky ctrl and alt, for a keyboard that has neither.
 *
 * A phone's keyboard has no modifier keys and no way to hold one down while
 * pressing another. The Key Bar's answer is the one every mobile terminal
 * arrives at: arm the modifier with a tap, and it applies to the next key
 * typed. Which is why these are *sticky* — armed, then spent — rather than
 * held.
 *
 * What comes out is a tmux key name, not bytes. `C-f` rather than `0x06`, for
 * the same reason the rest of the app sends names: tmux knows what the Pane is
 * running and this does not. It also means one path for every key, whether it
 * came from the Key Bar or from the system keyboard with a modifier armed.
 *
 * Pure: bytes and flags in, a name and the leftover bytes out.
 */

/** Which sticky modifiers are armed. */
export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false };

/** Whether anything is armed at all. */
export function anyArmed(modifiers: Modifiers): boolean {
  return modifiers.ctrl || modifiers.alt;
}

/** What tmux calls this combination, ready to put in front of a key name. */
export function modifierPrefix(modifiers: Modifiers): string {
  return `${modifiers.ctrl ? 'C-' : ''}${modifiers.alt ? 'M-' : ''}`;
}

/** What typing turned into: at most one modified key, then ordinary bytes. */
export interface ModifiedInput {
  /** The tmux name for the key the modifiers applied to, if there was one. */
  key?: string;
  /** Everything after it, to be typed as it arrived. */
  rest: Uint8Array;
}

/**
 * Applies the armed modifiers to the first key of what was typed.
 *
 * Only the first, because a modifier is spent on one key. The Surface batches
 * input, so a fast typist's ctrl-r can arrive with the search term already
 * behind it — modifying the whole batch would send a line of control codes.
 *
 * A key with no honest tmux name is left alone and typed as it arrived. There
 * is no `C-` form of an emoji, and inventing one would send something the user
 * never pressed.
 */
export function applyModifiers(bytes: Uint8Array, modifiers: Modifiers): ModifiedInput {
  if (!anyArmed(modifiers) || bytes.length === 0) return { rest: bytes };

  const name = keyNameOf(bytes[0], modifiers);
  if (name === undefined) return { rest: bytes };
  return { key: `${modifierPrefix(modifiers)}${name}`, rest: bytes.subarray(1) };
}

/** tmux's name for one typed byte, for the keys a modifier makes sense of. */
function keyNameOf(byte: number, modifiers: Modifiers): string | undefined {
  // Space has no printable form, and `C-Space` is a key people genuinely press.
  if (byte === 0x20) return 'Space';

  const character = String.fromCharCode(byte);
  if (/^[0-9]$/.test(character)) return character;
  if (!/^[A-Za-z]$/.test(character)) return undefined;

  // Ctrl folds case and alt does not, because ctrl-F and ctrl-shift-F are the
  // same control code while M-F and M-f are two different keys.
  return modifiers.ctrl ? character.toLowerCase() : character;
}
