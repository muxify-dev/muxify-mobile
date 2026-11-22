import type { BoardSessionId, SessionId, TopicId } from './environment';
import type { WriteTarget } from './host-write-request';
import type { DropAnchor } from './topic-drop';

/**
 * A card on the Board that a write can name: a Topic, or a Board Session. The
 * wire names a live Board Session only by its tmux id and a Dormant one only by
 * its Board Session id, so the two are two kinds here.
 */
export type BoardCard =
  | { kind: 'topic'; id: TopicId }
  | { kind: 'live-session'; session: SessionId }
  | { kind: 'dormant-session'; id: BoardSessionId };

export type BoardSessionCard = Exclude<BoardCard, { kind: 'topic' }>;

/** What an `environment` request that acts on the card targets. */
export function cardTarget(card: BoardCard): WriteTarget {
  switch (card.kind) {
    case 'topic':
      return { topic: card.id };
    case 'live-session':
      return { session: card.session };
    case 'dormant-session':
      return { board_session: card.id };
  }
}

/** A card as a move or a Trade names it on the wire, MuxifyCore's `BoardCardRef`. */
export function cardRef(anchor: DropAnchor): object {
  switch (anchor.kind) {
    case 'topic':
      return { topic: { ref: { id: anchor.id } } };
    case 'live-session':
      return { lock: { session: anchor.session } };
    case 'dormant-session':
      return { board_session: { id: anchor.id } };
    case 'open-place':
      return { openPlace: { id: anchor.id } };
  }
}

/**
 * The key a screen keeps a card's running write and spinner under. A live
 * Board Session shares its tmux id with the Session's own writes, so a Session
 * Action on it shows on the card too. The prefix keeps a Board Session id
 * apart from a Topic id.
 */
export function cardKey(card: BoardCard): string {
  switch (card.kind) {
    case 'topic':
      return card.id;
    case 'live-session':
      return card.session;
    case 'dormant-session':
      return `board-session:${card.id}`;
  }
}
