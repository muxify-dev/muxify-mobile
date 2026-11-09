import { modifierPrefix, type Modifier, type Modifiers } from '@/lib/modifier-keys';

/**
 * The Key Row's keys: what a phone keyboard does not have.
 *
 * Every named key is a *tmux key name*, not the bytes for it. Which bytes are
 * right depends on what the Pane is running: measured on tmux 3.6, `Up` into a
 * shell is `ESC [ A` and `Up` into anything that has turned DECCKM on is
 * `ESC O A`. tmux is the only one here that knows which, so it is tmux that is
 * asked.
 */

/** Arms rather than acts: tapped, it waits for the next key. See modifier-keys. */
export interface ModifierKey {
  kind: 'modifier';
  modifier: Modifier;
  label: string;
  spoken: string;
}

export interface NamedKey {
  kind: 'named';
  /** What `send-keys` is given. */
  key: string;
  label: string;
  spoken: string;
  /**
   * Set where tmux knows no ctrl form of this key.
   *
   * `C-Escape` is the one hole among the named keys: tmux does not recognise
   * it and `send-keys` does not refuse it either — it types the eight
   * characters `C-Escape` into the Pane. `M-Escape` is fine.
   */
  takesCtrl?: false;
}

/** Two symbols on one key: a tap types `top`, a drag down types `bottom`. */
export interface PairKey {
  kind: 'pair';
  top: string;
  bottom: string;
  spoken: string;
}

export type RowKey = ModifierKey | NamedKey | PairKey;

/**
 * What to send for this key with these modifiers armed.
 *
 * Drops a modifier the key has no form of, rather than sending a name tmux
 * will type out as text.
 */
export function namedKeyName(key: NamedKey, armed: Modifiers): string {
  return `${modifierPrefix({ ...armed, ctrl: armed.ctrl && key.takesCtrl !== false })}${key.key}`;
}

/** The fixed group at the left. */
export const LEFT_KEYS: (ModifierKey | NamedKey)[] = [
  { kind: 'named', key: 'Escape', label: '⎋', spoken: 'escape', takesCtrl: false },
  { kind: 'modifier', modifier: 'ctrl', label: '⌃', spoken: 'control' },
  { kind: 'modifier', modifier: 'alt', label: '⌥', spoken: 'option' },
  { kind: 'named', key: 'Tab', label: '⇥', spoken: 'tab' },
];

/** The middle, which scrolls sideways. */
export const PAIR_KEYS: PairKey[] = [
  { kind: 'pair', top: '-', bottom: '_', spoken: 'minus underscore' },
  { kind: 'pair', top: ':', bottom: '|', spoken: 'colon bar' },
  { kind: 'pair', top: '/', bottom: '\\', spoken: 'slash backslash' },
  { kind: 'pair', top: '~', bottom: "'", spoken: 'tilde quote' },
  { kind: 'pair', top: '[', bottom: ']', spoken: 'left bracket right bracket' },
  { kind: 'pair', top: '{', bottom: '}', spoken: 'left brace right brace' },
  { kind: 'pair', top: '<', bottom: '>', spoken: 'less than greater than' },
  { kind: 'pair', top: '(', bottom: ')', spoken: 'left paren right paren' },
  { kind: 'pair', top: '"', bottom: '`', spoken: 'double quote backtick' },
  { kind: 'pair', top: '=', bottom: '+', spoken: 'equals plus' },
  { kind: 'pair', top: '*', bottom: '&', spoken: 'asterisk ampersand' },
  { kind: 'pair', top: '$', bottom: '#', spoken: 'dollar hash' },
];

/** The four arrows of the fixed group at the right, by where each sits. */
export const ARROW_KEYS = {
  up: { kind: 'named', key: 'Up', label: '▲', spoken: 'up' },
  left: { kind: 'named', key: 'Left', label: '◀', spoken: 'left' },
  down: { kind: 'named', key: 'Down', label: '▼', spoken: 'down' },
  right: { kind: 'named', key: 'Right', label: '▶', spoken: 'right' },
} satisfies Record<string, NamedKey>;

/** Command, in the fixed group at the right between Panes and Keyboard. */
export const COMMAND_KEY: ModifierKey = {
  kind: 'modifier',
  modifier: 'cmd',
  label: '⌘',
  spoken: 'command',
};
