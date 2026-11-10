import type { SwipeDirection } from '@/lib/pan-axis';
import { followOffset, isPastCommit } from '@/lib/pan-axis';

/**
 * Where a Pane Swipe is, from the finger landing to the next Pane at rest.
 *
 * One value, because the parts cannot be told apart otherwise: an offset
 * means something only while a finger holds the Pane, and a Pane on its way
 * out only while tmux has been asked for the next one.
 */
export type PaneSwipeState =
  | { phase: 'idle' }
  /** A finger holds the Pane `offset` points from its place. */
  | { phase: 'dragging'; offset: number; pastCommit: boolean }
  /**
   * The finger lifted past the commit point and tmux has the move. The Pane
   * `leaving` slides out, and the next one waits for both that and its own
   * Surface's first grid before it comes in.
   */
  | {
      phase: 'committing';
      direction: SwipeDirection;
      leaving: string;
      slidOut: boolean;
      arrived: boolean;
    }
  /** The Pane on screen is on its way to rest: back, or in from the side. */
  | { phase: 'settling' };

export type PaneSwipeEvent =
  /** The finger is `translation` points from where the drag began, on a Surface `width` wide. */
  | { type: 'drag'; translation: number; width: number }
  /** The finger lifted short of a swipe, or the drag was taken away. */
  | { type: 'cancel' }
  /** The finger lifted on a swipe, and tmux was asked to leave the Pane `leaving`. */
  | { type: 'commit'; direction: SwipeDirection; leaving: string }
  /** The Pane that is leaving is off the screen. */
  | { type: 'slidOut' }
  /** The Surface of `pane` reported a grid. */
  | { type: 'arrived'; pane: string }
  /** The Pane on screen is at rest. */
  | { type: 'rested' }
  /** tmux's active Pane is now `pane`. */
  | { type: 'active'; pane: string }
  /** Nothing may move now: the Window shows more than one Pane, or the swipe moved nothing. */
  | { type: 'reset' };

export const IDLE: PaneSwipeState = { phase: 'idle' };
const SETTLING: PaneSwipeState = { phase: 'settling' };

/**
 * The state after an event. Answers the same object when the event changes
 * nothing, which is how a caller knows there is nothing to do.
 */
export function paneSwipeAfter(state: PaneSwipeState, event: PaneSwipeEvent): PaneSwipeState {
  switch (event.type) {
    case 'drag':
      // The finger is on the next Pane's place, and that Pane is not there yet.
      if (state.phase === 'committing') return state;
      return {
        phase: 'dragging',
        offset: followOffset(event.translation, event.width),
        pastCommit: isPastCommit(event.translation, event.width),
      };

    case 'cancel':
      return state.phase === 'dragging' ? SETTLING : state;

    case 'commit':
      if (state.phase === 'committing') return state;
      return {
        phase: 'committing',
        direction: event.direction,
        leaving: event.leaving,
        slidOut: false,
        arrived: false,
      };

    case 'slidOut':
      return state.phase === 'committing' ? entered({ ...state, slidOut: true }) : state;

    case 'arrived':
      return state.phase === 'committing' && event.pane !== state.leaving
        ? entered({ ...state, arrived: true })
        : state;

    case 'rested':
      return state.phase === 'settling' ? IDLE : state;

    case 'active':
      if (state.phase === 'idle') return state;
      // The change this swipe asked for, unless it is back on the Pane it
      // left: the Host refused the move, or took it back.
      if (state.phase === 'committing' && event.pane !== state.leaving) return state;
      return IDLE;

    case 'reset':
      return state.phase === 'idle' ? state : IDLE;
  }
}

function entered(state: Extract<PaneSwipeState, { phase: 'committing' }>): PaneSwipeState {
  return state.slidOut && state.arrived ? SETTLING : state;
}
