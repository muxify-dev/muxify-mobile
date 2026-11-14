import { editingSequence, ghosttyKeybinds } from './editing-keys';
import { applyModifiers, armedAfter, NO_MODIFIERS, type Modifiers } from '@/lib/modifier-keys';

const armed = (over: Partial<Modifiers>): Modifiers => ({ ...NO_MODIFIERS, ...over });
const hex = (bytes: Uint8Array | undefined) => bytes && Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
const DEL = Uint8Array.from([0x7f]);

describe('the line-editing chords', () => {
  it.each([
    ['⌘⌫ deletes to the start of the line', 'BSpace', { cmd: true }, '15'],
    ['⌘← goes to the start of the line', 'Left', { cmd: true }, '01'],
    ['⌘→ goes to the end of the line', 'Right', { cmd: true }, '05'],
    ['⌥← goes back a word', 'Left', { alt: true }, '1b 62'],
    ['⌥→ goes forward a word', 'Right', { alt: true }, '1b 66'],
  ])('%s', (_, key, modifiers, bytes) => {
    expect(hex(editingSequence(key, armed(modifiers)))).toBe(bytes);
  });

  it.each([
    ['⌥⌫, which goes to tmux as M-BSpace', 'BSpace', { alt: true }],
    ['⌘⌥←, which is not ⌘←', 'Left', { cmd: true, alt: true }],
    ['⌃←, which goes to tmux as C-Left', 'Left', { ctrl: true }],
    ['⌘↑, which ghostty keeps for itself', 'Up', { cmd: true }],
    ['← alone', 'Left', {}],
  ])('leaves out %s', (_, key, modifiers) => {
    expect(editingSequence(key, armed(modifiers))).toBeUndefined();
  });
});

describe('a hardware keyboard and the Key Row', () => {
  it("give ghostty the chords it binds by default on the Mac", () => {
    // `ghostty +list-keybinds --default` on Ghostty 1.2, with esc:b written as
    // the bytes it sends.
    expect(ghosttyKeybinds()).toEqual([
      'super+backspace=text:\\x15',
      'super+arrow_left=text:\\x01',
      'super+arrow_right=text:\\x05',
      'alt+arrow_left=text:\\x1b\\x62',
      'alt+arrow_right=text:\\x1b\\x66',
    ]);
  });

  it('type the same bytes for every chord ghostty is given', () => {
    const KEYS: Record<string, string> = { backspace: 'BSpace', arrow_left: 'Left', arrow_right: 'Right' };
    const MODIFIERS: Record<string, keyof Modifiers> = { super: 'cmd', alt: 'alt' };
    for (const keybind of ghosttyKeybinds()) {
      const [, modifier, key, text] = /^(\w+)\+(\w+)=text:(.*)$/.exec(keybind)!;
      const hardware = text.split('\\x').filter(Boolean).join(' ');
      expect(hex(editingSequence(KEYS[key], armed({ [MODIFIERS[modifier]]: true })))).toBe(hardware);
    }
  });
});

describe('⌘ armed on the Key Row and then delete on the system keyboard', () => {
  it('types ctrl-U, as ⌘⌫ does on a hardware keyboard', () => {
    const out = applyModifiers(DEL, armed({ cmd: true }));
    expect(out.kind).toBe('sequence');
    expect(out.kind === 'sequence' && hex(out.bytes)).toBe('15');
  });

  it('types the rest of the batch after it', () => {
    const out = applyModifiers(Uint8Array.from([0x7f, 0x61]), armed({ cmd: true }));
    expect(hex(out.rest)).toBe('61');
  });

  it('spends every modifier', () => {
    const out = applyModifiers(DEL, armed({ cmd: true }));
    expect(armedAfter(out, armed({ cmd: true }))).toEqual(NO_MODIFIERS);
  });

  it('with ⌥ instead is still M-BSpace, the same press a hardware ⌥⌫ makes', () => {
    const out = applyModifiers(DEL, armed({ alt: true }));
    expect(out).toMatchObject({ kind: 'key', key: { key: 'BSpace', alt: true, ctrl: false } });
  });
});
