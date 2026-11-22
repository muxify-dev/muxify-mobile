import type { BoardCard } from '@/topics/board-card';
import type { BoardSessionId, SessionId, TopicId } from '@/topics/environment';
import type { CardSection } from '@/topics/topic-action';
import type { DropAnchor } from '@/topics/topic-drop';

import type { HostScreenRow, HostScreenSection } from './host-screen';
import { fillChoices, moveTargetLabel, moveTargets, type MoveTarget } from './host-screen-move';

const topic = (id: string, section: CardSection, pinned = section === 'pinned'): HostScreenRow =>
  ({ kind: 'topic', id: id as TopicId, label: id, section, pinned }) as HostScreenRow;
const live = (name: string, session: string, section: CardSection): HostScreenRow =>
  ({ kind: 'board-session', card: { kind: 'live-session', session: session as SessionId }, name, mark: null, pinned: section === 'pinned', section });
const dormant = (name: string, id: string, section: CardSection): HostScreenRow =>
  ({ kind: 'board-session', card: { kind: 'dormant-session', id: id as BoardSessionId }, name, mark: null, pinned: section === 'pinned', section });
const open = (id: string): HostScreenRow => ({ kind: 'open-place', id });
const section = (id: HostScreenSection['id'], rows: HostScreenRow[]): HostScreenSection => ({
  id,
  title: id,
  rows,
});

/**
 * PinA, PinB and the Dormant Board Session logs are Pinned. In Play has P1,
 * an Open Place and P3. The Guests are G1, the live Board Session docs and
 * the Dormant Board Session notes. The Bench has B1, a card this phone does
 * not know, and B2.
 */
const IN_PLAY: HostScreenSection[] = [
  section('pinned', [topic('PinA', 'pinned'), topic('PinB', 'pinned'), dormant('logs', 's4', 'pinned')]),
  section('in-play', [topic('P1', 'in-play'), open('open-2'), topic('P3', 'in-play')]),
  section('guests', [topic('G1', 'guests'), live('docs', '$9', 'guests'), dormant('notes', 's1', 'guests')]),
  section('bench', [
    { kind: 'bench', opened: true },
    topic('B1', 'bench'),
    { kind: 'unknown-card', text: 'new kind' },
    topic('B2', 'bench'),
  ]),
];

function name(row: HostScreenRow): string {
  switch (row.kind) {
    case 'topic':
      return row.label;
    case 'board-session':
      return row.name;
    case 'open-place':
      return 'Open Place';
    default:
      return row.kind;
  }
}

/** The card a drop names, as the wire tells the kinds apart. */
function anchorName(anchor: DropAnchor): string {
  switch (anchor.kind) {
    case 'topic':
      return `topic ${anchor.id}`;
    case 'live-session':
      return `session ${anchor.session}`;
    case 'dormant-session':
      return `board session ${anchor.id}`;
    case 'open-place':
      return `place ${anchor.id}`;
  }
}

function command(target: MoveTarget): string {
  if (target.kind === 'order') return target.action;
  const { drop } = target;
  switch (drop.kind) {
    case 'place':
      return `${drop.side} ${anchorName(drop.anchor)}`;
    case 'trade':
      return `trade with ${anchorName(drop.with)}`;
    case 'fill':
      return `fill place ${drop.place}`;
  }
}

/** Each row's button and the command it sends, as the user of the Host Screen meets them. */
function offered(sections: HostScreenSection[], picked: string | BoardCard): Record<string, string> {
  const card: BoardCard = typeof picked === 'string' ? { kind: 'topic', id: picked as TopicId } : picked;
  const { rows, headers } = moveTargets(sections, card);
  const out: Record<string, string> = {};
  for (const [row, target] of rows) out[name(row)] = `${moveTargetLabel(target)}: ${command(target)}`;
  for (const [id, target] of headers) out[`${id} header`] = `${moveTargetLabel(target)}: ${command(target)}`;
  return out;
}

describe('the targets for a Benched card', () => {
  it('moves it above or below the cards of the Bench, Trades with the others and Fills the Open Place', () => {
    expect(offered(IN_PLAY, 'B2')).toEqual({
      B1: 'Move above: before topic B1',
      P1: 'Trade: trade with topic P1',
      'Open Place': 'Fill: fill place 2',
      P3: 'Trade: trade with topic P3',
      G1: 'Trade: trade with topic G1',
      docs: 'Trade: trade with session $9',
      notes: 'Trade: trade with board session s1',
      'guests header': 'Make a Guest: make-guest',
    });
  });

  it('moves the top card below each card under it', () => {
    expect(offered(IN_PLAY, 'B1')).toMatchObject({ B2: 'Move below: after topic B2' });
  });
});

describe('the targets for a card In Play', () => {
  it('moves it next to an Open Place of its own section by the place id, and offers the Bench', () => {
    expect(offered(IN_PLAY, 'P1')).toEqual({
      'Open Place': 'Move below: after place open-2',
      P3: 'Move below: after topic P3',
      G1: 'Trade: trade with topic G1',
      docs: 'Trade: trade with session $9',
      notes: 'Trade: trade with board session s1',
      B1: 'Trade: trade with topic B1',
      B2: 'Trade: trade with topic B2',
      bench: 'Bench: bench',
    });
  });
});

describe('the targets for a Board Session card', () => {
  it('moves a live one among the Guests, Trades and Fills across the lines, and offers the Bench', () => {
    expect(offered(IN_PLAY, { kind: 'live-session', session: '$9' as SessionId })).toEqual({
      G1: 'Move above: before topic G1',
      notes: 'Move below: after board session s1',
      P1: 'Trade: trade with topic P1',
      'Open Place': 'Fill: fill place 2',
      P3: 'Trade: trade with topic P3',
      B1: 'Trade: trade with topic B1',
      B2: 'Trade: trade with topic B2',
      bench: 'Bench: bench',
    });
  });

  it('moves a Dormant Guest the same way, by its Board Session id', () => {
    expect(offered(IN_PLAY, { kind: 'dormant-session', id: 's1' as BoardSessionId })).toMatchObject({
      G1: 'Move above: before topic G1',
      docs: 'Move above: before session $9',
      'Open Place': 'Fill: fill place 2',
    });
  });

  it('moves a Pinned one only among the Pinned cards', () => {
    expect(offered(IN_PLAY, { kind: 'dormant-session', id: 's4' as BoardSessionId })).toEqual({
      PinA: 'Move above: before topic PinA',
      PinB: 'Move above: before topic PinB',
    });
  });
});

describe('Pinned cards', () => {
  it('move only among the Pinned cards', () => {
    expect(offered(IN_PLAY, 'PinB')).toEqual({
      PinA: 'Move above: before topic PinA',
      logs: 'Move below: after board session s4',
    });
  });

  it('are no target for an unpinned card', () => {
    expect(Object.keys(offered(IN_PLAY, 'G1'))).not.toContain('PinA');
    expect(Object.keys(offered(IN_PLAY, 'G1'))).not.toContain('logs');
  });
});

it('offers nothing for a card the sections do not show', () => {
  expect(offered(IN_PLAY, 'gone')).toEqual({});
});

describe('the cards a tap on an Open Place offers', () => {
  const labels = (rows: HostScreenRow[]) => rows.map(name);

  it('offers the Guest and Benched cards, Board Sessions too, to fill the place by its number', () => {
    const choices = fillChoices(IN_PLAY, 'open-2');
    expect(choices && { place: choices.place, guests: labels(choices.guests), bench: labels(choices.bench) }).toEqual({
      place: 2,
      guests: ['G1', 'docs', 'notes'],
      bench: ['B1', 'B2'],
    });
  });

  it('counts the place among the In Play places only', () => {
    const sections = [
      IN_PLAY[0],
      section('in-play', [open('open-1'), topic('P1', 'in-play'), open('open-3')]),
      ...IN_PLAY.slice(2),
    ];
    expect(fillChoices(sections, 'open-3')?.place).toBe(3);
  });

  it('offers nothing once the Open Place is gone from the Listing', () => {
    expect(fillChoices(IN_PLAY, 'filled-since')).toBeNull();
  });
});
