/**
 * The Grip: the small glass line at the right edge whose hold opens the
 * Edge Drawer, on the Terminal Screen and the Web View. These are its rules;
 * the view that draws it is components/edge-grip.tsx.
 *
 * A finger on it waits `GRIP_HOLD_MS`. Still, it opens the drawer and
 * stays down, so a slide onto a row and a lift there picks that row. The
 * drawer is a quick switch: each lift closes it. One that
 * moves `GRIP_SLOP` first is a drag, which the screen gives its own sideways
 * gesture: the Pane Swipe on the Terminal Screen. See ADR 0036.
 */

/** The band at the right edge that takes the touch: wider than the line, so a thumb finds it. */
export const GRIP_BAND = { width: 28, height: 110 };

/** The glass line the user sees, in the band's middle. */
export const GRIP_LINE = { width: 6, height: 48 };

/**
 * How far down the screen the band's centre is. On a phone the middle,
 * where the thumb rests, and just above where the keyboard comes, so the
 * Grip is in one place with the keyboard up or down. On an iPad three
 * quarters, where a thumb reaches it.
 */
export function gripHeight(wide: boolean): number {
  return wide ? 0.75 : 0.5;
}

/**
 * Where the band's centre is in an area that spans `top` to `bottom` on a
 * screen `screen` high, kept inside the area.
 */
export function gripCentre(area: { top: number; bottom: number }, screen: number, wide: boolean): number {
  const half = GRIP_BAND.height / 2;
  return Math.min(Math.max(screen * gripHeight(wide), area.top + half), area.bottom - half);
}

/** How long the finger stays still before the drawer opens: D5 of the proposal. */
export const GRIP_HOLD_MS = 400;


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
 * One finger in the band. `waiting` until the hold ends or the finger moves;
 * `dragging` once it moved first, which the drawer never sees; `held` once
 * the drawer opened under it, from `at`.
 */
export type GripTouch =
  | { phase: 'waiting'; from: Point }
  | { phase: 'dragging'; from: Point }
  | { phase: 'held'; at: Point };

/** The touch after the finger moved to `to`: a finger that went past the slop before the hold is a drag. */
export function moveGrip(touch: GripTouch, to: Point): GripTouch {
  if (touch.phase !== 'waiting') return touch;
  return distance(touch.from, to) > GRIP_SLOP ? { phase: 'dragging', from: touch.from } : touch;
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
 * The width of the Lift Lane: the panel's right strip, past the Grip's
 * band, so the finger that opened the drawer starts in it. The rows stop
 * left of it. A held finger can move up and down in it, and a lift there
 * closes the drawer with no pick.
 */
export const LIFT_LANE = 44;

/**
 * How far below the finger that opened the drawer the panel ends: the
 * list's bottom padding (10) and half a row's least height (24), so the
 * last row is level with the finger and a slide left from the Lift Lane
 * lands on it. It follows those two sizes in components/edge-drawer.tsx.
 */
export const DRAWER_ROW_REACH = 34;

/**
 * Where the drawer's panel ends on screen, as a y: just below `anchorY`,
 * where the finger held the Grip, but never below `floorY`, the top of the
 * keyboard or of the home indicator. The panel grows up from there.
 */
export function drawerBottom(anchorY: number, floorY: number): number {
  return Math.min(anchorY + DRAWER_ROW_REACH, floorY);
}

/** Whether a held finger at `point` is in the Lift Lane. */
export function inLiftLane(point: Point, drawer: DrawerFrame): boolean {
  return !inCancelZone(point, drawer) && point.x >= drawer.right - drawer.lane;
}

/**
 * What lifting a held finger at `to` does. The drawer closes on each lift.
 *
 * - `pick`: it lifted on a row in the list, whose key `rowAt` gives.
 * - `close`: it lifted anywhere else: on the Grip or in the Lift Lane, on
 *   the header or on no row, or in the Cancel Zone. Nothing is picked.
 */
export type GripLift = { kind: 'close' } | { kind: 'pick'; key: string };

export function liftGrip(to: Point, drawer: DrawerFrame, rowAt: (point: Point) => string | null): GripLift {
  if (inCancelZone(to, drawer) || inLiftLane(to, drawer)) return { kind: 'close' };
  const key = rowAt(to);
  return key === null ? { kind: 'close' } : { kind: 'pick', key };
}

/** Whether a held finger at `point` is in the Cancel zone: anywhere outside the panel. */
export function inCancelZone(point: Point, drawer: DrawerFrame): boolean {
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
 * the fastest. In the Cancel zone it is zero: there the lift closes.
 */
export function autoScrollSpeed(point: Point, drawer: DrawerFrame, list: ListWindow): number {
  if (inCancelZone(point, drawer)) return 0;
  const intoTop = list.top + AUTOSCROLL_EDGE - point.y;
  if (intoTop > 0) return -AUTOSCROLL_MAX * Math.min(intoTop / AUTOSCROLL_EDGE, 1);
  const intoBottom = point.y - (list.bottom - AUTOSCROLL_EDGE);
  if (intoBottom > 0) return AUTOSCROLL_MAX * Math.min(intoBottom / AUTOSCROLL_EDGE, 1);
  return 0;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
