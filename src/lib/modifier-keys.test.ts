import { applyModifiers, modifierPrefix, NO_MODIFIERS } from './modifier-keys';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('what the armed modifiers are called', () => {
  it('names them the way tmux does', () => {
    expect(modifierPrefix({ ctrl: true, alt: false })).toBe('C-');
    expect(modifierPrefix({ ctrl: false, alt: true })).toBe('M-');
    expect(modifierPrefix({ ctrl: true, alt: true })).toBe('C-M-');
    expect(modifierPrefix(NO_MODIFIERS)).toBe('');
  });
});

describe('typing while a modifier is armed', () => {
  it('leaves ordinary typing alone', () => {
    const out = applyModifiers(bytes('hello'), NO_MODIFIERS);
    expect(out.key).toBeUndefined();
    expect(text(out.rest)).toBe('hello');
  });

  it('turns the next letter into a modified key', () => {
    const out = applyModifiers(bytes('f'), { ctrl: true, alt: false });
    expect(out.key).toBe('C-f');
    expect(out.rest).toHaveLength(0);
  });

  it('modifies only the first key of a burst', () => {
    // The Surface batches, so a fast typist's ctrl-r can arrive with the
    // search term already behind it. Only the key the modifier was armed for
    // is modified; the rest is ordinary typing.
    const out = applyModifiers(bytes('rgrep'), { ctrl: true, alt: false });
    expect(out.key).toBe('C-r');
    expect(text(out.rest)).toBe('grep');
  });

  it('folds a capital letter for ctrl, where case means nothing', () => {
    // Ctrl-F and Ctrl-Shift-F are the same control code; tmux would read C-F
    // as a key nobody pressed.
    expect(applyModifiers(bytes('F'), { ctrl: true, alt: false }).key).toBe('C-f');
  });

  it('keeps the case for alt, where it means something', () => {
    expect(applyModifiers(bytes('F'), { ctrl: false, alt: true }).key).toBe('M-F');
    expect(applyModifiers(bytes('f'), { ctrl: false, alt: true }).key).toBe('M-f');
  });

  it('carries both at once', () => {
    expect(applyModifiers(bytes('x'), { ctrl: true, alt: true }).key).toBe('C-M-x');
  });

  it('modifies a digit', () => {
    expect(applyModifiers(bytes('1'), { ctrl: false, alt: true }).key).toBe('M-1');
  });

  it('names the space bar, which has no printable form', () => {
    expect(applyModifiers(bytes(' '), { ctrl: true, alt: false }).key).toBe('C-Space');
  });

  it('sends a key it cannot name as ordinary typing', () => {
    // An emoji, a pasted accent, an arrow the Surface sent as bytes. There is
    // no honest `C-` name for any of them, and inventing one would send
    // something the user did not press.
    const out = applyModifiers(bytes('é'), { ctrl: true, alt: false });
    expect(out.key).toBeUndefined();
    expect(text(out.rest)).toBe('é');
  });

  it('has nothing to say about nothing typed', () => {
    const out = applyModifiers(new Uint8Array(), { ctrl: true, alt: false });
    expect(out.key).toBeUndefined();
    expect(out.rest).toHaveLength(0);
  });
});
