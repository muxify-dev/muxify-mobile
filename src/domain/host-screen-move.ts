import { cardKey, type BoardCard } from '@/topics/board-card';
import type { Drop, DropAnchor } from '@/topics/topic-drop';

import { rowCard, type CardRow, type HostScreenRow, type HostScreenSection } from './host-screen';

/**
 * What a tap on a target sends: one Host Write that the Mac's rules decide, a
 * drop of the card next to, onto or into another card, or one of the menu's
 * orders.
 */
export type MoveTarget =
  | { kind: 'drop'; drop: Drop }
  | { kind: 'order'; action: 'bench' | 'make-guest' };

export interface MoveTargets {
  /** The target of each row that has one, by the row the Host Screen draws. */
  rows: ReadonlyMap<HostScreenRow, MoveTarget>;
  /** The target on a section's header: Make a Guest on the Guests header. */
  headers: ReadonlyMap<HostScreenSection['id'], MoveTarget>;
}

/** The words on a target, as the user reads them before the tap. */
export function moveTargetLabel(target: MoveTarget): string {
  if (target.kind === 'order') return target.action === 'bench' ? 'Bench' : 'Make a Guest';
  switch (target.drop.kind) {
    case 'place':
      return target.drop.side === 'before' ? 'Move above' : 'Move below';
    case 'trade':
      return 'Trade';
    case 'fill':
      return 'Fill';
  }
}

/** A row that is one card of the Board. */
type BoardRow = Extract<HostScreenRow, { kind: 'topic' | 'board-session' | 'open-place' | 'unknown-card' }>;

/**
 * Cards that a move keeps a card among. A card moves anywhere in its own
 * group. In Play, the Guests and the Bench also reach each other across the
 * Mac's lines: a Trade, or a Fill of an Open Place. The Pinned cards are a
 * group of their own, so a card never goes onto or off a Pinned card.
 */
interface Group {
  section: HostScreenSection['id'];
  cards: BoardRow[];
  acrossLines: boolean;
}

/**
 * The target of every row for the picked card, a Topic or a Board Session,
 * from the sections the Host Screen draws with the Bench opened. The picked
 * card and a row that no command can name have none. No target is a move
 * that would do nothing.
 */
export function moveTargets(sections: HostScreenSection[], picked: BoardCard): MoveTargets {
  const rows = new Map<HostScreenRow, MoveTarget>();
  const headers = new Map<HostScreenSection['id'], MoveTarget>();
  const groups = sections.flatMap(groupsOf);
  const isPicked = (card: BoardRow) => isCard(card, picked);
  const home = groups.find((group) => group.cards.some(isPicked));
  if (home === undefined) return { rows, headers };

  const from = home.cards.findIndex(isPicked);
  home.cards.forEach((card, index) => {
    const anchor = anchorOf(card);
    if (index === from || anchor === null) return;
    const side = index < from ? 'before' : 'after';
    rows.set(card, { kind: 'drop', drop: { kind: 'place', side, anchor } });
  });

  if (!home.acrossLines) return { rows, headers };
  for (const group of groups) {
    if (group === home || !group.acrossLines) continue;
    group.cards.forEach((card, index) => {
      const anchor = anchorOf(card);
      if (anchor === null) return;
      rows.set(card, {
        kind: 'drop',
        drop: anchor.kind === 'open-place' ? { kind: 'fill', place: index + 1 } : { kind: 'trade', with: anchor },
      });
    });
  }

  if (home.section === 'bench' && groups.some((group) => group.section === 'guests')) {
    headers.set('guests', { kind: 'order', action: 'make-guest' });
  }
  const benchRow = sections.find((section) => section.id === 'bench')?.rows.find((row) => row.kind === 'bench');
  if (benchRow !== undefined && home.section !== 'bench') rows.set(benchRow, { kind: 'order', action: 'bench' });
  return { rows, headers };
}

/** The row of `card` among the sections, or undefined once a pushed Listing has dropped it. */
export function findCardRow(sections: HostScreenSection[], card: BoardCard): CardRow | undefined {
  return sections
    .flatMap((section) => section.rows)
    .find((row): row is CardRow => isCard(row, card));
}

/** What a tap on an Open Place offers: the cards that can go in, and the place they fill. */
export interface FillChoices {
  /** The Open Place, counted from 1 among the In Play places, as `fill_open_place` takes it. */
  place: number;
  guests: CardRow[];
  bench: CardRow[];
}

/**
 * The cards that can fill the Open Place `placeId`, from the sections the
 * Host Screen draws with the Bench opened: the Guest and Benched Topics and
 * Board Sessions, Dormant ones too, as `fill_open_place` takes them. A Pinned
 * card stays in its Pin group. Null when the Open Place is gone from the
 * Listing.
 */
export function fillChoices(sections: HostScreenSection[], placeId: string): FillChoices | null {
  const places = sections.find((section) => section.id === 'in-play')?.rows.filter(isBoardRow) ?? [];
  const index = places.findIndex((card) => card.kind === 'open-place' && card.id === placeId);
  if (index === -1) return null;
  const cardsOf = (id: HostScreenSection['id']) =>
    sections.find((section) => section.id === id)?.rows.filter((row): row is CardRow => rowCard(row) !== null) ?? [];
  return { place: index + 1, guests: cardsOf('guests'), bench: cardsOf('bench') };
}

function groupsOf(section: HostScreenSection): Group[] {
  const cards = section.rows.filter(isBoardRow);
  if (cards.length === 0) return [];
  switch (section.id) {
    case 'pinned':
      return [{ section: section.id, cards, acrossLines: false }];
    case 'in-play':
    case 'guests':
    case 'bench':
      return [{ section: section.id, cards, acrossLines: true }];
    default:
      return [];
  }
}

function isBoardRow(row: HostScreenRow): row is BoardRow {
  return (
    row.kind === 'topic' || row.kind === 'board-session' || row.kind === 'open-place' || row.kind === 'unknown-card'
  );
}

function isCard(row: HostScreenRow, card: BoardCard): boolean {
  const its = rowCard(row);
  return its !== null && cardKey(its) === cardKey(card);
}

/** The card a drop names, or null for a card this phone does not know. */
function anchorOf(card: BoardRow): DropAnchor | null {
  switch (card.kind) {
    case 'topic':
    case 'board-session':
      return rowCard(card);
    case 'open-place':
      return { kind: 'open-place', id: card.id };
    case 'unknown-card':
      return null;
  }
}
