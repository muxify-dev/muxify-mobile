import type { SFSymbol } from 'expo-symbols';

import type { Mark } from './environment';

/**
 * The orders in the long-press menu of a Topic row. Each is one `muxify topic`
 * command that the Mac's rules decide: the phone sends it and reads the
 * Listing again, and never works out where a card lands.
 *
 * Mark as Read reads the whole Topic, as the Mac's Mark Read does: the Topic
 * mark and the Unread mark of each Agent in its Sessions. Mark as Unread
 * changes the Topic mark only, so the phone never makes an Agent Unread.
 */
export type TopicAction =
  | 'mark-read'
  | 'mark-unread'
  | 'move-up'
  | 'move-down'
  | 'bench'
  | 'make-guest'
  | 'settle'
  | 'settle-stopping-sessions';

/** The subcommand of one action, before the `--topic` that names the Topic. */
export function topicActionCommand(action: TopicAction): string {
  switch (action) {
    case 'mark-read':
      return 'topic mark-read';
    case 'mark-unread':
      return 'topic mark-unread --topic-only';
    case 'move-up':
      return 'topic move up';
    case 'move-down':
      return 'topic move down';
    case 'bench':
      return 'topic bench';
    case 'make-guest':
      return 'topic make-guest';
    case 'settle':
      return 'topic settle';
    case 'settle-stopping-sessions':
      return 'topic settle --kill-sessions';
  }
}

/** The Mac's words for each action. */
export const TOPIC_ACTION_LABEL: Record<TopicAction, string> = {
  'mark-read': 'Mark as Read',
  'mark-unread': 'Mark as Unread',
  'move-up': 'Move Up',
  'move-down': 'Move Down',
  bench: 'Bench',
  'make-guest': 'Make a Guest',
  settle: 'Settle',
  'settle-stopping-sessions': 'Settle and Stop Sessions',
};

/** SF Symbol of each action in the menu. */
export const TOPIC_ACTION_ICON: Record<TopicAction, SFSymbol> = {
  'mark-read': 'envelope.open',
  'mark-unread': 'circle.fill',
  'move-up': 'arrow.up',
  'move-down': 'arrow.down',
  bench: 'tray.and.arrow.down',
  'make-guest': 'person.badge.plus',
  settle: 'checkmark.circle',
  'settle-stopping-sessions': 'stop.circle',
};

/** The section of the Host Screen that a Topic card sits in. */
export type CardSection = 'pinned' | 'in-play' | 'guests' | 'bench';

/**
 * The actions the Mac's Sidebar menu offers for a card of this section, as
 * `WorkspaceStore.canBench` and `guestState` say. A Pinned card is never
 * Benched or made a Guest. A Benched card becomes a Guest. A card in a place
 * or among the Guests goes to the Bench. Move Up and Move Down are always offered: the Mac decides at the
 * edges, and a refusal shows its reason.
 */
export function menuActions(card: { section: CardSection; mark: Mark | null }): TopicAction[] {
  const actions: TopicAction[] = [];
  const read = readAction(card.mark);
  if (read !== null) actions.push(read);
  actions.push('move-up', 'move-down');
  if (card.section === 'bench') actions.push('make-guest');
  if (card.section === 'in-play' || card.section === 'guests') actions.push('bench');
  return actions;
}

/**
 * The one button of a Topic card's trailing swipe. A full swipe runs the
 * button, so only Read allows it.
 */
export type SwipeAction = Extract<TopicAction, 'mark-read' | 'mark-unread'>;

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
