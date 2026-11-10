import { paneForSwipe } from './pane-swipe';
import type { Pane } from './tmux-client';

function panes(count: number, active: number): Pane[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    id: `%${index}`,
    command: 'zsh',
    active: index === active,
    path: '/',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
  }));
}

describe('paneForSwipe', () => {
  it('goes to the next Pane on a swipe left and the previous on a swipe right', () => {
    expect(paneForSwipe(panes(3, 1), 'left')?.id).toBe('%2');
    expect(paneForSwipe(panes(3, 1), 'right')?.id).toBe('%0');
  });

  it('comes round past either end, as tmux does', () => {
    expect(paneForSwipe(panes(3, 2), 'left')?.id).toBe('%0');
    expect(paneForSwipe(panes(3, 0), 'right')?.id).toBe('%2');
  });

  it('follows the index, not the order the Panes were read in', () => {
    expect(paneForSwipe(panes(3, 0).reverse(), 'left')?.id).toBe('%1');
  });

  it('goes nowhere in a Window with one Pane', () => {
    expect(paneForSwipe(panes(1, 0), 'left')).toBeUndefined();
  });
});
