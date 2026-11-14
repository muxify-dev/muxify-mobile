import type { Modifier, Modifiers } from '@/lib/modifier-keys';

/**
 * The Mac's line-editing chords, and the bytes each one types.
 *
 * Both keyboards read this one table. A hardware keyboard reaches it through
 * ghostty, which gets it as keybinds (ghosttyKeybinds). The Key Row reads it
 * directly (editingSequence). So ⌘ or ⌥ tapped on the Key Row and then ⌫, ←
 * or → types what the same chord types on a hardware keyboard.
 *
 * The chords and bytes are ghostty's own macOS and iOS defaults
 * (`ghostty +list-keybinds --default`). They are bytes and not
 * tmux names, because a hardware keyboard sends ghostty's bytes. ⌥⌫ is not
 * here: ghostty has no keybind for it, and both keyboards send it to tmux as
 * `M-BSpace`, which deletes a word in bash and zsh.
 */
interface EditingKey {
  /** The key as tmux names it, which is how the Key Row knows it. */
  key: 'BSpace' | 'Left' | 'Right';
  /** The one modifier held with it. */
  modifier: Exclude<Modifier, 'ctrl'>;
  bytes: readonly number[];
}

const EDITING_KEYS: readonly EditingKey[] = [
  // ctrl-U: delete back to the start of the line.
  { key: 'BSpace', modifier: 'cmd', bytes: [0x15] },
  // ctrl-A and ctrl-E: to the start and the end of the line.
  { key: 'Left', modifier: 'cmd', bytes: [0x01] },
  { key: 'Right', modifier: 'cmd', bytes: [0x05] },
  // ESC b and ESC f: one word back and one word forward.
  { key: 'Left', modifier: 'alt', bytes: [0x1b, 0x62] },
  { key: 'Right', modifier: 'alt', bytes: [0x1b, 0x66] },
];

/**
 * The bytes for this key with exactly these modifiers, or undefined when the
 * chord is not a line-editing one. Exactly, as ghostty matches a keybind:
 * ⌘⌥← is not ⌘←.
 */
export function editingSequence(key: string, modifiers: Modifiers): Uint8Array | undefined {
  const match = EDITING_KEYS.find(
    (each) =>
      each.key === key &&
      (Object.keys(modifiers) as Modifier[]).every((modifier) => modifiers[modifier] === (modifier === each.modifier)),
  );
  return match && Uint8Array.from(match.bytes);
}

const GHOSTTY_KEYS: Record<EditingKey['key'], string> = {
  BSpace: 'backspace',
  Left: 'arrow_left',
  Right: 'arrow_right',
};

const GHOSTTY_MODIFIERS: Record<EditingKey['modifier'], string> = { cmd: 'super', alt: 'alt' };

/** The table as ghostty keybinds: `super+backspace=text:\x15`. */
export function ghosttyKeybinds(): string[] {
  return EDITING_KEYS.map(({ key, modifier, bytes }) => {
    const text = bytes.map((byte) => `\\x${byte.toString(16).padStart(2, '0')}`).join('');
    return `${GHOSTTY_MODIFIERS[modifier]}+${GHOSTTY_KEYS[key]}=text:${text}`;
  });
}
