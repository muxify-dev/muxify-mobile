import { clampBack, paintScreen, scrollbackRange } from './pane-screen';

const line = (text: string) => new TextEncoder().encode(text);
/** The painted bytes as something a test can read, ESC written as `<ESC>`. */
const shown = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte))
    .join('')
    .replace(//g, '<ESC>');

describe('painting a Pane onto the Surface', () => {
  it('clears what was there and writes the capture from the top', () => {
    const painted = shown(
      paintScreen({ lines: [line('first'), line('second')], alternate: false }),
    );
    expect(painted).toContain('<ESC>[H<ESC>[2J');
    expect(painted).toContain('first\r\nsecond');
  });

  it('puts no newline after the last line, which would scroll the screen', () => {
    const painted = shown(paintScreen({ lines: [line('a'), line('b')], alternate: false }));
    expect(painted).not.toContain('b\r\n');
  });

  it('hides the cursor while it paints', () => {
    const painted = shown(paintScreen({ lines: [line('x')], alternate: false }));
    expect(painted.indexOf('<ESC>[?25l')).toBeLessThan(painted.indexOf('<ESC>[2J'));
  });

  it('puts the cursor back where tmux says it is, counting from one', () => {
    const painted = shown(
      paintScreen({ lines: [line('x')], cursor: { column: 43, row: 2 }, alternate: false }),
    );
    expect(painted).toContain('<ESC>[3;44H');
    expect(painted).toContain('<ESC>[?25h');
  });

  it('puts an unseen cursor where tmux says it is, without showing it', () => {
    // The Pane a split is not typing into draws no cursor, but it still has
    // one, and output arriving in it moves it. Leaving it where the repaint
    // happened to end means the Pane that is tapped next shows its cursor in
    // the wrong place — the bottom-left corner, where the last blank row was
    // painted.
    const painted = shown(
      paintScreen({
        lines: [line('x')],
        cursor: { column: 43, row: 2 },
        cursorVisible: false,
        alternate: false,
      }),
    );
    expect(painted).toContain('<ESC>[3;44H');
    expect(painted).not.toContain('<ESC>[?25h');
  });

  it('leaves the cursor hidden when there is none to show', () => {
    // A view of the Scrollback has no cursor in it, and one parked in the
    // middle of old output reads as a prompt that is not there.
    const painted = shown(paintScreen({ lines: [line('old')], alternate: false }));
    expect(painted).not.toContain('<ESC>[?25h');
  });

  it('follows the Pane onto the alternate screen, and off it again', () => {
    expect(shown(paintScreen({ lines: [line('vim')], alternate: true }))).toContain(
      '<ESC>[?1049h',
    );
    expect(shown(paintScreen({ lines: [line('zsh')], alternate: false }))).toContain(
      '<ESC>[?1049l',
    );
  });

  it('resets attributes before painting, and after', () => {
    const painted = shown(paintScreen({ lines: [line('x')], alternate: false }));
    expect(painted.match(/<ESC>\[0m/g)).toHaveLength(2);
  });

  it('keeps the capture’s own escape sequences exactly', () => {
    // `capture-pane -e` carries the Pane's colours, and re-encoding them
    // through a string would be the one way to lose them.
    const coloured = Uint8Array.of(0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xff, 0x41);
    const painted = paintScreen({ lines: [coloured], alternate: false });
    expect(indexOfBytes(painted, coloured)).toBeGreaterThan(-1);
  });

  it('paints an empty Pane without falling over', () => {
    expect(shown(paintScreen({ lines: [], alternate: false }))).toContain('<ESC>[2J');
  });
});

describe('how far back a drag may go', () => {
  it('stops at the live bottom', () => {
    expect(clampBack(-4, 100)).toBe(0);
  });

  it('stops where tmux ran out of Scrollback', () => {
    expect(clampBack(500, 120)).toBe(120);
  });

  it('has nowhere to go in a Pane with no Scrollback', () => {
    expect(clampBack(10, 0)).toBe(0);
  });
});

describe('which lines to ask tmux for', () => {
  it('asks for the screen itself when nothing is scrolled', () => {
    expect(scrollbackRange(0, 24)).toEqual({ start: 0, end: 23 });
  });

  it('shifts the whole window up by how far back it is', () => {
    expect(scrollbackRange(30, 24)).toEqual({ start: -30, end: -7 });
  });

  it('keeps the Surface as full as it is when live', () => {
    const { start, end } = scrollbackRange(7, 40);
    expect(end - start + 1).toBe(40);
  });
});

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[at + offset] !== needle[offset]) continue outer;
    }
    return at;
  }
  return -1;
}
