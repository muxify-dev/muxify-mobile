import {
  applyModifiers,
  armedAfter,
  modifierPrefix,
  NO_MODIFIERS,
  type Modifiers,
} from './modifier-keys';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const armed = (over: Partial<Modifiers>): Modifiers => ({ ...NO_MODIFIERS, ...over });
/** The tmux key name the first typed key became, if it became one. */
const keyOf = (typed: Uint8Array, modifiers: Modifiers) => {
  const out = applyModifiers(typed, modifiers);
  return out.kind === 'key' ? out.key : undefined;
};

describe('what the armed modifiers are called', () => {
  it('names them the way tmux does', () => {
    expect(modifierPrefix(armed({ ctrl: true }))).toBe('C-');
    expect(modifierPrefix(armed({ alt: true }))).toBe('M-');
    expect(modifierPrefix(armed({ ctrl: true, alt: true }))).toBe('C-M-');
    expect(modifierPrefix(NO_MODIFIERS)).toBe('');
  });

  it('leaves command out, which tmux has no name for', () => {
    expect(modifierPrefix(armed({ cmd: true }))).toBe('');
    expect(modifierPrefix(armed({ cmd: true, ctrl: true }))).toBe('C-');
  });
});

describe('typing while a modifier is armed', () => {
  it('leaves ordinary typing alone', () => {
    const out = applyModifiers(bytes('hello'), NO_MODIFIERS);
    expect(out.kind).toBe('typed');
    expect(text(out.rest)).toBe('hello');
  });

  it('turns the next letter into a modified key', () => {
    const out = applyModifiers(bytes('f'), armed({ ctrl: true }));
    expect(out).toMatchObject({ kind: 'key', key: 'C-f' });
    expect(out.rest).toHaveLength(0);
  });

  it('modifies only the first key of a burst', () => {
    // The Surface batches, so a fast typist's ctrl-r can arrive with the
    // search term already behind it. Only the key the modifier was armed for
    // is modified; the rest is ordinary typing.
    const out = applyModifiers(bytes('rgrep'), armed({ ctrl: true }));
    expect(out).toMatchObject({ kind: 'key', key: 'C-r' });
    expect(text(out.rest)).toBe('grep');
  });

  it('folds a capital letter for ctrl, where case means nothing', () => {
    // Ctrl-F and Ctrl-Shift-F are the same control code; tmux would read C-F
    // as a key nobody pressed.
    expect(keyOf(bytes('F'), armed({ ctrl: true }))).toBe('C-f');
  });

  it('keeps the case for alt, where it means something', () => {
    expect(keyOf(bytes('F'), armed({ alt: true }))).toBe('M-F');
    expect(keyOf(bytes('f'), armed({ alt: true }))).toBe('M-f');
  });

  it('carries both at once', () => {
    expect(keyOf(bytes('x'), armed({ ctrl: true, alt: true }))).toBe('C-M-x');
  });

  it('modifies a digit', () => {
    expect(keyOf(bytes('1'), armed({ alt: true }))).toBe('M-1');
  });

  it('names the space bar, which has no printable form', () => {
    expect(keyOf(bytes(' '), armed({ ctrl: true }))).toBe('C-Space');
  });

  it('names Return, so alt-Return is a newline and not a run', () => {
    // Measured on tmux 3.6: `send-keys M-Enter` comes out as ESC CR, which is
    // what Claude Code and readline read as a newline inside the line. Return
    // reaches this as CR because toShellInput has already made it one.
    const out = applyModifiers(bytes('\r'), armed({ alt: true }));
    expect(out).toMatchObject({ kind: 'key', key: 'M-Enter' });
    expect(out.rest).toHaveLength(0);
  });

  it('names the other keys the system keyboard has but cannot spell', () => {
    expect(keyOf(bytes('\t'), armed({ alt: true }))).toBe('M-Tab');
    expect(keyOf(new Uint8Array([0x7f]), armed({ alt: true }))).toBe('M-BSpace');
    expect(keyOf(new Uint8Array([0x08]), armed({ ctrl: true }))).toBe('C-BSpace');
  });

  it('sends a key it cannot name as ordinary typing', () => {
    // An emoji, a pasted accent, an arrow the Surface sent as bytes. There is
    // no honest `C-` name for any of them, and inventing one would send
    // something the user did not press.
    const out = applyModifiers(bytes('é'), armed({ ctrl: true }));
    expect(out.kind).toBe('typed');
    expect(text(out.rest)).toBe('é');
  });

  it('has nothing to say about nothing typed', () => {
    const out = applyModifiers(new Uint8Array(), armed({ ctrl: true }));
    expect(out.kind).toBe('typed');
    expect(out.rest).toHaveLength(0);
  });
});

describe('a Key Row symbol while a modifier is armed', () => {
  it('takes option, whatever the symbol', () => {
    expect(keyOf(bytes('-'), armed({ alt: true }))).toBe('M--');
    expect(keyOf(bytes('#'), armed({ alt: true }))).toBe('M-#');
  });

  it('takes ctrl where the symbol has a control code', () => {
    expect(keyOf(bytes('['), armed({ ctrl: true }))).toBe('C-[');
    expect(keyOf(bytes('_'), armed({ ctrl: true }))).toBe('C-_');
  });

  it('drops ctrl where it has none, and types the symbol', () => {
    // Measured on tmux 3.8: `C-:` reaches the Pane as `;` and `C-*` as the
    // three characters of its own name.
    const out = applyModifiers(bytes(':'), armed({ ctrl: true }));
    expect(out.kind).toBe('typed');
    expect(text(out.rest)).toBe(':');
    expect(keyOf(bytes('*'), armed({ ctrl: true, alt: true }))).toBe('M-*');
  });
});

describe('typing while command is armed', () => {
  it.each([
    ['c', 'copy'],
    ['v', 'paste'],
    ['k', 'clear'],
    ['K', 'clear'],
  ])('turns %s into the %s Shortcut', (letter, shortcut) => {
    const out = applyModifiers(bytes(letter), armed({ cmd: true }));
    expect(out).toMatchObject({ kind: 'shortcut', shortcut });
    expect(out.rest).toHaveLength(0);
  });

  it('is a Shortcut with ctrl and option armed too, and they go with it', () => {
    const all = armed({ cmd: true, ctrl: true, alt: true });
    const out = applyModifiers(bytes('c'), all);
    expect(out.kind).toBe('shortcut');
    expect(armedAfter(out, all)).toEqual(NO_MODIFIERS);
  });

  it('types any other key as if command were not armed', () => {
    const out = applyModifiers(bytes('x'), armed({ cmd: true }));
    expect(out.kind).toBe('typed');
    expect(text(out.rest)).toBe('x');
    expect(keyOf(bytes('x'), armed({ cmd: true, ctrl: true }))).toBe('C-x');
  });
});

describe('what stays armed after typing', () => {
  it('spends everything on a modified key', () => {
    const held = armed({ ctrl: true, cmd: true });
    expect(armedAfter(applyModifiers(bytes('x'), held), held)).toEqual(NO_MODIFIERS);
  });

  it('spends command on a key that is not a Shortcut', () => {
    const held = armed({ cmd: true });
    expect(armedAfter(applyModifiers(bytes('x'), held), held)).toEqual(NO_MODIFIERS);
  });

  it('keeps ctrl for the next key when this one has no ctrl form', () => {
    const held = armed({ ctrl: true, cmd: true });
    expect(armedAfter(applyModifiers(bytes('é'), held), held)).toEqual(armed({ ctrl: true }));
  });

  it('keeps everything when nothing was typed', () => {
    const held = armed({ cmd: true });
    expect(armedAfter(applyModifiers(new Uint8Array(), held), held)).toEqual(held);
  });
});
