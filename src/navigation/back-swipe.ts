/**
 * The back swipe, one rule for the whole app: the left edge always goes back.
 *
 * Each screen takes a mode, with `useBackSwipe`. On most screens a drag right from anywhere goes
 * back, as iOS 26 does. A screen whose content is its own sideways move (the
 * Pane Swipe) keeps the content for that move and goes back only from a band
 * at the left edge. Each layer that has its own sideways drag (also the Host
 * Screen's tab swipe, on its tab control and the bar at the bottom) gives a
 * drag right that starts in the band to back, with `startsAtBackEdge`, so the
 * two never compete. See ADR 0025.
 */

export type BackSwipe = 'anywhere' | 'edge' | 'off';

/** The width of the edge band, in points. The one number for every layer. */
export const BACK_EDGE = 24;

/**
 * How far a finger has moved when the stack asks whether its back swipe may
 * begin. The stack measures where the finger is then, not where it landed, so
 * its limit is the band plus this travel.
 */
// TODO(back-swipe band): the layers decide by where the finger landed, the
// stack by where it is when its pop begins. Measured: on the Mouse Layer a drag
// that lands at x = 28 or 32 goes back, and on the Surface a slow drag from
// x = 20 does nothing. Decide: patch react-native-screens to check the landing
// point too, or accept this. See ADR 0025.
const TRAVEL_AT_BEGIN = 16;

type StackOptions = {
  gestureEnabled: boolean;
  fullScreenGestureEnabled: boolean;
  gestureResponseDistance: { start: number; end: number; top: number; bottom: number };
};

const ANYWHERE = { start: -1, end: -1, top: -1, bottom: -1 };
const AT_THE_EDGE = { ...ANYWHERE, end: BACK_EDGE + TRAVEL_AT_BEGIN };

/**
 * The native stack's options for a mode. The layout's screenOptions use
 * 'anywhere'. `contentPop` is whether the system has its own back swipe from
 * anywhere, as iOS 26 does. Before it, the stack would draw one of its own,
 * so the back swipe stays at UIKit's edge there.
 */
export function backSwipeOptions(mode: BackSwipe, contentPop: boolean): StackOptions {
  return {
    gestureEnabled: mode !== 'off',
    fullScreenGestureEnabled: contentPop,
    gestureResponseDistance: mode === 'edge' ? AT_THE_EDGE : ANYWHERE,
  };
}

/**
 * Whether a drag belongs to the back swipe, for a layer with its own sideways
 * drag: it landed in the band, `x` points from the screen's left edge, and it
 * went right.
 */
export function startsAtBackEdge(x: number, dx: number): boolean {
  return x < BACK_EDGE && dx > 0;
}
