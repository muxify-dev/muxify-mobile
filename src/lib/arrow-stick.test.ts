import { DEAD_ZONE, stickDirection } from './arrow-stick';

describe('stickDirection', () => {
  it('sends nothing for a touch that has not left the dead zone', () => {
    expect(stickDirection(0, 0)).toBeNull();
    expect(stickDirection(0, -(DEAD_ZONE - 1))).toBeNull();
    expect(stickDirection(8, 8)).toBeNull();
  });

  it('picks the arrow the finger has moved towards', () => {
    expect(stickDirection(0, -DEAD_ZONE)).toBe('up');
    expect(stickDirection(0, 30)).toBe('down');
    expect(stickDirection(-30, 0)).toBe('left');
    expect(stickDirection(DEAD_ZONE, 0)).toBe('right');
  });

  it('goes by the axis the finger moved further along', () => {
    expect(stickDirection(20, -12)).toBe('right');
    expect(stickDirection(-12, 20)).toBe('down');
    expect(stickDirection(-15, -16)).toBe('up');
  });
});
