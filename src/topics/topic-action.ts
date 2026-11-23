import type { SFSymbol } from 'expo-symbols';

import type { Mark } from './environment';

/**
 * The orders in the long-press menu of a Topic row. Each is one command that
 * the Mac's rules decide: the phone sends it, the Host Server pushes the
 * Listing that shows the result, and the phone never works out where a card
 * lands.
 *
 * Mark as Read reads the whole Topic, as the Mac's Mark Read does: the Topic
 * mark and the Unread mark of each Agent in its Sessions. Mark as Unread
 * changes the Topic mark only, so the phone never makes an Agent Unread.
 *
 * Settle and Forget close the Topic with the Sessions the Host offers: each
 * kept with no Topic, or each stopped. Its Worktrees stay.
 */
export type TopicAction =
  | 'mark-read'
  | 'mark-unread'
  | 'move-up'
  | 'move-down'
  | 'bench'
  | 'make-guest'
  | 'pin'
  | 'unpin'
  | 'settle'
  | 'settle-stopping-sessions'
  | 'forget'
  | 'forget-stopping-sessions';

/** The orders any card can take. Settle and Forget close a Topic, so they take a Topic alone. */
export type CardAction = Exclude<TopicAction, 'settle' | 'settle-stopping-sessions' | 'forget' | 'forget-stopping-sessions'>;

/** The Mac's words for each action. */
export const TOPIC_ACTION_LABEL: Record<TopicAction, string> = {
  'mark-read': 'Mark as Read',
  'mark-unread': 'Mark as Unread',
  'move-up': 'Move Up',
  'move-down': 'Move Down',
  bench: 'Bench',
  'make-guest': 'Make a Guest',
  pin: 'Pin',
  unpin: 'Unpin',
  settle: 'Settle',
  'settle-stopping-sessions': 'Settle and Stop Sessions',
  forget: 'Forget',
  'forget-stopping-sessions': 'Forget and Stop Sessions',
};

/** SF Symbol of each action in the menu. */
export const TOPIC_ACTION_ICON: Record<TopicAction, SFSymbol> = {
  'mark-read': 'envelope.open',
  'mark-unread': 'circle.fill',
  'move-up': 'arrow.up',
  'move-down': 'arrow.down',
  bench: 'tray.and.arrow.down',
  'make-guest': 'person.badge.plus',
  pin: 'pin',
  unpin: 'pin.slash',
  settle: 'checkmark.circle',
  'settle-stopping-sessions': 'stop.circle',
  forget: 'trash',
  'forget-stopping-sessions': 'stop.circle',
};

/**
 * The confirm alert of Settle… and Forget… in a card's menu: the order that
 * keeps the Topic's Sessions running and the one that stops them. Either way
 * the Worktrees stay.
 */
export function closeAlert(close: 'settle' | 'forget', topic: string): {
  title: string;
  message: string;
  keep: Extract<TopicAction, 'settle' | 'forget'>;
  stop: Extract<TopicAction, 'settle-stopping-sessions' | 'forget-stopping-sessions'>;
} {
  return close === 'settle'
    ? {
        title: `Settle ${topic}?`,
        message: 'Settle keeps its Sessions running. Its Worktrees stay in both cases.',
        keep: 'settle',
        stop: 'settle-stopping-sessions',
      }
    : {
        title: `Forget ${topic}?`,
        message: 'Forget removes the Topic for good and keeps its Sessions running. Its Worktrees stay in both cases.',
        keep: 'forget',
        stop: 'forget-stopping-sessions',
      };
}

/** The section of the Host Screen that a card sits in. */
export type CardSection = 'pinned' | 'in-play' | 'guests' | 'bench';

/**
 * The actions the Mac's Sidebar menu offers for a card of this section, as
 * `WorkspaceStore.canBench` and `guestState` say. A Pinned card is never
 * Benched or made a Guest. A Benched card becomes a Guest. A card in a place
 * or among the Guests goes to the Bench. Move Up and Move Down are always offered: the Mac decides at the
 * edges, and a refusal shows its reason. A Pinned card offers Unpin, any other
 * Pin, as the Mac's `pinButton` does. Only a Topic has a mark to read: a Board
 * Session's menu has no Mark as Read.
 */
export function menuActions(card: { kind: 'topic' | 'board-session'; section: CardSection; mark: Mark | null }): CardAction[] {
  const actions: CardAction[] = [];
  const read = card.kind === 'topic' ? readAction(card.mark) : null;
  if (read !== null) actions.push(read);
  actions.push(card.section === 'pinned' ? 'unpin' : 'pin');
  actions.push('move-up', 'move-down');
  if (card.section === 'bench') actions.push('make-guest');
  if (card.section === 'in-play' || card.section === 'guests') actions.push('bench');
  return actions;
}

/**
 * The one button of a Topic card's trailing swipe. A full swipe runs the
 * button, so only Read allows it.
 */
export type SwipeAction = Extract<CardAction, 'mark-read' | 'mark-unread'>;

export function swipeAction(mark: Mark | null): SwipeAction | null {
  return readAction(mark);
}

/**
 * Read on a card whose mark Mark as Read clears: Unread, and a done or failed
 * Agent, which shows only while Unread. Unread on a card with no mark. Neither
 * on a working or blocked Agent: reading does not change those marks.
 */
function readAction(mark: Mark | null): SwipeAction | null {
  switch (mark) {
    case 'unread':
    case 'done':
    case 'failed':
      return 'mark-read';
    case null:
      return 'mark-unread';
    case 'working':
    case 'blocked':
      return null;
  }
}

/** Mail's short words for the swipe buttons. */
export const SWIPE_LABEL: Record<SwipeAction, string> = {
  'mark-read': 'Read',
  'mark-unread': 'Unread',
};
