import { followOffset, isPastCommit, panAxis, swipeOf } from './pan-axis';

describe('panAxis', () => {
  it('reads a sideways drag as horizontal', () => {
    expect(panAxis(12, 2)).toBe('horizontal');
    expect(panAxis(-12, -2)).toBe('horizontal');
  });

  it('reads a drag up or down as vertical', () => {
    expect(panAxis(0, 11)).toBe('vertical');
    expect(panAxis(2, -12)).toBe('vertical');
  });

  it('keeps a diagonal drag a scroll', () => {
    expect(panAxis(10, 10)).toBe('vertical');
    expect(panAxis(12, 8)).toBe('vertical');
    expect(panAxis(12.1, 8)).toBe('horizontal');
  });
});

/** An iPhone 17's Surface: the commit point is at 98.25 points. */
const WIDTH = 393;

describe('swipeOf', () => {
  it('names the way the finger moved, a quarter of the width or more', () => {
    expect(swipeOf(-99, WIDTH, 0)).toBe('left');
    expect(swipeOf(200, WIDTH, 0)).toBe('right');
  });

  it('is no swipe when a slow finger did not go that far', () => {
    expect(swipeOf(0, WIDTH, 0)).toBeNull();
    expect(swipeOf(98, WIDTH, 0)).toBeNull();
    expect(swipeOf(-98, WIDTH, 300)).toBeNull();
  });

  it('takes a short flick the way the drag went', () => {
    expect(swipeOf(-30, WIDTH, -601)).toBe('left');
    expect(swipeOf(30, WIDTH, 900)).toBe('right');
    expect(swipeOf(30, WIDTH, 600)).toBeNull();
  });

  it('does not take a flick back towards where the drag began', () => {
    expect(swipeOf(-30, WIDTH, 900)).toBeNull();
    expect(swipeOf(30, WIDTH, -900)).toBeNull();
  });

  it('measures the commit point against the width it is given', () => {
    expect(swipeOf(60, 200, 0)).toBe('right');
    expect(swipeOf(60, 0, 0)).toBeNull();
  });
});

describe('isPastCommit', () => {
  it('is true from a quarter of the width, either way', () => {
    expect(isPastCommit(98, WIDTH)).toBe(false);
    expect(isPastCommit(99, WIDTH)).toBe(true);
    expect(isPastCommit(-99, WIDTH)).toBe(true);
  });
});

describe('followOffset', () => {
  it('keeps the Pane under the finger up to the commit point', () => {
    expect(followOffset(40, 400)).toBe(40);
    expect(followOffset(-100, 400)).toBe(-100);
  });

  it('follows more slowly past it', () => {
    expect(followOffset(200, 400)).toBeCloseTo(130);
    expect(followOffset(-200, 400)).toBeCloseTo(-130);
  });
});
