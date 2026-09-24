import type { SFSymbol } from 'sf-symbols-typescript';

/**
 * The keys a phone keyboard does not have, and a terminal cannot do without.
 *
 * ADR 0003 ruled a modifier group out of the Dock because the terminal library
 * shipped its own Accessory Bar above the keyboard with ctrl, esc and tab in
 * it, and two rows of the same keys is worse than one. That bar is now turned
 * off by a local patch — it covered the Dock whenever the Surface was focused
 * — which leaves the app with no escape, no tab and no arrows at all. This is
 * where they went.
 *
 * Every entry is a *tmux key name* rather than the bytes for it. Which bytes
 * are right depends on what the Pane is running: Up into a shell is `ESC [ A`
 * and Up into anything that has turned DECCKM on is `ESC O A`. tmux is the
 * only one here that knows which, so it is tmux that is asked — see
 * sendKeyCommand.
 */
export interface MetaKey {
  /** What `send-keys` is given. */
  key: string;
  /** What the menu says, and what the accessibility tree exposes. */
  label: string;
  systemImage?: SFSymbol;
}

export interface MetaSection {
  id: string;
  title?: string;
  /**
   * How the section is drawn inside the menu.
   *
   * `row` is a SwiftUI ControlGroup: the keys sit side by side as icons rather
   * than stacked as rows, which is the difference between four arrows taking a
   * line each and four arrows taking one. `nested` is a submenu, for the
   * groups that are long and reached for less often.
   */
  kind: 'row' | 'nested';
  keys: MetaKey[];
}

/**
 * What the Meta button offers, in the order it offers it.
 *
 * The two rows first because they are what a terminal needs constantly and a
 * menu row each would fill the screen with them. The submenus after, because
 * ten control keys as ten rows is a list nobody reads — grouped, it is one
 * line that says Control.
 */
export const META_SECTIONS: MetaSection[] = [
  // Three to a row, measured: iOS wraps a ControlGroup after three and the
  // fourth lands on a line of its own with its label beside it rather than
  // under it, which reads as a mistake. So the arrows go two and two.
  {
    id: 'keys',
    kind: 'row',
    keys: [
      { key: 'Escape', label: 'Esc', systemImage: 'escape' },
      { key: 'Tab', label: 'Tab', systemImage: 'arrow.right.to.line' },
      { key: 'Enter', label: 'Enter', systemImage: 'return' },
    ],
  },
  {
    id: 'arrows-across',
    kind: 'row',
    keys: [
      { key: 'Left', label: 'Left', systemImage: 'arrow.left' },
      { key: 'Right', label: 'Right', systemImage: 'arrow.right' },
    ],
  },
  {
    id: 'arrows-down',
    kind: 'row',
    keys: [
      { key: 'Up', label: 'Up', systemImage: 'arrow.up' },
      { key: 'Down', label: 'Down', systemImage: 'arrow.down' },
    ],
  },
  {
    id: 'control',
    title: 'Control',
    kind: 'nested',
    keys: [
      // The ten that earn their place on a phone: interrupt, end of file,
      // suspend, clear, reverse search, and the line editing readline gives
      // every shell.
      { key: 'C-c', label: 'Ctrl C — interrupt' },
      { key: 'C-d', label: 'Ctrl D — end of file' },
      { key: 'C-z', label: 'Ctrl Z — suspend' },
      { key: 'C-l', label: 'Ctrl L — clear' },
      { key: 'C-r', label: 'Ctrl R — search history' },
      { key: 'C-a', label: 'Ctrl A — start of line' },
      { key: 'C-e', label: 'Ctrl E — end of line' },
      { key: 'C-u', label: 'Ctrl U — cut to start' },
      { key: 'C-k', label: 'Ctrl K — cut to end' },
      { key: 'C-w', label: 'Ctrl W — cut word' },
    ],
  },
  {
    id: 'option',
    title: 'Option',
    kind: 'nested',
    keys: [
      { key: 'M-b', label: 'Opt B — back a word' },
      { key: 'M-f', label: 'Opt F — forward a word' },
      { key: 'M-BSpace', label: 'Opt Backspace — cut word' },
      { key: 'M-.', label: 'Opt . — last argument' },
    ],
  },
  {
    id: 'move',
    title: 'Move',
    kind: 'nested',
    keys: [
      { key: 'Home', label: 'Home' },
      { key: 'End', label: 'End' },
      { key: 'PageUp', label: 'Page Up' },
      { key: 'PageDown', label: 'Page Down' },
    ],
  },
];
