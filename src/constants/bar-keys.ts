import { modifierPrefix, type Modifiers } from '@/lib/modifier-keys';

/**
 * The keys a phone keyboard does not have, in the order the Key Bar shows them.
 *
 * ADR 0003 dropped a modifier group because the terminal library drew its own
 * bar above the system keyboard. That bar is off — it covered the Dock — which
 * left the app with no escape, no tab and no arrows at all. This is what went
 * in its place.
 *
 * Every entry is a *tmux key name*, not the bytes for it. Which bytes are right
 * depends on what the Pane is running: measured on tmux 3.6, `Up` into a shell
 * is `ESC [ A` and `Up` into anything that has turned DECCKM on is `ESC O A`.
 * tmux is the only one here that knows which, so it is tmux that is asked.
 *
 * Ordered by how often a hand reaches for them, because only the first few are
 * on screen: the bar scrolls, and what is past the edge has to be looked for.
 */
export interface BarKey {
  /** What `send-keys` is given, or what a modifier puts in front of one. */
  key: string;
  /** What the bar shows. */
  label: string;
  /** What the accessibility tree says, where the label is a glyph. */
  spoken?: string;
  /**
   * A modifier arms rather than acts: tapped, it waits for the next key.
   *
   * A phone keyboard has no way to hold a key down while pressing another, so
   * every mobile terminal arrives at the same answer. See modifier-keys.
   */
  modifier?: 'ctrl' | 'alt';
  /**
   * Whether tmux knows a ctrl form of this key. Assume it does.
   *
   * Measured on tmux 3.6 across every key on this bar and both modifiers, and
   * `C-Escape` is the one hole: tmux does not recognise it and `send-keys`
   * does not refuse it either — it types the eight characters `C-Escape` into
   * the Pane. `M-Escape` is fine, and so is every other combination here.
   */
  takesCtrl?: boolean;
}

/**
 * What to send for this key with these modifiers armed.
 *
 * Drops a modifier the key has no form of, rather than sending a name tmux
 * will type out as text.
 */
export function barKeyName(key: BarKey, armed: Modifiers): string {
  return `${modifierPrefix({ ...armed, ctrl: armed.ctrl && key.takesCtrl !== false })}${key.key}`;
}

export const BAR_KEYS: BarKey[] = [
  { key: 'C-', label: 'ctrl', modifier: 'ctrl' },
  { key: 'Escape', label: 'esc', takesCtrl: false },
  { key: 'Tab', label: 'tab' },
  { key: 'Left', label: '←', spoken: 'left' },
  { key: 'Down', label: '↓', spoken: 'down' },
  { key: 'Up', label: '↑', spoken: 'up' },
  { key: 'Right', label: '→', spoken: 'right' },
  // Arrows with a bar at the head, matching the four beside them: page up and
  // page down move the same way the arrows do and further, and a row of four
  // glyphs followed by two words read as two different kinds of key. `pgup`
  // and `pgdn` were also the only labels on the bar that had to shrink to fit.
  // Not ⇞ and ⇟, which are what a Mac keyboard prints: they are a pair of
  // their own and say nothing about which way they go to an eye that has not
  // seen them before.
  { key: 'PageUp', label: '⤒', spoken: 'page up' },
  { key: 'PageDown', label: '⤓', spoken: 'page down' },
  { key: 'M-', label: 'alt', modifier: 'alt' },
  // Spoken as what they do rather than what they are called. `home` and the
  // Dock's own Home button are two different journeys, and a screen that
  // offers both under one name is ambiguous to a reader and to automation
  // alike — measured: `press label="Home"` matched this key and tapped where
  // it would have been if the bar were not scrolled.
  { key: 'Home', label: 'home', spoken: 'line start' },
  { key: 'End', label: 'end', spoken: 'line end' },
];
