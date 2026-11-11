import { swipeTick } from 'expo-libghostty';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Easing,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { SwipeDirection } from '@/lib/pan-axis';
import type { Attach } from '@/tmux/attach';
import { paneForSwipe } from '@/tmux/pane-swipe';
import {
  IDLE,
  paneSwipeAfter,
  type PaneSwipeEvent,
  type PaneSwipeState,
} from '@/tmux/pane-swipe-state';
import type { Pane } from '@/tmux/tmux-client';

const SLIDE = { duration: 180, easing: Easing.out(Easing.cubic) };
// Critically damped: the Pane comes back to its place and does not pass it.
const SPRING_BACK = { mass: 1, stiffness: 320, damping: 36 };

export interface PaneSwipe {
  /** How far the Pane that moves is from its place, in points. */
  offset: SharedValue<number>;
  /** The Pane that a swipe is leaving, while it is still on its way out. */
  leaving: string | null;
  /**
   * The finger is `translation` points from where a horizontal drag began,
   * on a Pane `width` wide. `ticks` is for a layer that takes the finger
   * before the Surface does: the Surface ticks for its own drag.
   */
  drag(translation: number, width: number, ticks: boolean): void;
  /** The finger lifted on a swipe. */
  swipe(direction: SwipeDirection): void;
  /** The finger lifted short of a swipe. */
  cancel(): void;
  /** A Pane's Surface reported a grid, which is when a new Pane may come in. */
  surfaceReported(paneId: string): void;
  /** Whether a committed or cancelled Pane Swipe is still moving. */
  isTransitioning(): boolean;
}

/**
 * A Pane Swipe on the Terminal Screen: the Pane follows the finger, and past
 * the commit point it slides out and the next one slides in. See
 * PaneSwipeState for what a swipe can be, and CONTEXT.md.
 *
 * The Pane moves only where `follows` is true: a Window that shows one Pane
 * and has another to go to. Elsewhere a swipe changes the Pane and nothing
 * moves.
 */
export function usePaneSwipe(options: {
  attach: Attach | null;
  panes: Pane[];
  activePaneId: string;
  follows: boolean;
  /** The width the Pane slides across. */
  width: number;
  /** Whether a Selection holds a Pane, and with it every horizontal drag. */
  frozen: () => boolean;
}): PaneSwipe {
  const offset = useSharedValue(0);
  const state = useRef<PaneSwipeState>(IDLE);
  const [leaving, setLeaving] = useState<string | null>(null);
  const now = useRef(options);
  useEffect(() => {
    now.current = options;
  });

  /** What an animation says when it ends. It is `send`, which starts the animation. */
  const ended = useRef<(event: PaneSwipeEvent) => void>(() => {});
  const animationEnded = useCallback((event: PaneSwipeEvent) => ended.current(event), []);

  const send = useCallback(
    (event: PaneSwipeEvent) => {
      const before = state.current;
      const after = paneSwipeAfter(before, event);
      if (after === before) return;
      state.current = after;
      setLeaving(after.phase === 'committing' ? after.leaving : null);

      const { follows, width } = now.current;
      const then = (next: PaneSwipeEvent) => (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(animationEnded, next);
      };
      switch (after.phase) {
        case 'idle':
          offset.set(0);
          break;
        case 'dragging':
          if (follows) offset.set(after.offset);
          break;
        case 'committing':
          if (before.phase === 'committing') break;
          offset.set(
            withTiming(after.direction === 'left' ? -width : width, SLIDE, then({ type: 'slidOut' })),
          );
          break;
        case 'settling':
          offset.set(
            before.phase === 'committing'
              ? withSequence(
                  // From the side the old Pane did not leave by.
                  withTiming(before.direction === 'left' ? width : -width, { duration: 0 }),
                  withTiming(0, SLIDE, then({ type: 'rested' })),
                )
              : withSpring(0, SPRING_BACK, then({ type: 'rested' })),
          );
          break;
      }
    },
    [offset, animationEnded],
  );
  useEffect(() => {
    ended.current = send;
  }, [send]);

  const { activePaneId, follows } = options;
  useEffect(() => send({ type: 'active', pane: activePaneId }), [send, activePaneId]);
  useEffect(() => {
    if (!follows) send({ type: 'reset' });
  }, [send, follows]);

  const drag = useCallback(
    (translation: number, width: number, ticks: boolean) => {
      if (now.current.frozen()) return;
      const was = pastCommit(state.current);
      send({ type: 'drag', translation, width });
      if (ticks && pastCommit(state.current) !== was) swipeTick();
    },
    [send],
  );

  const cancel = useCallback(
    () => send({ type: now.current.follows ? 'cancel' : 'reset' }),
    [send],
  );

  const swipe = useCallback(
    (direction: SwipeDirection) => {
      const { attach, panes, frozen } = now.current;
      // The next Pane is not in yet, so there is no Pane to swipe.
      if (frozen() || state.current.phase === 'committing') return;
      const pane = paneForSwipe(panes, direction);
      if (!pane || !attach?.selectPane(pane.id)) {
        cancel();
        return;
      }
      send(
        now.current.follows
          ? { type: 'commit', direction, leaving: now.current.activePaneId }
          : { type: 'reset' },
      );
    },
    [send, cancel],
  );

  const surfaceReported = useCallback(
    (paneId: string) => send({ type: 'arrived', pane: paneId }),
    [send],
  );

  const isTransitioning = useCallback(
    () => state.current.phase === 'committing' || state.current.phase === 'settling',
    [],
  );

  return { offset, leaving, drag, swipe, cancel, surfaceReported, isTransitioning };
}

function pastCommit(state: PaneSwipeState): boolean {
  return state.phase === 'dragging' && state.pastCommit;
}
