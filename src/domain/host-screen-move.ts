import type { TopicId } from '@/topics/environment';
import type { Drop, DropAnchor } from '@/topics/topic-drop';

import type { HostScreenRow, HostScreenSection } from './host-screen';

/**
 * What a tap on one row does while the user moves a Topic card. Each target is
 * one `muxify topic` command that the Mac's rules decide: a drop of the card
 * next to, onto or into another card, or one of the menu's orders.
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

/** A row that is one card of the Topics list. */
type CardRow = Extract<HostScreenRow, { kind: 'topic' | 'locked-session' | 'open-place' | 'unknown-card' }>;

/**
 * Cards that a move keeps a card among. A card moves anywhere in its own
 * group. In Play, the Guests and the Bench also reach each other across the
 * Mac's lines: a Trade, or a Fill of an Open Place. The Pinned cards are a
 * group of their own, so a card never goes onto or off a Pinned card.
 */
interface Group {
  section: HostScreenSection['id'];
  cards: CardRow[];
  acrossLines: boolean;
}

/**
 * The target of every row for the picked Topic card, from the sections the
 * Host Screen draws with the Bench opened. The picked card and a row that no
 * command can name have none. No target is a move that would do nothing.
 */
export function moveTargets(sections: HostScreenSection[], picked: TopicId): MoveTargets {
  const rows = new Map<HostScreenRow, MoveTarget>();
  const headers = new Map<HostScreenSection['id'], MoveTarget>();
  const groups = sections.flatMap(groupsOf);
  const home = groups.find((group) => group.cards.some((card) => isPicked(card, picked)));
  if (home === undefined) return { rows, headers };

  const from = home.cards.findIndex((card) => isPicked(card, picked));
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

type TopicCard = Extract<HostScreenRow, { kind: 'topic' }>;

/** What a tap on an Open Place offers: the Topics that can go in, and the place they fill. */
export interface FillChoices {
  /** The Open Place, counted from 1 among the In Play places, as `topic fill-place` takes it. */
  place: number;
  guests: TopicCard[];
  bench: TopicCard[];
}

/**
 * The Topic cards that can fill the Open Place `placeId`, from the sections
 * the Host Screen draws with the Bench opened: the Guest and Benched Topics,
 * Dormant ones too, as `topic fill-place` takes them. A Locked Session cannot
 * be named to fill a place, and a Pinned card stays in its Pin group. Null when
 * the Open Place is gone from the Listing.
 */
export function fillChoices(sections: HostScreenSection[], placeId: string): FillChoices | null {
  const places = sections.find((section) => section.id === 'in-play')?.rows.filter(isCard) ?? [];
  const index = places.findIndex((card) => card.kind === 'open-place' && card.id === placeId);
  if (index === -1) return null;
  const topicsOf = (id: HostScreenSection['id']) =>
    sections.find((section) => section.id === id)?.rows.filter((row): row is TopicCard => row.kind === 'topic') ?? [];
  return { place: index + 1, guests: topicsOf('guests'), bench: topicsOf('bench') };
}

function groupsOf(section: HostScreenSection): Group[] {
  const cards = section.rows.filter(isCard);
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

function isCard(row: HostScreenRow): row is CardRow {
  return (
    row.kind === 'topic' || row.kind === 'locked-session' || row.kind === 'open-place' || row.kind === 'unknown-card'
  );
}

function isPicked(card: CardRow, picked: TopicId): boolean {
  return card.kind === 'topic' && card.id === picked;
}

/** The name the Mac's CLI takes for a card, or null for a card this phone does not know. */
function anchorOf(card: CardRow): DropAnchor | null {
  switch (card.kind) {
    case 'topic':
      return { kind: 'topic', id: card.id };
    case 'locked-session':
      return { kind: 'locked-session', name: card.name };
    case 'open-place':
      return { kind: 'open-place', id: card.id };
    case 'unknown-card':
      return null;
  }
}
