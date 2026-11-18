import React from 'react';
import { act, create } from 'react-test-renderer';

import type { Pane } from '@/tmux/tmux-client';

import { usePaneSwipe, type PaneSwipe } from './use-pane-swipe';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

const mockSwipeTick = jest.fn();
jest.mock('expo-libghostty', () => ({ swipeTick: () => mockSwipeTick() }));

const WIDTH = 400;
const pane = (index: number, active: boolean) => ({ id: `%${index}`, index, active }) as Pane;

let swipe: PaneSwipe;
function mount(panes: Pane[]) {
  function Screen() {
    swipe = usePaneSwipe({
      attach: null,
      panes,
      activePaneId: '%0',
      follows: panes.length > 1,
      width: WIDTH,
      frozen: () => false,
    });
    return null;
  }
  act(() => {
    create(<Screen />);
  });
}

/** A Mouse Layer drag out past the commit point and back. */
function dragOutAndBack() {
  act(() => swipe.drag(-WIDTH / 2, WIDTH, true));
  act(() => swipe.drag(-10, WIDTH, true));
}

beforeEach(() => mockSwipeTick.mockClear());

test('a drag on a Window with one Pane is no swipe: it neither ticks nor moves', () => {
  mount([pane(0, true)]);
  expect(swipe.swipes).toBe(false);
  dragOutAndBack();
  expect(mockSwipeTick).not.toHaveBeenCalled();
  act(() => swipe.drag(-WIDTH / 2, WIDTH, true));
  expect(swipe.offset.get()).toBe(0);
});

test('a drag on a Window with another Pane ticks at the commit point both ways, and moves', () => {
  mount([pane(0, true), pane(1, false)]);
  expect(swipe.swipes).toBe(true);
  dragOutAndBack();
  expect(mockSwipeTick).toHaveBeenCalledTimes(2);
  act(() => swipe.drag(-WIDTH / 2, WIDTH, true));
  expect(swipe.offset.get()).toBeLessThan(0);
});
