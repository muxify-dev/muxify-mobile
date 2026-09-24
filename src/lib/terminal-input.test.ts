import { toShellInput } from './terminal-input';

const PASTE_START = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];
const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];

function shell(...bytes: number[]): number[] {
  return [...toShellInput(new Uint8Array(bytes))];
}

describe('toShellInput', () => {
  it('passes an ordinary character through untouched', () => {
    expect(shell(0x6c)).toEqual([0x6c]);
  });

  it('drops a paste start marker arriving on its own', () => {
    // The Surface sends one per keystroke, each in its own event.
    expect(shell(...PASTE_START)).toEqual([]);
  });

  it('drops a paste end marker arriving on its own', () => {
    expect(shell(...PASTE_END)).toEqual([]);
  });

  it('unwraps a character the Surface wrapped as a paste', () => {
    expect(shell(...PASTE_START, 0x6c, 0x73, ...PASTE_END)).toEqual([0x6c, 0x73]);
  });

  it('turns Enter into a carriage return, so the shell runs the line', () => {
    // What the Surface actually emits for the return key: a paste of LF.
    // Left alone, the shell inserts a newline and runs nothing.
    expect(shell(...PASTE_START, 0x0a, ...PASTE_END)).toEqual([0x0d]);
  });

  it('turns a bare newline into a carriage return too', () => {
    expect(shell(0x0a)).toEqual([0x0d]);
  });

  it('leaves a carriage return alone', () => {
    expect(shell(0x0d)).toEqual([0x0d]);
  });

  it('runs every line of a multi-line paste', () => {
    expect(shell(...PASTE_START, 0x61, 0x0a, 0x62, ...PASTE_END)).toEqual([0x61, 0x0d, 0x62]);
  });

  it('leaves other escape sequences alone', () => {
    // Arrow up: ESC [ A. Nothing here may touch key sequences.
    expect(shell(0x1b, 0x5b, 0x41)).toEqual([0x1b, 0x5b, 0x41]);
  });

  it('leaves a sequence that only looks like the start of a marker', () => {
    expect(shell(0x1b, 0x5b, 0x32, 0x30, 0x30)).toEqual([0x1b, 0x5b, 0x32, 0x30, 0x30]);
  });

  it('leaves ctrl-c alone, which is the one key that must always get through', () => {
    expect(shell(0x03)).toEqual([0x03]);
  });

  it('passes multi-byte characters through byte for byte', () => {
    // é as UTF-8; splitting or rewriting these would corrupt the input.
    expect(shell(...PASTE_START, 0xc3, 0xa9, ...PASTE_END)).toEqual([0xc3, 0xa9]);
  });

  it('is empty for empty input', () => {
    expect(shell()).toEqual([]);
  });
});
