import type { ArrowDirection } from '@/lib/arrow-stick';
import type { Modifier } from '@/lib/modifier-keys';

/**
 * The Key Row's keys: what a phone keyboard does not have.
 *
 * A key here says which key it is, and not what the key types. The Surface
 * presses it as a hardware keyboard presses the same key, with the armed
 * modifiers held, and ghostty finds the bytes.
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
  /** The name the Surface presses the key by. */
  key: 'Escape' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right';
  label: string;
  spoken: string;
}

/** Two symbols on one key: a tap types `main`, a drag down types `alternate`. */
export interface PairKey {
  kind: 'pair';
  main: string;
  alternate: string;
  spoken: string;
}

export type RowKey = ModifierKey | NamedKey | PairKey;

/** The fixed section at the left. */
export const LEFT_KEYS: (ModifierKey | NamedKey)[] = [
  { kind: 'named', key: 'Escape', label: '⎋', spoken: 'escape' },
  { kind: 'modifier', modifier: 'ctrl', label: '⌃', spoken: 'control' },
  { kind: 'modifier', modifier: 'alt', label: '⌥', spoken: 'option' },
  { kind: 'named', key: 'Tab', label: '⇥', spoken: 'tab' },
];

/** The middle, which scrolls sideways. */
export const PAIR_KEYS: PairKey[] = [
  { kind: 'pair', main: '-', alternate: '_', spoken: 'minus underscore' },
  { kind: 'pair', main: ':', alternate: '|', spoken: 'colon bar' },
  { kind: 'pair', main: '/', alternate: '\\', spoken: 'slash backslash' },
  { kind: 'pair', main: '~', alternate: "'", spoken: 'tilde quote' },
  { kind: 'pair', main: '[', alternate: ']', spoken: 'left bracket right bracket' },
  { kind: 'pair', main: '{', alternate: '}', spoken: 'left brace right brace' },
  { kind: 'pair', main: '<', alternate: '>', spoken: 'less than greater than' },
  { kind: 'pair', main: '(', alternate: ')', spoken: 'left paren right paren' },
  { kind: 'pair', main: '"', alternate: '`', spoken: 'double quote backtick' },
  { kind: 'pair', main: '=', alternate: '+', spoken: 'equals plus' },
  { kind: 'pair', main: '*', alternate: '&', spoken: 'asterisk ampersand' },
  { kind: 'pair', main: '$', alternate: '#', spoken: 'dollar hash' },
];

/** The four arrows the arrow key at the right sends, by the way it is dragged. */
export const ARROW_KEYS = {
  up: { kind: 'named', key: 'Up', label: '▲', spoken: 'up' },
  left: { kind: 'named', key: 'Left', label: '◀', spoken: 'left' },
  down: { kind: 'named', key: 'Down', label: '▼', spoken: 'down' },
  right: { kind: 'named', key: 'Right', label: '▶', spoken: 'right' },
} satisfies Record<ArrowDirection, NamedKey>;

/** Command, in the fixed section at the right between Panes and Keyboard. */
export const COMMAND_KEY: ModifierKey = {
  kind: 'modifier',
  modifier: 'cmd',
  label: '⌘',
  spoken: 'command',
};
