/**
 * The Grip: the round glass button at the right edge, on the Terminal Screen
 * and the Web View. These are its rules; the view that draws it is
 * components/edge-grip.tsx and the one that draws its Fan is
 * components/grip-fan.tsx.
 *
 * A finger on it waits `GRIP_HOLD_MS`. Still, it opens the Fan: four Grip
 * actions round the button, which the finger lights by direction and a lift
 * runs. The Destinations action, straight up, hands the finger to the Edge
 * Drawer, so a slide onto a row and a lift there picks that row. A slide down
 * past the drawer gives the finger back to the Fan. One that
 * moves `GRIP_SLOP` first is a drag, which the screen gives its own sideways
 * gesture: the Pane Swipe on the Terminal Screen. See ADR 0042.
 */

/**
 * The button: `drawn` points wide and round, `inset` points from the right
 * edge to its centre. The touch lands in a square `target` points wide round
 * it, because React Native cannot hit-test a circle, so a thumb finds it
 * without a look and the button takes fewer touches than a band down the edge.
 */
export const GRIP_BUTTON = { drawn: 36, target: 44, inset: 22 };

/**
 * How far down the screen the button's centre is. On a phone the middle,
 * where the thumb rests, and just above where the keyboard comes, so the
 * Grip is in one place with the keyboard up or down. On an iPad three
 * quarters, where a thumb reaches it.
 */
export function gripHeight(wide: boolean): number {
  return wide ? 0.75 : 0.5;
}

/**
 * Where the button's centre is in an area that spans `top` to `bottom` on a
 * screen `screen` high: kept inside the area, and low enough that the Fan's
 * highest slot is inside it too, as the Fan opens up.
 */
export function gripCentre(area: { top: number; bottom: number }, screen: number, wide: boolean): number {
  const above = FAN_RADIUS + FAN_SLOT_SIZE / 2;
  return Math.min(Math.max(screen * gripHeight(wide), area.top + above), area.bottom - GRIP_BUTTON.target / 2);
}

/**
 * How long the finger stays still before the Fan opens. Shorter than the
 * Selection long press (350 ms) because no Selection can start under the
 * button, and short enough that a hold and a slide to the drawer take about
 * as long as the old hold alone.
 */
export const GRIP_HOLD_MS = 250;

/**
 * How far a held finger may drift and still be a hold, and how far it goes
 * from where the drawer opened before a row lights. The Selection long
 * press's own allowance, so the two holds feel the same.
 */
export const GRIP_SLOP = 20;

/** A window this wide or wider is an iPad's: the drawer is a column beside a live terminal. */
export const WIDE_DRAWER_SCREEN = 700;

/**
 * Whether the Grip shows on a screen this size: not on a phone on its side,
 * whose short height has no room for it beside the keyboard. A phone is a
 * screen whose short side is under `WIDE_DRAWER_SCREEN`, so a phone on its
 * side, as wide as an iPad, is still a phone.
 */
export function gripShown(screen: { width: number; height: number }): boolean {
  const phone = Math.min(screen.width, screen.height) < WIDE_DRAWER_SCREEN;
  return !(phone && screen.width > screen.height);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A slot of the Fan, counted from straight up (12 o'clock) round to straight
 * left (9 o'clock). Slot 0 is Destinations, which opens the Edge Drawer. The
 * other three hold the Grip actions that Settings chooses.
 */
export type FanSlot = 0 | 1 | 2 | 3;
export type ActionSlot = Exclude<FanSlot, 0>;
export const FAN_SLOTS: readonly FanSlot[] = [0, 1, 2, 3];
export const DESTINATIONS_SLOT = 0;

/** How far a slot's centre is from the button's centre, and how wide a slot is drawn. */
export const FAN_RADIUS = 100;
export const FAN_SLOT_SIZE = 40;

/** The finger lights nothing this close to the button's centre: it is still on the button. */
export const FAN_DEAD_RADIUS = 44;

/** How far apart the slots are, and the angle of slot 0, in degrees from the right, counted up. */
const FAN_STEP = 30;
const FAN_START = 90;
const FAN_END = FAN_START + FAN_STEP * (FAN_SLOTS.length - 1);

/** The slot's centre on screen, for the Fan round `centre`. */
export function fanSlotCentre(centre: Point, slot: FanSlot): Point {
  const angle = ((FAN_START + FAN_STEP * slot) * Math.PI) / 180;
  return { x: centre.x + FAN_RADIUS * Math.cos(angle), y: centre.y - FAN_RADIUS * Math.sin(angle) };
}

/**
 * The slot that a finger at `finger` points at, in the Fan round `centre`, or
 * null. It is by direction, so the finger needs no aim: the slot whose angle is
 * nearest wins. Nothing is lit within `FAN_DEAD_RADIUS`, below the horizontal
 * line, or right of vertical, each by more than half a step: the Fan is a
 * quarter, and a thumb at the right edge goes up and to the left.
 */
export function slotAt(centre: Point, finger: Point): FanSlot | null {
  const dx = finger.x - centre.x;
  const dy = centre.y - finger.y;
  if (Math.hypot(dx, dy) <= FAN_DEAD_RADIUS) return null;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const angle = degrees < 0 ? degrees + 360 : degrees;
  const slack = FAN_STEP / 2;
  if (angle < FAN_START - slack || angle > FAN_END + slack) return null;
  const clamped = Math.min(Math.max(angle, FAN_START), FAN_END);
  return FAN_SLOTS[Math.round((clamped - FAN_START) / FAN_STEP)];
}

/**
 * One finger on the Grip.
 *
 * - `waiting`: until the hold ends or the finger moves.
 * - `dragging`: it moved first, which the Fan never sees.
 * - `fan`: the hold ended and the Fan is open round `centre`, the button's
 *   centre. `lit` is the Grip action the finger points at. It is never
 *   Destinations, which hands the finger to the drawer the moment it lights.
 *   `returned` is true while a finger that came back from the drawer still
 *   points at Destinations: it lights nothing until it points elsewhere or
 *   comes back to the centre, so the drawer does not open again under a
 *   finger that is still on its way down.
 * - `held`: the finger lit Destinations at `at`, and the Edge Drawer is open
 *   under it. A slide down past the drawer goes back to the Fan round `centre`.
 */
export type GripTouch =
  | { phase: 'waiting'; from: Point }
  | { phase: 'dragging'; from: Point }
  | { phase: 'fan'; centre: Point; lit: ActionSlot | null; returned: boolean }
  | { phase: 'held'; at: Point; centre: Point };

/** The hold ended with the finger still: the Fan opens round the button's `centre`. */
export function holdGrip(touch: GripTouch, centre: Point): GripTouch {
  return touch.phase === 'waiting' ? { phase: 'fan', centre, lit: null, returned: false } : touch;
}

/** The finger went down past the drawer, which closed: the Fan opens again round the button, with nothing lit. */
export function returnToFan(touch: GripTouch): GripTouch {
  return touch.phase === 'held' ? { phase: 'fan', centre: touch.centre, lit: null, returned: true } : touch;
}

/**
 * The touch after the finger moved to `to`. A finger that went past the slop
 * before the hold is a drag. In the Fan it lights the slot it points at, and
 * one that points at Destinations is `held` from the point where it lit.
 */
export function moveGrip(touch: GripTouch, to: Point): GripTouch {
  switch (touch.phase) {
    case 'waiting':
      return distance(touch.from, to) > GRIP_SLOP ? { phase: 'dragging', from: touch.from } : touch;
    case 'fan': {
      const slot = slotAt(touch.centre, to);
      if (slot === DESTINATIONS_SLOT && !touch.returned) return { phase: 'held', at: to, centre: touch.centre };
      const lit = slot === DESTINATIONS_SLOT ? null : slot;
      const returned = touch.returned && slot === DESTINATIONS_SLOT;
      return lit === touch.lit && returned === touch.returned ? touch : { ...touch, lit, returned };
    }
    default:
      return touch;
  }
}

/** Whether a move from `before` to `after` lit a slot the finger was not on, which gives the light tick. */
export function lightsSlot(before: GripTouch, after: GripTouch): boolean {
  if (before.phase !== 'fan') return false;
  return after.phase === 'held' || (after.phase === 'fan' && after.lit !== null && after.lit !== before.lit);
}

/**
 * What the end of a touch does.
 *
 * - `nothing`: a tap, a lift in the Fan's dead centre or on no slot, a lift on
 *   a slot that cannot run, or a touch the system took.
 * - `run`: a lift on the lit Grip action.
 * - `drag`: the finger moved before the hold, so the screen's own gesture ends.
 * - `held`: the Edge Drawer is open under the finger, and `liftGrip` decides.
 */
export type GripEnd =
  | { kind: 'nothing' }
  | { kind: 'run'; slot: ActionSlot }
  | { kind: 'drag'; from: Point }
  | { kind: 'held'; at: Point };

/** `lifted` is false for a touch that the system took. `canRun` says which slots hold an action the screen can run. */
export function endGrip(touch: GripTouch, lifted: boolean, canRun: (slot: ActionSlot) => boolean): GripEnd {
  switch (touch.phase) {
    case 'waiting':
      return { kind: 'nothing' };
    case 'dragging':
      return { kind: 'drag', from: touch.from };
    case 'fan':
      return lifted && touch.lit !== null && canRun(touch.lit) ? { kind: 'run', slot: touch.lit } : { kind: 'nothing' };
    case 'held':
      return { kind: 'held', at: touch.at };
  }
}

/** Where the drawer's panel is on screen, in the same points as the finger, and how wide its Lift Lane is. */
export interface DrawerFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  lane: number;
}

/**
 * The width of the Lift Lane: the panel's right strip. A finger lights
 * Destinations straight above the button, so it starts in the lane. The rows
 * stop left of it. A held finger can move up and down in it, and a lift
 * there closes the drawer with no pick.
 */
export const LIFT_LANE = 44;

/**
 * How far below the finger that lit Destinations the panel ends: the
 * list's bottom padding (10) and half a row's least height (24), so the
 * last row is level with the finger and a slide left from the Lift Lane
 * lands on it. It follows those two sizes in components/edge-drawer.tsx.
 */
export const DRAWER_ROW_REACH = 34;

/**
 * Where the drawer's panel ends on screen, as a y: just below `anchorY`,
 * where the finger lit Destinations, but never below `floorY`, the top of the
 * keyboard or of the home indicator. The panel grows up from there.
 */
export function drawerBottom(anchorY: number, floorY: number): number {
  return Math.min(anchorY + DRAWER_ROW_REACH, floorY);
}

/** Whether a held finger at `point` is in the Lift Lane. */
export function inLiftLane(point: Point, drawer: DrawerFrame): boolean {
  return !outsidePanel(point, drawer) && point.x >= drawer.right - drawer.lane;
}

/**
 * Whether a held finger at `point` has gone down past the drawer, which then
 * closes and gives the finger back to the Fan. That is below the panel, and
 * at least `DRAWER_ROW_REACH` below `at`, where the finger lit Destinations:
 * a panel held up by the keyboard can end above that point, and the finger
 * must not go back the moment the drawer opens.
 */
export function backToFan(point: Point, at: Point, drawer: DrawerFrame): boolean {
  return point.y > Math.max(drawer.bottom, at.y + DRAWER_ROW_REACH);
}

/**
 * What lifting a held finger at `to` does. The drawer closes on each lift.
 *
 * - `pick`: it lifted on a row in the list, whose key `rowAt` gives.
 * - `close`: it lifted anywhere else: in the Lift Lane, on the header or on
 *   no row, or in the Cancel Zone. Nothing is picked.
 */
export type GripLift = { kind: 'close' } | { kind: 'pick'; key: string };

export function liftGrip(to: Point, drawer: DrawerFrame, rowAt: (point: Point) => string | null): GripLift {
  if (outsidePanel(to, drawer) || inLiftLane(to, drawer)) return { kind: 'close' };
  const key = rowAt(to);
  return key === null ? { kind: 'close' } : { kind: 'pick', key };
}

/**
 * Whether a held finger at `point` is in the Cancel zone: outside the panel,
 * but not below it, where the finger goes back to the Fan.
 */
export function inCancelZone(point: Point, drawer: DrawerFrame): boolean {
  return outsidePanel(point, drawer) && point.y <= drawer.bottom;
}

function outsidePanel(point: Point, drawer: DrawerFrame): boolean {
  return point.x < drawer.left || point.y < drawer.top || point.y > drawer.bottom;
}

/** How near the list's top or bottom a held finger starts to scroll it. */
export const AUTOSCROLL_EDGE = 56;

/** The fastest scroll, with the finger at the list's edge or past it. */
export const AUTOSCROLL_MAX = 900;

/** The part of the list a held finger can see, on screen. */
export interface ListWindow {
  top: number;
  bottom: number;
}

/**
 * How fast a held finger at `point` scrolls the drawer's list, in points a
 * second: below zero up, above zero down, zero when it is not near an edge.
 *
 * The scroll starts `AUTOSCROLL_EDGE` points in from the list's top or
 * bottom and gets faster as the finger goes nearer, up to `AUTOSCROLL_MAX`
 * on the edge. Over the header above the list, still in the panel, it is
 * the fastest. Outside the panel it is zero.
 */
export function autoScrollSpeed(point: Point, drawer: DrawerFrame, list: ListWindow): number {
  if (outsidePanel(point, drawer)) return 0;
  const intoTop = list.top + AUTOSCROLL_EDGE - point.y;
  if (intoTop > 0) return -AUTOSCROLL_MAX * Math.min(intoTop / AUTOSCROLL_EDGE, 1);
  const intoBottom = point.y - (list.bottom - AUTOSCROLL_EDGE);
  if (intoBottom > 0) return AUTOSCROLL_MAX * Math.min(intoBottom / AUTOSCROLL_EDGE, 1);
  return 0;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
