import { NO_MODIFIERS, phoneCommand, typedKeys, type Modifiers } from './modifier-keys';
import { chordsInForce } from '@/keyboard/keyboard-shortcuts';

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

describe('a key while command is armed', () => {
  it.each([
    ['c', 'copy'],
    ['v', 'paste'],
    ['k', 'clear'],
  ])('makes %s the %s Shortcut', (letter, shortcut) => {
    expect(phoneCommand(letter, armed({ cmd: true }))).toEqual({ kind: 'shortcut', shortcut });
  });

  it('is a Shortcut with ctrl and option armed too', () => {
    expect(phoneCommand('c', armed({ cmd: true, ctrl: true, alt: true }))).toEqual({ kind: 'shortcut', shortcut: 'copy' });
  });

  it.each([
    [',', 'open-settings'],
    ['d', 'split-right'],
    ['D', 'split-down'],
    ['K', 'pane-up'],
  ])('makes %s a Keyboard Shortcut, as a hardware keyboard would', (key, action) => {
    expect(phoneCommand(key, armed({ cmd: true }))).toEqual({ kind: 'keyboard-shortcut', action });
  });

  it('runs the key the user gave a Keyboard Shortcut, and not its default', () => {
    const chords = chordsInForce({ 'pane-left': { key: 'h', shift: false, option: true, control: false } });
    expect(phoneCommand('h', armed({ cmd: true, alt: true }), chords))
      .toEqual({ kind: 'keyboard-shortcut', action: 'pane-left' });
    expect(phoneCommand('H', armed({ cmd: true }), chords)).toBeUndefined();
  });

  it('runs a Keyboard Shortcut that the user gave an arrow', () => {
    const chords = chordsInForce({ 'pane-left': { key: 'UIKeyInputLeftArrow', shift: false, option: false, control: false } });
    expect(phoneCommand('Left', armed({ cmd: true }), chords))
      .toEqual({ kind: 'keyboard-shortcut', action: 'pane-left' });
  });

  it('leaves every other key to the Pane', () => {
    // ghostty has these: command and delete removes the line, and command
    // and an arrow goes to the start or the end of it.
    for (const key of ['x', 'Backspace', 'Left', 'Right', 'Up', 'Enter']) {
      expect(phoneCommand(key, armed({ cmd: true }))).toBeUndefined();
    }
  });
});

describe('a key without command', () => {
  it('is never the phone\'s own', () => {
    for (const held of [NO_MODIFIERS, armed({ ctrl: true }), armed({ alt: true }), armed({ ctrl: true, alt: true })]) {
      for (const key of ['c', 'v', 'k', 'd', ',']) expect(phoneCommand(key, held)).toBeUndefined();
    }
  });
});
