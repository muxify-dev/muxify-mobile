import { panAxis, swipeOf } from './pan-axis';

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

describe('swipeOf', () => {
  it('names the way the finger moved', () => {
    expect(swipeOf(-40)).toBe('left');
    expect(swipeOf(120)).toBe('right');
  });

  it('is no swipe when the finger came back or did not go far', () => {
    expect(swipeOf(0)).toBeNull();
    expect(swipeOf(39)).toBeNull();
    expect(swipeOf(-39)).toBeNull();
  });
});
