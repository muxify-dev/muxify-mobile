import {
  AUTOSCROLL_EDGE, AUTOSCROLL_MAX, autoScrollSpeed, DRAWER_ROW_REACH, drawerBottom, endGrip, FAN_DEAD_RADIUS, FAN_RADIUS, FAN_SLOT_SIZE, fanSlotCentre, GRIP_BUTTON, gripCentre, GRIP_HOLD_MS,
  backToFan, gripShown, GRIP_SLOP, holdGrip, inCancelZone, liftGrip, lightsSlot, moveGrip, returnToFan, slotAt, type ActionSlot, type DrawerFrame, type FanSlot, type GripTouch, type Point,
} from './grip';

const from = { x: 380, y: 400 };
/** The Grip's centre: the button's centre, 22 from the right edge of a 402-wide phone. */
const centre = { x: 380, y: 437 };
/** The finger `distance` from the centre, `degrees` from the right, counted up: 90 is straight up and 180 straight left. */
const finger = (degrees: number, distance: number): Point => ({
  x: centre.x + distance * Math.cos((degrees * Math.PI) / 180),
  y: centre.y - distance * Math.sin((degrees * Math.PI) / 180),
});
const fan = (lit: ActionSlot | null = null, returned = false): GripTouch => ({ phase: 'fan', centre, lit, returned });
const held = (at: Point): GripTouch => ({ phase: 'held', at, centre });

describe('holding the Grip', () => {
  it('waits 250 ms, so a hold is shorter than the Selection long press', () => {
    expect(GRIP_HOLD_MS).toBe(250);
  });

  it('opens the Fan round the button when the hold ends with the finger still', () => {
    expect(holdGrip({ phase: 'waiting', from }, centre)).toEqual(fan());
  });

  it('leaves a drag a drag: the Fan never opens under a finger that moved first', () => {
    const dragging: GripTouch = { phase: 'dragging', from };
    expect(holdGrip(dragging, centre)).toBe(dragging);
  });
});

describe('moveGrip before the hold ends', () => {
  it('keeps a finger that drifts inside the slop a hold', () => {
    expect(moveGrip({ phase: 'waiting', from }, { x: 380 - GRIP_SLOP, y: 400 })).toEqual({ phase: 'waiting', from });
  });

  it('makes a finger that moves past the slop first a drag, which stays one', () => {
    const dragging = moveGrip({ phase: 'waiting', from }, { x: 340, y: 400 });
    expect(dragging).toEqual({ phase: 'dragging', from });
    expect(moveGrip(dragging, from)).toBe(dragging);
  });
});

describe('slotAt', () => {
  const slot = (degrees: number, distance = 70) => slotAt(centre, finger(degrees, distance));

  it('picks the slot by direction, so the finger needs no aim', () => {
    expect([90, 120, 150, 180].map((degrees) => slot(degrees))).toEqual([0, 1, 2, 3]);
    expect([90, 120, 150, 180].map((degrees) => slot(degrees, 160))).toEqual([0, 1, 2, 3]);
  });

  it('puts the slot at 12, 11, 10 and 9 o\'clock, 100 points from the centre', () => {
    const slots = ([0, 1, 2, 3] as FanSlot[]).map((each) => fanSlotCentre(centre, each));
    for (const [at, degrees] of slots.map((point, index) => [point, 90 + 30 * index] as const)) {
      expect(at.x).toBeCloseTo(finger(degrees, FAN_RADIUS).x);
      expect(at.y).toBeCloseTo(finger(degrees, FAN_RADIUS).y);
    }
    expect(slots[0].y).toBeCloseTo(centre.y - 100);
    expect(slots[3].x).toBeCloseTo(centre.x - 100);
  });

  it('lights the nearest slot between two', () => {
    expect(slot(104)).toBe(0);
    expect(slot(106)).toBe(1);
    expect(slot(134)).toBe(1);
    expect(slot(136)).toBe(2);
  });

  it('lights nothing within 44 points of the centre, where the finger is still on the button', () => {
    expect(slot(90, FAN_DEAD_RADIUS)).toBeNull();
    expect(slot(150, 10)).toBeNull();
    expect(slot(90, FAN_DEAD_RADIUS + 1)).toBe(0);
  });

  it('keeps a finger a little off the quarter on its end slots, and lights nothing past half a step', () => {
    expect(slot(76)).toBe(0);
    expect(slot(74)).toBeNull();
    expect(slot(0)).toBeNull();
    expect(slot(194)).toBe(3);
    expect(slot(196)).toBeNull();
    expect(slot(270)).toBeNull();
  });
});

describe('moveGrip in the Fan', () => {
  it('lights the Grip action the finger points at, and keeps the touch it has when the slot stays', () => {
    const lit = moveGrip(fan(), finger(150, 90));
    expect(lit).toEqual(fan(2));
    expect(moveGrip(lit, finger(152, 95))).toBe(lit);
  });

  it('lights nothing when the finger goes back to the centre', () => {
    expect(moveGrip(fan(3), finger(180, 20))).toEqual(fan(null));
  });

  it('hands the finger to the Edge Drawer at the point where it lit Destinations', () => {
    const lit = finger(92, 60);
    expect(moveGrip(fan(), lit)).toEqual(held(lit));
    expect(moveGrip(fan(2), lit)).toEqual(held(lit));
  });

  it('leaves the drawer to the drawer while it is open: a move there lights no slot', () => {
    const open = held(finger(90, 60));
    expect(moveGrip(open, finger(180, 90))).toBe(open);
  });

  it('opens the Fan again with nothing lit when the finger comes back from the drawer', () => {
    expect(returnToFan(held(finger(90, 60)))).toEqual(fan(null, true));
  });

  it('does not open the drawer again for a finger still on its way down from it', () => {
    const back = fan(null, true);
    expect(moveGrip(back, finger(90, 50))).toBe(back);
  });

  it('lights a Grip action at once for a finger that came back from the drawer', () => {
    expect(moveGrip(fan(null, true), finger(150, 90))).toEqual(fan(2));
  });

  it('opens the drawer again once the finger came back to the centre or pointed elsewhere first', () => {
    const centred = moveGrip(fan(null, true), finger(90, 20));
    expect(centred).toEqual(fan());
    expect(moveGrip(centred, finger(90, 60))).toEqual(held(finger(90, 60)));
    expect(moveGrip(moveGrip(fan(null, true), finger(180, 90)), finger(90, 60))).toEqual(held(finger(90, 60)));
  });

  it('ends the panel just below the point where the finger lit Destinations, as the last row is level with it', () => {
    const lit = moveGrip(fan(), finger(90, 52));
    if (lit.phase !== 'held') throw new Error('the finger did not reach the drawer');
    expect(drawerBottom(lit.at.y, 832)).toBe(centre.y - 52 + DRAWER_ROW_REACH);
  });
});

describe('lightsSlot', () => {
  it('ticks for each slot the finger moves onto, and not for the same one or for none', () => {
    expect(lightsSlot(fan(), fan(1))).toBe(true);
    expect(lightsSlot(fan(1), fan(2))).toBe(true);
    expect(lightsSlot(fan(1), fan(1))).toBe(false);
    expect(lightsSlot(fan(1), fan(null))).toBe(false);
  });

  it('ticks when Destinations lights, which opens the drawer', () => {
    expect(lightsSlot(fan(2), held(finger(90, 60)))).toBe(true);
  });

  it('does not tick for a move outside the Fan', () => {
    expect(lightsSlot({ phase: 'waiting', from }, { phase: 'dragging', from })).toBe(false);
    expect(lightsSlot(held(from), held(from))).toBe(false);
  });
});

describe('endGrip', () => {
  const canRun = (slot: ActionSlot) => slot !== 2;

  it('runs the Grip action that the lift is on', () => {
    expect(endGrip(fan(1), true, canRun)).toEqual({ kind: 'run', slot: 1 });
    expect(endGrip(fan(3), true, canRun)).toEqual({ kind: 'run', slot: 3 });
  });

  it('runs nothing for a lift in the dead centre, where no slot is lit', () => {
    expect(endGrip(fan(null), true, canRun)).toEqual({ kind: 'nothing' });
  });

  it('runs nothing for a lift on a dimmed slot', () => {
    expect(endGrip(fan(2), true, canRun)).toEqual({ kind: 'nothing' });
  });

  it('runs nothing for a touch the system took', () => {
    expect(endGrip(fan(1), false, canRun)).toEqual({ kind: 'nothing' });
  });

  it('does nothing for a tap, which ends before the hold', () => {
    expect(endGrip({ phase: 'waiting', from }, true, canRun)).toEqual({ kind: 'nothing' });
  });

  it('gives a drag to the screen, and an open drawer to its own lift', () => {
    expect(endGrip({ phase: 'dragging', from }, true, canRun)).toEqual({ kind: 'drag', from });
    expect(endGrip(held(from), true, canRun)).toEqual({ kind: 'held', at: from });
  });
});

describe('liftGrip', () => {
  const drawer: DrawerFrame = { left: 60, right: 402, top: 100, bottom: 700, lane: 44 };
  const rowAt = ({ y }: { y: number }) => (y >= 200 && y < 244 ? 'window:gs-client:@7' : null);

  it('picks the row the finger slid onto', () => {
    expect(liftGrip({ x: 200, y: 220 }, drawer, rowAt)).toEqual({ kind: 'pick', key: 'window:gs-client:@7' });
  });

  it('closes the drawer when the finger lifts where it lit Destinations, in the Lift Lane', () => {
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

describe('backToFan', () => {
  const drawer: DrawerFrame = { left: 60, right: 402, top: 100, bottom: 700, lane: 44 };
  const lit = { x: 380, y: 666 };

  it('gives the finger back to the Fan when it goes down past the panel', () => {
    expect(backToFan({ x: 380, y: 701 }, lit, drawer)).toBe(true);
    expect(backToFan({ x: 30, y: 760 }, lit, drawer)).toBe(true);
  });

  it('keeps the finger in the drawer on the panel and beside it', () => {
    expect(backToFan({ x: 380, y: 690 }, lit, drawer)).toBe(false);
    expect(backToFan({ x: 30, y: 400 }, lit, drawer)).toBe(false);
  });

  it('keeps the finger in the drawer until it is a row below where it lit Destinations, on a panel the keyboard holds up', () => {
    const raised = { ...drawer, bottom: 640 };
    expect(backToFan({ x: 380, y: 680 }, lit, raised)).toBe(false);
    expect(backToFan({ x: 380, y: lit.y + DRAWER_ROW_REACH + 1 }, lit, raised)).toBe(true);
  });

  it('leaves the area below the panel out of the Cancel Zone, as the finger goes back to the Fan there', () => {
    expect(inCancelZone({ x: 30, y: 400 }, drawer)).toBe(true);
    expect(inCancelZone({ x: 200, y: 760 }, drawer)).toBe(false);
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
    expect(gripCentre({ top: 70, bottom: 700 }, 1366, true)).toBe(700 - GRIP_BUTTON.target / 2);
  });

  it('keeps the highest slot of the Fan inside an area that starts below the Header', () => {
    expect(gripCentre({ top: 400, bottom: 800 }, 874, false)).toBe(400 + FAN_RADIUS + FAN_SLOT_SIZE / 2);
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

describe('drawerBottom', () => {
  it('ends the panel just below the finger, so the last row is level with it', () => {
    expect(drawerBottom(437, 832)).toBe(437 + DRAWER_ROW_REACH);
  });

  it('keeps the panel above the keyboard or the home indicator', () => {
    expect(drawerBottom(820, 832)).toBe(832);
  });
});
