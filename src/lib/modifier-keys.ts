/**
 * Sticky ctrl, option and command, for a keyboard that has none of them.
 *
 * A phone's keyboard has no modifier keys and no way to hold one down while
 * pressing another. The Key Row's answer is the one every mobile terminal
 * arrives at: arm the modifier with a tap, and it applies to the next key
 * typed. Which is why these are *sticky* — armed, then spent — rather than
 * held.
 *
 * What comes out for ctrl and option is a tmux key name, not bytes. `C-f`
 * rather than `0x06`, for the same reason the rest of the app sends names:
 * tmux knows what the Pane is running and this does not. It also means one
 * path for every key, whether it came from the Key Row or from the system
 * keyboard with a modifier armed. Command never reaches tmux: it turns the
 * next key into something the phone does.
 *
 * Pure: bytes and flags in, a name or a Shortcut and the leftover bytes out.
 */

export type Modifier = 'ctrl' | 'alt' | 'cmd';

/** Which sticky modifiers are armed. */
export type Modifiers = Record<Modifier, boolean>;

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, cmd: false };

/**
 * What tmux calls this combination, ready to put in front of a key name.
 * Command has no part in it: tmux has no such modifier to give a Pane.
 */
export function modifierPrefix(modifiers: Modifiers): string {
  return `${modifiers.ctrl ? 'C-' : ''}${modifiers.alt ? 'M-' : ''}`;
}

/** What command and a letter do on the phone. */
export type Shortcut = 'copy' | 'paste' | 'clear';

const SHORTCUTS: Record<string, Shortcut> = { c: 'copy', v: 'paste', k: 'clear' };

/** What typing turned into. `rest` is typed as it arrived, after the rest. */
export type ModifiedInput =
  | { kind: 'typed'; rest: Uint8Array }
  /** One key by its tmux name, with ctrl and option applied to it. */
  | { kind: 'key'; key: string; rest: Uint8Array }
  | { kind: 'shortcut'; shortcut: Shortcut; rest: Uint8Array };

/**
 * Applies the armed modifiers to the first key of what was typed.
 *
 * Only the first, because a modifier is spent on one key. The Surface batches
 * input, so a fast typist's ctrl-r can arrive with the search term already
 * behind it — modifying the whole batch would send a line of control codes.
 *
 * Command and a letter that is not a Shortcut is that letter, with ctrl and
 * option applied as if command were not armed.
 *
 * A key with no honest tmux name is left alone and typed as it arrived. There
 * is no `C-` form of an emoji, and inventing one would send something the user
 * never pressed.
 */
export function applyModifiers(bytes: Uint8Array, modifiers: Modifiers): ModifiedInput {
  if (bytes.length === 0) return { kind: 'typed', rest: bytes };

  if (modifiers.cmd) {
    const shortcut = SHORTCUTS[String.fromCharCode(bytes[0]).toLowerCase()];
    if (shortcut !== undefined) return { kind: 'shortcut', shortcut, rest: bytes.subarray(1) };
  }

  const key = modifiedKeyName(bytes[0], modifiers);
  if (key === undefined) return { kind: 'typed', rest: bytes };
  return { kind: 'key', key, rest: bytes.subarray(1) };
}

/**
 * What stays armed after typed input.
 *
 * A Shortcut or a modified key spends everything. Input that the modifiers
 * could not apply to spends command only: command is for the next key whatever
 * it is, while ctrl waits for a key it has a form of.
 */
export function armedAfter(input: ModifiedInput, armed: Modifiers): Modifiers {
  if (input.kind !== 'typed') return NO_MODIFIERS;
  return input.rest.length > 0 && armed.cmd ? { ...armed, cmd: false } : armed;
}

/**
 * The keys the system keyboard has that are not characters, by the byte the
 * Surface sends for each and the name tmux knows it by.
 *
 * Return is the one that was missed first: alt-Return is how Claude Code, and
 * most line editors, take a newline without running the line, and a Return
 * with alt armed used to go out as a plain Return with alt still lit. Return
 * arrives as CR because toShellInput has already turned the Surface's LF into
 * one; delete arrives as DEL from ghostty, with BS kept for a keyboard that
 * sends that instead.
 */
const NAMED_KEYS: Record<number, string> = {
  0x20: 'Space',
  0x0d: 'Enter',
  0x09: 'Tab',
  0x7f: 'BSpace',
  0x08: 'BSpace',
};

/** The Key Row's symbols. Option applies to each: `M--` is `ESC -`. */
const SYMBOLS = new Set('-_:|/\\~\'[]{}<>()"`=+*&$#');

/**
 * The symbols that have a control code: `C-[` is Escape, `C-_` is 0x1f.
 *
 * Measured on tmux 3.8 for every symbol in SYMBOLS. tmux refuses none of the
 * others, and sends something nobody pressed for each: `C-:` arrives as `;`,
 * `C-(` as `9`, and `C-*` as the three characters `C-*`. So ctrl is dropped
 * for a symbol outside this set.
 */
const CTRL_SYMBOLS = new Set('-_/|\\~[]{}`');

/** The first typed byte as a tmux key name with ctrl and option applied. */
function modifiedKeyName(byte: number, modifiers: Modifiers): string | undefined {
  const named = NAMED_KEYS[byte];
  const character = String.fromCharCode(byte);
  let ctrl = modifiers.ctrl;
  let name: string;
  if (named !== undefined) name = named;
  else if (/^[0-9]$/.test(character)) name = character;
  // Ctrl folds case and alt does not, because ctrl-F and ctrl-shift-F are the
  // same control code while M-F and M-f are two different keys.
  else if (/^[A-Za-z]$/.test(character)) name = ctrl ? character.toLowerCase() : character;
  else if (SYMBOLS.has(character)) {
    name = character;
    ctrl = ctrl && CTRL_SYMBOLS.has(character);
  } else return undefined;

  const prefix = modifierPrefix({ ...modifiers, ctrl });
  return prefix === '' ? undefined : `${prefix}${name}`;
}
