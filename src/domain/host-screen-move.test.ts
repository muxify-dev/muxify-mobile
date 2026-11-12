import type { TopicId } from '@/topics/environment';
import type { CardSection } from '@/topics/topic-action';
import { dropCommand } from '@/topics/topic-drop';

import type { HostScreenRow, HostScreenSection } from './host-screen';
import { fillChoices, moveTargetLabel, moveTargets, type MoveTarget } from './host-screen-move';

const topic = (id: string, section: CardSection, pinned = section === 'pinned'): HostScreenRow =>
  ({ kind: 'topic', id: id as TopicId, label: id, section, pinned }) as HostScreenRow;
const locked = (name: string): HostScreenRow => ({ kind: 'locked-session', name, mark: null, pinned: false });
const open = (id: string): HostScreenRow => ({ kind: 'open-place', id });
const section = (id: HostScreenSection['id'], rows: HostScreenRow[]): HostScreenSection => ({
  id,
  title: id,
  footer: null,
  rows,
});

/**
 * PinA and PinB are Pinned. In Play has P1, an Open Place and P3. The Guests
 * are G1 and a Locked Session. The Bench has B1, a card this phone does not
 * know, and B2.
 */
const IN_PLAY: HostScreenSection[] = [
  section('pinned', [topic('PinA', 'pinned'), topic('PinB', 'pinned')]),
  section('in-play', [topic('P1', 'in-play'), open('open-2'), topic('P3', 'in-play')]),
  section('guests', [topic('G1', 'guests'), locked('lock')]),
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
    case 'locked-session':
      return row.name;
    case 'open-place':
      return 'Open Place';
    default:
      return row.kind;
  }
}

function command(target: MoveTarget): string {
  return target.kind === 'drop' ? dropCommand(target.drop) : `topic ${target.action}`;
}

/** Each row's button and the command it sends, as the user of the Host Screen meets them. */
function offered(sections: HostScreenSection[], picked: string): Record<string, string> {
  const { rows, headers } = moveTargets(sections, picked as TopicId);
  const out: Record<string, string> = {};
  for (const [row, target] of rows) out[name(row)] = `${moveTargetLabel(target)}: ${command(target)}`;
  for (const [id, target] of headers) out[`${id} header`] = `${moveTargetLabel(target)}: ${command(target)}`;
  return out;
}

describe('the targets for a Benched card', () => {
  it('moves it above or below the cards of the Bench, Trades with the others and Fills the Open Place', () => {
    expect(offered(IN_PLAY, 'B2')).toEqual({
      B1: "Move above: topic move --before 'B1'",
      P1: "Trade: topic move --trade-with 'P1'",
      'Open Place': 'Fill: topic fill-place 2',
      P3: "Trade: topic move --trade-with 'P3'",
      G1: "Trade: topic move --trade-with 'G1'",
      lock: "Trade: topic move --trade-with-session 'lock'",
      'guests header': 'Make a Guest: topic make-guest',
    });
  });

  it('moves the top card below each card under it', () => {
    expect(offered(IN_PLAY, 'B1')).toMatchObject({ B2: "Move below: topic move --after 'B2'" });
  });
});

describe('the targets for a card In Play', () => {
  it('moves it next to an Open Place of its own section by the place id, and offers the Bench', () => {
    expect(offered(IN_PLAY, 'P1')).toEqual({
      'Open Place': "Move below: topic move --after-place 'open-2'",
      P3: "Move below: topic move --after 'P3'",
      G1: "Trade: topic move --trade-with 'G1'",
      lock: "Trade: topic move --trade-with-session 'lock'",
      B1: "Trade: topic move --trade-with 'B1'",
      B2: "Trade: topic move --trade-with 'B2'",
      bench: 'Bench: topic bench',
    });
  });
});

describe('Pinned cards', () => {
  it('move only among the Pinned cards', () => {
    expect(offered(IN_PLAY, 'PinB')).toEqual({ PinA: "Move above: topic move --before 'PinA'" });
  });

  it('are no target for an unpinned card', () => {
    expect(Object.keys(offered(IN_PLAY, 'G1'))).not.toContain('PinA');
  });
});

it('offers nothing for a Topic the sections do not show', () => {
  expect(offered(IN_PLAY, 'gone')).toEqual({});
});

describe('the Topics a tap on an Open Place offers', () => {
  const labels = (rows: HostScreenRow[]) => rows.map(name);

  it('offers the Guest and Benched Topics, to fill the place by its number', () => {
    const choices = fillChoices(IN_PLAY, 'open-2');
    expect(choices && { place: choices.place, guests: labels(choices.guests), bench: labels(choices.bench) }).toEqual({
      place: 2,
      guests: ['G1'],
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
