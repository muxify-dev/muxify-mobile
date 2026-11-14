import { tmuxAtLeast } from './tmux-version';

/**
 * One key from a hardware keyboard, as the Surface reported it: the key and
 * the modifiers held. `key` is a tmux key name without modifiers (`Enter`,
 * `Tab`, `BSpace`, `Escape`, `Space`) or the character itself.
 */
export interface KeyPress {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * How much of tmux's key naming a Host's tmux can deliver.
 *
 * Measured in Docker on tmux 3.0a, 3.2a, 3.3a, 3.4, 3.5a and 3.8, with every
 * `extended-keys` setting and every keyboard mode a program can ask for:
 * - 'extended', 3.5 and later. Every name arrives, encoded for what the Pane
 *   asked for: S-Enter is CR to a shell and `ESC [ 13 ; 2 u` to Claude Code.
 * - 'classic', before 3.5. A name tmux cannot encode for the Pane is typed as
 *   text or lost: S-Enter into a shell on 3.4 types the seven characters
 *   `S-Enter`, and C-Enter types nothing.
 */
export type KeyNaming = 'extended' | 'classic';

/** Reads `#{version}`: `3.4`, `3.5a`, `next-3.6`, `master`. */
export function keyNamingFor(version: string): KeyNaming {
  return tmuxAtLeast(version, 3, 5) ? 'extended' : 'classic';
}

/** What goes to `send-keys`: a key name, or bytes for `-H`. */
export type RenderedPress = { key: string } | { bytes: Uint8Array };

/**
 * The control byte a classic terminal sends for ctrl and this character.
 * Before tmux 3.5 these have no name tmux delivers, so the byte goes instead.
 */
const CONTROL_BYTES: Record<string, number> = {
  '@': 0x00, '2': 0x00, ' ': 0x00,
  '[': 0x1b, '3': 0x1b,
  '\\': 0x1c, '4': 0x1c,
  ']': 0x1d, '5': 0x1d,
  '^': 0x1e, '6': 0x1e, '~': 0x1e,
  '_': 0x1f, '/': 0x1f, '7': 0x1f, '-': 0x1f,
  '?': 0x7f, '8': 0x7f,
};

/**
 * The symbols that have a control code: `C-[` is Escape, `C-_` is 0x1f.
 *
 * Measured on tmux 3.8 for every symbol on the Key Row. tmux refuses none of
 * the others, and sends something nobody pressed for each: `C-:` arrives as
 * `;`, `C-(` as `9`, and `C-*` as the three characters `C-*`. So ctrl is
 * dropped for a symbol outside this set.
 */
const CTRL_SYMBOLS = new Set('-_/|\\~[]{}`');

/** Keys that take no ctrl in tmux, on any version: C-BSpace and C-Escape are typed as text. */
const NO_CTRL = new Set(['BSpace', 'Escape']);

const isLetter = (key: string) => /^[A-Za-z]$/.test(key);
const isSymbol = (key: string) => key.length === 1 && !/^[0-9A-Za-z]$/.test(key);

/** The press as tmux will deliver it to whatever the Pane is running. */
export function renderPress(press: KeyPress, naming: KeyNaming): RenderedPress {
  const { key, alt } = press;
  const prefix = (ctrl: boolean, shift: boolean) => `${ctrl ? 'C-' : ''}${alt ? 'M-' : ''}${shift ? 'S-' : ''}`;

  if (naming === 'extended') {
    const ctrl = press.ctrl && !NO_CTRL.has(key) && (!isSymbol(key) || CTRL_SYMBOLS.has(key));
    // Shift-Tab is its own key to tmux: `ESC [ Z` to a shell, where S-Tab is a plain Tab.
    if (key === 'Tab' && press.shift) return { key: `${prefix(ctrl, false)}BTab` };
    // Shift and a letter is the capital letter. Measured on tmux 3.8, `M-S-f`
    // reaches a shell as `ESC f`, and `M-F` as `ESC F`. With ctrl the case
    // means nothing, and `C-S-r` stays.
    if (press.shift && !ctrl && isLetter(key)) return { key: `${prefix(false, false)}${key.toUpperCase()}` };
    return { key: `${prefix(ctrl, press.shift && !isSymbol(key))}${key}` };
  }

  // Classic: no S- name arrives, so shift goes, except as BTab; ctrl goes by
  // name only on a letter or Space, and as its control byte where it has one.
  if (key === 'Tab' && press.shift && !press.ctrl) return { key: `${prefix(false, false)}BTab` };
  if (press.ctrl && (isLetter(key) || key === 'Space')) {
    return { key: `${prefix(true, false)}${isLetter(key) ? key.toLowerCase() : key}` };
  }
  const control = press.ctrl ? CONTROL_BYTES[key] : undefined;
  if (control !== undefined) return { bytes: Uint8Array.from(alt ? [0x1b, control] : [control]) };
  const shifted = press.shift && isLetter(key) ? key.toUpperCase() : key;
  return { key: `${prefix(false, false)}${shifted}` };
}
