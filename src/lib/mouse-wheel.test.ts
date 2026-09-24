import { cursorKeys, wheelSequence, LINES_PER_NOTCH } from './mouse-wheel';

const ESC = '\u001b';

describe('wheelSequence', () => {
  it('writes an SGR wheel-up event', () => {
    expect(wheelSequence('up', 1, 10, 20)).toBe(`${ESC}[<64;10;20M`);
  });

  it('writes an SGR wheel-down event', () => {
    expect(wheelSequence('down', 1, 10, 20)).toBe(`${ESC}[<65;10;20M`);
  });

  it('repeats the event once per notch', () => {
    expect(wheelSequence('up', 3, 1, 1)).toBe(`${ESC}[<64;1;1M`.repeat(3));
  });

  it('says nothing at all for no notches', () => {
    expect(wheelSequence('up', 0, 1, 1)).toBe('');
    expect(wheelSequence('up', -2, 1, 1)).toBe('');
  });

  it('never points at row or column zero', () => {
    // tmux discards an event whose coordinates fall outside the Pane, and zero
    // is outside: the grid is 1-based.
    expect(wheelSequence('up', 1, 0, 0)).toBe(`${ESC}[<64;1;1M`);
    expect(wheelSequence('up', 1, -5, -5)).toBe(`${ESC}[<64;1;1M`);
  });

  it('rounds a fractional notch count down rather than writing a broken one', () => {
    expect(wheelSequence('up', 2.9, 1, 1)).toBe(`${ESC}[<64;1;1M`.repeat(2));
  });

  it('agrees with what tmux moves for one notch', () => {
    // tmux's copy-mode binding is `send-keys -X -N 5 scroll-up`; if these ever
    // part company the history travels at the wrong speed for the finger.
    expect(LINES_PER_NOTCH).toBe(5);
  });
});

describe('cursorKeys', () => {
  it('sends one key per line, up or down', () => {
    expect(cursorKeys('up', 3)).toBe(`${ESC}[A`.repeat(3));
    expect(cursorKeys('down', 2)).toBe(`${ESC}[B`.repeat(2));
  });

  it('says nothing at all for no lines', () => {
    expect(cursorKeys('up', 0)).toBe('');
    expect(cursorKeys('down', -4)).toBe('');
  });

  it('uses the plain form, not the application-cursor one', () => {
    // Guessing DECCKM wrong puts letters in the buffer instead of moving.
    expect(cursorKeys('up', 1)).not.toContain('O');
  });
});
