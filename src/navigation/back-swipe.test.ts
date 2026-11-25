import { BACK_EDGE, backSwipeOptions, startsAtBackEdge } from './back-swipe';

describe('startsAtBackEdge', () => {
  it('gives a drag right from the band to back', () => {
    expect(startsAtBackEdge(0, 12)).toBe(true);
    expect(startsAtBackEdge(BACK_EDGE - 1, 12)).toBe(true);
  });

  it('keeps a drag right from outside the band, and any drag left', () => {
    expect(startsAtBackEdge(BACK_EDGE, 12)).toBe(false);
    expect(startsAtBackEdge(200, 12)).toBe(false);
    expect(startsAtBackEdge(4, -12)).toBe(false);
  });
});

describe('backSwipeOptions', () => {
  it('lets the back swipe begin only in the band', () => {
    const { gestureEnabled, fullScreenGestureEnabled, gestureResponseDistance } = backSwipeOptions('edge', true);
    expect(gestureEnabled).toBe(true);
    expect(fullScreenGestureEnabled).toBe(true);
    expect(gestureResponseDistance).toEqual({ start: -1, end: BACK_EDGE, top: -1, bottom: -1 });
  });

  it('keeps UIKit\'s edge pop before iOS 26', () => {
    expect(backSwipeOptions('edge', false).fullScreenGestureEnabled).toBe(false);
  });

  it('does not go back at all when off', () => {
    expect(backSwipeOptions('off', true).gestureEnabled).toBe(false);
  });
});
