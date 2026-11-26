import {
  AUTOSCROLL_EDGE, AUTOSCROLL_MAX, autoScrollSpeed, GRIP_BAND, gripCentre, gripShown, GRIP_SLOP, liftGrip, moveGrip, type DrawerFrame, type GripTouch,
} from './grip';

const from = { x: 380, y: 400 };

describe('moveGrip', () => {
  it('keeps a finger that drifts inside the slop a hold', () => {
    expect(moveGrip({ phase: 'waiting', from }, { x: 380 - GRIP_SLOP, y: 400 })).toEqual({ phase: 'waiting', from });
  });

  it('makes a finger that moves past the slop first a drag, which stays one', () => {
    const dragging = moveGrip({ phase: 'waiting', from }, { x: 340, y: 400 });
    expect(dragging).toEqual({ phase: 'dragging', from });
    expect(moveGrip(dragging, from)).toBe(dragging);
  });

  it('leaves a held finger to the drawer', () => {
    const held: GripTouch = { phase: 'held', at: from };
    expect(moveGrip(held, { x: 100, y: 100 })).toBe(held);
  });
});

describe('liftGrip', () => {
  const drawer: DrawerFrame = { left: 60, right: 402, top: 100, bottom: 700, lane: 44 };
  const rowAt = ({ y }: { y: number }) => (y >= 200 && y < 244 ? 'window:gs-client:@7' : null);

  it('picks the row the finger slid onto', () => {
    expect(liftGrip({ x: 200, y: 220 }, drawer, rowAt)).toEqual({ kind: 'pick', key: 'window:gs-client:@7' });
  });

  it('closes the drawer when the finger lifts on the Grip, where it opened', () => {
    expect(liftGrip({ x: 395, y: 660 }, drawer, rowAt)).toEqual({ kind: 'close' });
  });

  it('closes the drawer with no pick when the finger lifts in the Lift Lane, beside a row', () => {
    expect(liftGrip({ x: 402 - 44 / 2, y: 220 }, drawer, () => 'window:gs-client:@7')).toEqual({ kind: 'close' });
  });

  it('closes the drawer when the finger lifts in the Cancel Zone', () => {
    expect(liftGrip({ x: 30, y: 220 }, drawer, rowAt)).toEqual({ kind: 'close' });
    expect(liftGrip({ x: 200, y: 760 }, drawer, rowAt)).toEqual({ kind: 'close' });
  });

  it('closes the drawer when the finger lifts in the panel on no row', () => {
    expect(liftGrip({ x: 200, y: 500 }, drawer, rowAt)).toEqual({ kind: 'close' });
  });
});

describe('autoScrollSpeed', () => {
  const drawer: DrawerFrame = { left: 60, right: 402, top: 100, bottom: 700, lane: 44 };
  const list = { top: 150, bottom: 680 };
  const at = (y: number) => autoScrollSpeed({ x: 200, y }, drawer, list);

  it('does not scroll in the middle of the list', () => {
    expect(at(400)).toBe(0);
    expect(at(list.top + AUTOSCROLL_EDGE)).toBe(0);
    expect(at(list.bottom - AUTOSCROLL_EDGE)).toBe(0);
  });

  it('scrolls up near the top, faster as the finger goes nearer the edge', () => {
    expect(at(list.top + AUTOSCROLL_EDGE / 2)).toBe(-AUTOSCROLL_MAX / 2);
    expect(at(list.top)).toBe(-AUTOSCROLL_MAX);
  });

  it('scrolls up at the fastest over the header, above the list', () => {
    expect(at(120)).toBe(-AUTOSCROLL_MAX);
  });

  it('scrolls down near the bottom', () => {
    expect(at(list.bottom - AUTOSCROLL_EDGE / 2)).toBe(AUTOSCROLL_MAX / 2);
    expect(at(list.bottom + 10)).toBe(AUTOSCROLL_MAX);
  });

  it('does not scroll in the Cancel zone, where a lift closes the drawer', () => {
    expect(autoScrollSpeed({ x: 30, y: list.bottom }, drawer, list)).toBe(0);
    expect(at(drawer.bottom + 10)).toBe(0);
    expect(at(drawer.top - 10)).toBe(0);
  });
});

describe('gripCentre', () => {
  it('puts the Grip in the middle of a phone, the same with the keyboard up or down', () => {
    expect(gripCentre({ top: 100, bottom: 800 }, 874, false)).toBe(874 * 0.5);
    expect(gripCentre({ top: 100, bottom: 500 }, 874, false)).toBe(874 * 0.5);
  });

  it('puts the Grip three quarters down an iPad, inside an area that ends above that', () => {
    expect(gripCentre({ top: 70, bottom: 1300 }, 1366, true)).toBe(1366 * 0.75);
    expect(gripCentre({ top: 70, bottom: 700 }, 1366, true)).toBe(700 - GRIP_BAND.height / 2);
  });
});

describe('gripShown', () => {
  it('shows the Grip on a phone held upright, and not on its side', () => {
    expect(gripShown({ width: 402, height: 874 })).toBe(true);
    expect(gripShown({ width: 874, height: 402 })).toBe(false);
  });

  it('shows the Grip on an iPad either way', () => {
    expect(gripShown({ width: 834, height: 1194 })).toBe(true);
    expect(gripShown({ width: 1194, height: 834 })).toBe(true);
  });
});
