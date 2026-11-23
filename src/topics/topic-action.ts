import type { SFSymbol } from 'expo-symbols';

import type { BoardCard } from './board-card';
import type { Mark } from './environment';

/**
 * The orders in the long-press menu of a Topic row. Each is one command that
 * the Mac's rules decide: the phone sends it, the Host Server pushes the
 * Listing that shows the result, and the phone never works out where a card
 * lands.
 *
 * Mark as Read and Mark as Unread act on what `READ_SCOPES` names for the
 * card.
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

export type ReadScope = 'topic' | 'topic_mark' | 'session';

export type ReadAction = Extract<CardAction, 'mark-read' | 'mark-unread'>;

/** The kinds of card that have something to read. A Dormant Board Session has no Agents. */
export type ReadableKind = Exclude<BoardCard['kind'], 'dormant-session'>;

export function isReadable(kind: BoardCard['kind']): kind is ReadableKind {
  return kind !== 'dormant-session';
}

/**
 * What Mark as Read and Mark as Unread act on for each kind of card, as the
 * scope of `mark_read` that targets it. Read on a Topic reads the whole Topic,
 * as the Mac's Mark Read does: the Topic mark and the Unread mark of each
 * Agent in its Sessions. Unread on a Topic changes its Topic mark only. A live
 * Board Session has no mark of its own, so both act on the Agents of its
 * Session: Unread makes each Agent that is not working Unread.
 */
export const READ_SCOPES: Record<ReadableKind, Record<ReadAction, ReadScope>> = {
  topic: { 'mark-read': 'topic', 'mark-unread': 'topic_mark' },
  'live-session': { 'mark-read': 'session', 'mark-unread': 'session' },
};

/** A card as its menu and its swipe see it. */
export interface MenuCard {
  kind: BoardCard['kind'];
  section: CardSection;
  mark: Mark | null;
}

/**
 * The actions the Mac's Sidebar menu offers for a card of this section, as
 * `WorkspaceStore.canBench` and `guestState` say. A Pinned card is never
 * Benched or made a Guest. A Benched card becomes a Guest. A card in a place
 * or among the Guests goes to the Bench. Move Up and Move Down are always offered: the Mac decides at the
 * edges, and a refusal shows its reason. A Pinned card offers Unpin, any other
 * Pin, as the Mac's `pinButton` does.
 */
export function menuActions(card: MenuCard): CardAction[] {
  const actions: CardAction[] = [];
  const read = readAction(card);
  if (read !== null) actions.push(read);
  actions.push(card.section === 'pinned' ? 'unpin' : 'pin');
  actions.push('move-up', 'move-down');
  if (card.section === 'bench') actions.push('make-guest');
  if (card.section === 'in-play' || card.section === 'guests') actions.push('bench');
  return actions;
}

/**
 * Read on a card whose mark Mark as Read clears: Unread, and a done or failed
 * Agent, which shows only while Unread. Unread on a card with no mark. Neither
 * on a working or blocked Agent: reading does not change those marks. Neither
 * on a card with nothing to read. The card's menu and its trailing swipe both
 * offer it.
 */
export function readAction(card: Pick<MenuCard, 'kind' | 'mark'>): ReadAction | null {
  if (!isReadable(card.kind)) return null;
  switch (card.mark) {
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

/** A full swipe runs the swipe's button, so only Read allows it. */
export function allowsFullSwipe(action: ReadAction): boolean {
  return action === 'mark-read';
}

/** Mail's short words for the swipe buttons. */
export const SWIPE_LABEL: Record<ReadAction, string> = {
  'mark-read': 'Read',
  'mark-unread': 'Unread',
};
