import { panAxis, swipeOf, type SwipeDirection } from './pan-axis';
import type { PaneBox } from '@/tmux/pane-layout';
import type { Grid } from '@/tmux/tmux-client';

export interface TrackpadEvent {
  phase: 'began' | 'changed' | 'ended' | 'cancelled';
  gestureId: number;
  contextEpoch: number;
  x: number;
  y: number;
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
}

export interface TrackpadTarget {
  paneId: string;
  box: PaneBox;
  grid: Grid;
}

type Motion =
  | { kind: 'pending' }
  | { kind: 'horizontal' }
  | { kind: 'vertical'; previous: number; remainder: number };

type Gesture =
  | { kind: 'idle' }
  | { kind: 'tracking'; id: number; target: TrackpadTarget; motion: Motion };

interface TrackpadActions {
  drag(translation: number, width: number): void;
  swipe(direction: SwipeDirection): void;
  cancel(): void;
  scroll(paneId: string, lines: number, grid: Grid): void;
}

/** One continuous gesture keeps its Pane and axis until it ends. */
export function createTrackpadGesture(options: {
  epoch: number;
  targets: readonly TrackpadTarget[];
  selectionPane: string | null;
  scrollSpeed: number;
  allowed(): boolean;
  actions: TrackpadActions;
}) {
  let gesture: Gesture = { kind: 'idle' };
  let lastId = 0;
  const { actions } = options;

  const cancel = () => {
    if (gesture.kind === 'tracking' && gesture.motion.kind === 'horizontal') actions.cancel();
    gesture = { kind: 'idle' };
  };

  const receive = (event: TrackpadEvent) => {
    if (event.contextEpoch !== options.epoch) return;
    if (!options.allowed()) { cancel(); return; }
    if (event.phase === 'began') {
      if (event.gestureId <= lastId) return;
      cancel();
      lastId = event.gestureId;
      const target = options.targets.find(({ box }) => event.x >= box.left &&
        event.x < box.left + box.width && event.y >= box.top && event.y < box.top + box.height);
      if (!target || target.grid.rows <= 0 || target.grid.cols <= 0 || target.box.height <= 0 ||
          target.box.width <= 0 || options.selectionPane !== null && target.paneId !== options.selectionPane) return;
      gesture = { kind: 'tracking', id: event.gestureId,
        target: { ...target, box: { ...target.box }, grid: { ...target.grid } },
        motion: { kind: 'pending' } };
    }
    if (gesture.kind === 'idle' || gesture.id !== event.gestureId) return;
    if (event.phase === 'cancelled') { cancel(); return; }
    const { target } = gesture;
    let motion = gesture.motion;
    if (motion.kind === 'pending' && (event.translationX !== 0 || event.translationY !== 0)) {
      const axis = panAxis(event.translationX, event.translationY);
      if (axis === 'horizontal') {
        if (options.selectionPane !== null) { cancel(); return; }
        motion = { kind: 'horizontal' };
      } else {
        motion = { kind: 'vertical', previous: 0, remainder: 0 };
      }
    }
    if (motion.kind === 'horizontal') actions.drag(event.translationX, target.box.width);
    if (motion.kind === 'vertical') {
      const total = motion.remainder + (event.translationY - motion.previous) *
        target.grid.rows / target.box.height * options.scrollSpeed;
      const lines = Math.trunc(total);
      motion = { kind: 'vertical', previous: event.translationY, remainder: total - lines };
      if (lines !== 0) actions.scroll(target.paneId, lines, target.grid);
    }
    gesture = { ...gesture, motion };
    if (event.phase !== 'ended') return;
    gesture = { kind: 'idle' };
    if (motion.kind === 'horizontal') {
      const direction = swipeOf(event.translationX, target.box.width, event.velocityX);
      if (direction) actions.swipe(direction);
      else actions.cancel();
    }
  };

  return { receive, cancel };
}
