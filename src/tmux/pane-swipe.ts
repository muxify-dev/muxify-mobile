import type { SwipeDirection } from '@/lib/pan-axis';

import type { Pane } from './tmux-client';

/**
 * The Pane a swipe on the Surface goes to.
 *
 * A swipe left goes to the next Pane of the Window and a swipe right to the
 * previous one, in index order, and past either end it comes round to the
 * other. That is tmux's own `select-pane -t :.+` and `:.-`. The Pane is named
 * here, from the Topology, so that the move can be shown before tmux answers,
 * as a pick in the Panes picker is.
 */
export function paneForSwipe(panes: Pane[], direction: SwipeDirection): Pane | undefined {
  if (panes.length < 2) return undefined;
  const ordered = [...panes].sort((a, b) => a.index - b.index);
  const at = ordered.findIndex((pane) => pane.active);
  if (at < 0) return undefined;
  const step = direction === 'left' ? 1 : -1;
  return ordered[(at + step + ordered.length) % ordered.length];
}
