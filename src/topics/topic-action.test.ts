import type { Mark } from './environment';
import {
  closeAlert,
  menuActions,
  swipeAction,
  type CardSection,
  type SwipeAction,
  type TopicAction,
  TOPIC_ACTION_LABEL,
} from './topic-action';

const offered = (section: CardSection, mark: Mark | null = null) => menuActions({ kind: 'topic', section, mark });

describe('what the menu of a Topic card offers', () => {
  it.each<[CardSection, TopicAction[]]>([
    ['pinned', ['mark-unread', 'unpin', 'move-up', 'move-down']],
    ['in-play', ['mark-unread', 'pin', 'move-up', 'move-down', 'bench']],
    ['guests', ['mark-unread', 'pin', 'move-up', 'move-down', 'bench']],
    ['bench', ['mark-unread', 'pin', 'move-up', 'move-down', 'make-guest']],
  ])('in %s', (section, expected) => {
    expect(offered(section)).toEqual(expected);
  });

  it('offers Mark as Read, not Mark as Unread, on an Unread card', () => {
    expect(offered('in-play', 'unread')).toEqual(['mark-read', 'pin', 'move-up', 'move-down', 'bench']);
  });

  it('offers Mark as Read on an Unread Pinned card', () => {
    expect(offered('pinned', 'unread')).toEqual(['mark-read', 'unpin', 'move-up', 'move-down']);
  });

  it.each<Mark>(['done', 'failed'])('offers Mark as Read on a card with a %s Agent, which shows only while Unread', (mark) => {
    expect(offered('in-play', mark)).toEqual(['mark-read', 'pin', 'move-up', 'move-down', 'bench']);
  });

  it.each<Mark>(['working', 'blocked'])('offers neither on a card with a %s Agent', (mark) => {
    expect(offered('in-play', mark)).toEqual(['pin', 'move-up', 'move-down', 'bench']);
  });

  it.each<CardSection>(['in-play', 'guests', 'bench'])('offers Pin, not Unpin, in %s', (section) => {
    expect(offered(section)).toContain('pin');
    expect(offered(section)).not.toContain('unpin');
  });

  it('offers Unpin, not Pin, on a Pinned card', () => {
    expect(offered('pinned')).toContain('unpin');
    expect(offered('pinned')).not.toContain('pin');
  });
});

describe('what the menu of a Board Session card offers', () => {
  it.each<[CardSection, TopicAction[]]>([
    ['pinned', ['unpin', 'move-up', 'move-down']],
    ['in-play', ['pin', 'move-up', 'move-down', 'bench']],
    ['guests', ['pin', 'move-up', 'move-down', 'bench']],
  ])('in %s, with no Mark as Read and no Bench on a Pinned card', (section, expected) => {
    expect(menuActions({ kind: 'board-session', section, mark: null })).toEqual(expected);
    expect(menuActions({ kind: 'board-session', section, mark: 'unread' })).toEqual(expected);
  });
});

describe('the confirm alert of Settle… and Forget…', () => {
  it('offers Settle and Settle and Stop Sessions, and says the Worktrees stay', () => {
    expect(closeAlert('settle', 'Fix login')).toEqual({
      title: 'Settle Fix login?',
      message: 'Settle keeps its Sessions running. Its Worktrees stay in both cases.',
      keep: 'settle',
      stop: 'settle-stopping-sessions',
    });
  });

  it('offers Forget and Forget and Stop Sessions, and says the Worktrees stay as Settle does', () => {
    const alert = closeAlert('forget', 'Fix login');
    expect(alert).toMatchObject({ title: 'Forget Fix login?', keep: 'forget', stop: 'forget-stopping-sessions' });
    expect(alert.message).toContain('keeps its Sessions running');
    expect(alert.message).toContain('Its Worktrees stay in both cases.');
    expect(TOPIC_ACTION_LABEL[alert.keep]).toBe('Forget');
    expect(TOPIC_ACTION_LABEL[alert.stop]).toBe('Forget and Stop Sessions');
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
