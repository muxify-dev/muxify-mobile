import { commandChord, NO_MODIFIERS, typedKeys, type Modifiers } from './modifier-keys';

const bytes = (text: string) => new TextEncoder().encode(text);
const armed = (over: Partial<Modifiers>): Modifiers => ({ ...NO_MODIFIERS, ...over });

describe('the keys the system keyboard typed', () => {
  it('gives a character as its own key', () => {
    expect(typedKeys(bytes('f'))).toEqual(['f']);
    expect(typedKeys(bytes('F'))).toEqual(['F']);
    expect(typedKeys(bytes(' '))).toEqual([' ']);
    expect(typedKeys(bytes('é'))).toEqual(['é']);
    expect(typedKeys(bytes('🙂'))).toEqual(['🙂']);
  });

  it('names the keys that are not characters', () => {
    // Return reaches this as CR because toShellInput has already made it one.
    expect(typedKeys(bytes('\r'))).toEqual(['Enter']);
    expect(typedKeys(bytes('\t'))).toEqual(['Tab']);
    expect(typedKeys(new Uint8Array([0x7f]))).toEqual(['Backspace']);
    expect(typedKeys(new Uint8Array([0x08]))).toEqual(['Backspace']);
  });

  it('gives every key of a swiped word, in order', () => {
    expect(typedKeys(bytes('grep '))).toEqual(['g', 'r', 'e', 'p', ' ']);
  });

  it('is nothing for what the Surface wrote by itself', () => {
    // An arrow or a focus report is not typing, and a modifier must not go
    // with its first byte.
    expect(typedKeys(bytes('\x1b[A'))).toBeUndefined();
    expect(typedKeys(bytes('\x1b[I'))).toBeUndefined();
    expect(typedKeys(new Uint8Array())).toBeUndefined();
  });

  it('is nothing for a character cut in two', () => {
    expect(typedKeys(bytes('é').subarray(0, 1))).toBeUndefined();
  });
});

describe('the chord a key makes with command armed', () => {
  it('is the key as a hardware keyboard has it', () => {
    expect(commandChord('d', armed({ cmd: true }))).toEqual({ key: 'd', shift: false, option: false, control: false });
    expect(commandChord(',', armed({ cmd: true }))).toEqual({ key: ',', shift: false, option: false, control: false });
  });

  it('holds shift for a capital letter, as the software keyboard types one', () => {
    expect(commandChord('D', armed({ cmd: true }))).toEqual({ key: 'd', shift: true, option: false, control: false });
  });

  it('holds an armed ctrl and option', () => {
    expect(commandChord('h', armed({ cmd: true, alt: true, ctrl: true })))
      .toEqual({ key: 'h', shift: false, option: true, control: true });
  });

  it('names a key that types no character as UIKit does', () => {
    expect(commandChord('Left', armed({ cmd: true }))?.key).toBe('UIKeyInputLeftArrow');
    expect(commandChord('Escape', armed({ cmd: true }))?.key).toBe('UIKeyInputEscape');
    expect(commandChord('Backspace', armed({ cmd: true }))?.key).toBe('\b');
  });
});

describe('a key without command', () => {
  it('makes no chord', () => {
    for (const held of [NO_MODIFIERS, armed({ ctrl: true }), armed({ alt: true }), armed({ ctrl: true, alt: true })]) {
      for (const key of ['c', 'v', 'k', 'd', ',']) expect(commandChord(key, held)).toBeUndefined();
    }
  });
});
