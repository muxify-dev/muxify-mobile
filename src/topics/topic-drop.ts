import { shellQuote } from '@/tmux/commands';

import type { TopicId } from './environment';

/** A card that a dragged Topic card can go next to, by the name the Mac's CLI takes for it. */
export type DropAnchor =
  | { kind: 'topic'; id: TopicId }
  | { kind: 'locked-session'; name: string }
  /** The id that `environment show` gives the Open Place. */
  | { kind: 'open-place'; id: string };

/** A card that holds something, which a Trade can exchange. An Open Place holds nothing: a card fills it. */
export type TradePartner = Exclude<DropAnchor, { kind: 'open-place' }>;

/**
 * Where a dragged Topic card was dropped, as the Mac's Sidebar drag reads it.
 * Each is one `muxify topic` command that the Mac's rules decide: the phone
 * sends it and reads the Listing again.
 */
export type Drop =
  /** In its own section, next to another card. */
  | { kind: 'place'; side: 'before' | 'after'; anchor: DropAnchor }
  /** Across the Guests line or the Bench line, on a card: the two exchange their places. */
  | { kind: 'trade'; with: TradePartner }
  /** Across a line, on an Open Place. `place` counts the In Play places from 1. */
  | { kind: 'fill'; place: number };

/** The subcommand of one drop, before the `--topic` that names the dragged Topic. */
export function dropCommand(drop: Drop): string {
  switch (drop.kind) {
    case 'place':
      return `topic move --${drop.side}${ANCHOR_OPTION[drop.anchor.kind]} ${shellQuote(anchorName(drop.anchor))}`;
    case 'trade':
      return `topic move --trade-with${ANCHOR_OPTION[drop.with.kind]} ${shellQuote(anchorName(drop.with))}`;
    case 'fill':
      return `topic fill-place ${drop.place}`;
  }
}

/** What follows `--before`, `--after` or `--trade-with` for each kind of card. */
const ANCHOR_OPTION: Record<DropAnchor['kind'], string> = {
  topic: '',
  'locked-session': '-session',
  'open-place': '-place',
};

function anchorName(anchor: DropAnchor): string {
  switch (anchor.kind) {
    case 'topic':
    case 'open-place':
      return anchor.id;
    case 'locked-session':
      return anchor.name;
  }
}

/** What a refused drop could not do, after "Could not". */
export const DROP_LABEL: Record<Drop['kind'], string> = {
  place: 'Move the Topic',
  trade: 'Trade the Topics',
  fill: 'Fill the Open Place',
};
