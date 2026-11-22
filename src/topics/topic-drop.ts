import type { BoardCard } from './board-card';

/** A card that a moved card can go next to: a Topic, a Board Session, or an Open Place by the id `environment show` gives it. */
export type DropAnchor = BoardCard | { kind: 'open-place'; id: string };

/** A card that holds something, which a Trade can exchange. An Open Place holds nothing: a card fills it. */
export type TradePartner = BoardCard;

/**
 * Where a moved card was dropped, as the Mac's Sidebar drag reads it. Each is
 * one command that the Mac's rules decide: the phone sends it, and the Host
 * Server pushes the Listing that shows the result.
 */
export type Drop =
  /** In its own section, next to another card. */
  | { kind: 'place'; side: 'before' | 'after'; anchor: DropAnchor }
  /** Across the Guests line or the Bench line, on a card: the two exchange their places. */
  | { kind: 'trade'; with: TradePartner }
  /** Across a line, on an Open Place. `place` counts the In Play places from 1. */
  | { kind: 'fill'; place: number };

/** What a refused drop could not do, after "Could not". */
export const DROP_LABEL: Record<Drop['kind'], string> = {
  place: 'Move the card',
  trade: 'Trade the cards',
  fill: 'Fill the Open Place',
};
