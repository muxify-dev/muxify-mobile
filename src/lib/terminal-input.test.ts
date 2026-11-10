import { withoutTerminalReplies, toShellInput } from './terminal-input';

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


function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

describe('withoutTerminalReplies', () => {
  it.each([
    ['primary device attributes', '\x1b[?62;22;52c'],
    ['secondary device attributes', '\x1b[>1;10;0c'],
    ['ready status', '\x1b[0n'],
    ['failure status', '\x1b[3n'],
    ['cursor position', '\x1b[8;1R'],
    ['terminal version', '\x1bP>|ghostty 1.3.2-HEAD-+35e1a0160\x1b\\'],
    ['foreground colour', '\x1b]10;rgb:e6e6/e6e6/e6e6\x1b\\'],
    ['background colour', '\x1b]11;rgb:1111/1313/1a1a\x1b\\'],
    ['palette colour', '\x1b]4;1;rgb:cccc/6666/6666\x1b\\'],
    ['BEL-terminated colour', '\x1b]11;rgb:1111/1313/1a1a\x07'],
    ['synchronized output mode', '\x1b[?2026;2$y'],
    ['colour scheme mode', '\x1b[?2031;2$y'],
    ['kitty keyboard flags', '\x1b[?0u'],
    ['pixel size', '\x1b[4;1932;1178t'],
    ['cell size', '\x1b[8;28;38t'],
    ['SGR status', '\x1bP1$r0m\x1b\\'],
    ['terminal capability', '\x1bP1+r544E=787465726D2D67686F73747479\x1b\\'],
  ])('drops the %s reply captured from the Surface', (_name, reply) => {
    expect(withoutTerminalReplies(bytes(reply))).toEqual(bytes(''));
  });

  it('removes several replies among typed bytes in one callback', () => {
    expect(withoutTerminalReplies(bytes('ls\x1b[?62;22;52c -l\x1b]11;rgb:1111/1313/1a1a\x07\x1b[8;28;38t\r')))
      .toEqual(bytes('ls -l\r'));
  });

  it.each([
    ['Escape', '\x1b'],
    ['arrow keys', '\x1b[A\x1b[B\x1b[C\x1b[D'],
    ['modified arrow', '\x1b[1;5A'],
    ['F3', '\x1bOR'],
    ['Shift-F3', '\x1b[1;2R'],
    ['Alt-F3', '\x1b[1;3R'],
    ['Control-F3', '\x1b[1;5R'],
    ['all F3 modifiers', '\x1b[1;8R'],
    ['kitty key', '\x1b[97;5u'],
    ['focus events', '\x1b[I\x1b[O'],
    ['mouse input', '\x1b[<0;8;4M'],
    ['bracketed paste', '\x1b[200~é\n\x1b[201~'],
    ['control keys', '\x03\x09\x7f'],
    ['Unicode', 'é你好🙂'],
    ['incomplete CSI', '\x1b[?62;'],
    ['incomplete OSC', '\x1b]11;rgb:'],
    ['incomplete DCS', '\x1bP>|ghostty'],
    ['invalid CSI', '\x1b[12\x03;3R'],
  ])('preserves %s without waiting for another callback', (_name, input) => {
    expect(withoutTerminalReplies(bytes(input))).toEqual(bytes(input));
  });

  it('preserves split UTF-8 bytes', () => {
    expect(withoutTerminalReplies(new Uint8Array([0xc3]))).toEqual(new Uint8Array([0xc3]));
    expect(withoutTerminalReplies(new Uint8Array([0xa9]))).toEqual(new Uint8Array([0xa9]));
  });

  it('keeps shell input conversion after reply removal', () => {
    const input = bytes('\x1b[?62;22;52c\x1b[200~ls\n\x1b[201~');
    expect(toShellInput(withoutTerminalReplies(input))).toEqual(bytes('ls\r'));
  });
});
