import type { Mark } from './environment';
import {
  menuActions,
  swipeAction,
  type CardSection,
  type SwipeAction,
  type TopicAction,
} from './topic-action';

const offered = (section: CardSection, mark: Mark | null = null) => menuActions({ section, mark });

describe('what the menu of a Topic card offers', () => {
  it.each<[CardSection, TopicAction[]]>([
    ['pinned', ['mark-unread', 'move-up', 'move-down']],
    ['in-play', ['mark-unread', 'move-up', 'move-down', 'bench']],
    ['guests', ['mark-unread', 'move-up', 'move-down', 'bench']],
    ['bench', ['mark-unread', 'move-up', 'move-down', 'make-guest']],
  ])('in %s', (section, expected) => {
    expect(offered(section)).toEqual(expected);
  });

  it('offers Mark as Read, not Mark as Unread, on an Unread card', () => {
    expect(offered('in-play', 'unread')).toEqual(['mark-read', 'move-up', 'move-down', 'bench']);
  });

  it('offers Mark as Read on an Unread Pinned card', () => {
    expect(offered('pinned', 'unread')).toEqual(['mark-read', 'move-up', 'move-down']);
  });

  it.each<Mark>(['done', 'failed'])('offers Mark as Read on a card with a %s Agent, which shows only while Unread', (mark) => {
    expect(offered('in-play', mark)).toEqual(['mark-read', 'move-up', 'move-down', 'bench']);
  });

  it.each<Mark>(['working', 'blocked'])('offers neither on a card with a %s Agent', (mark) => {
    expect(offered('in-play', mark)).toEqual(['move-up', 'move-down', 'bench']);
  });
});

describe('the trailing swipe of a Topic card', () => {
  it.each<[Mark | null, SwipeAction | null]>([
    ['unread', 'mark-read'],
    [null, 'mark-unread'],
    ['done', 'mark-read'],
    ['failed', 'mark-read'],
    ['working', null],
    ['blocked', null],
  ])('with mark %s offers %s', (mark, expected) => {
    expect(swipeAction(mark)).toBe(expected);
  });
});
