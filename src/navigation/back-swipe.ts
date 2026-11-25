/**
 * The back swipe, one rule for the whole app: only the left edge goes back.
 *
 * A drag right goes back only when the finger landed in the band at the left
 * edge of the screen. A drag that lands anywhere else is the content's: a
 * page's scroll, a Pane Swipe, a swipe action. Each layer that has its own
 * sideways drag (the Surface, the Mouse Layer, the Host Screen's tab swipe)
 * gives a drag right that starts in the band to back, with `startsAtBackEdge`,
 * so the two never compete. A screen turns the back swipe off with
 * `useBackSwipe`. See ADR 0034.
 */

export type BackSwipe = 'edge' | 'off';

/** The width of the edge band, in points. The one number for every layer. */
export const BACK_EDGE = 24;

type StackOptions = {
  gestureEnabled: boolean;
  fullScreenGestureEnabled: boolean;
  gestureResponseDistance: { start: number; end: number; top: number; bottom: number };
};

/** The band, as the stack's limit on where its back swipe may begin. */
const IN_THE_BAND = { start: -1, end: BACK_EDGE, top: -1, bottom: -1 };

/**
 * The native stack's options for a mode. The layout's screenOptions use
 * 'edge'. `contentPop` is whether the system has a content pop, as iOS 26
 * does. The stack checks its limit against where the finger landed
 * (patches/react-native-screens.patch), so the pop begins only in the band.
 * Before iOS 26 the stack would draw a pop of its own, so the back swipe is
 * UIKit's edge pop there.
 */
export function backSwipeOptions(mode: BackSwipe, contentPop: boolean): StackOptions {
  return {
    gestureEnabled: mode === 'edge',
    fullScreenGestureEnabled: contentPop,
    gestureResponseDistance: IN_THE_BAND,
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
