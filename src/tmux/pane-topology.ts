/** Where something sits inside its container, as fractions of it. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a Pane this needs: which one it is, and where tmux puts it. */
export interface TopologyPane {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Lays the Panes of a Window out for a diagram, giving each an equal share.
 *
 * Drawing tmux's real proportions is the obvious thing and it reads badly: a
 * Pane holding four rows of a forty-row Window becomes a sliver too small to
 * label or tap, and the diagram is a picker before it is a picture. So the
 * arrangement is taken from tmux and the proportions are not — a split divides
 * its space by how many Panes are on each side, which keeps every Pane worth
 * pointing at while the shape of the Window still reads as itself.
 *
 * The arrangement is recovered by finding a guillotine cut: a vertical or
 * horizontal line with every Pane wholly on one side of it. tmux's layouts are
 * binary splits all the way down, so one always exists, and recursing on each
 * side rebuilds the split tree that tmux wrote in the first place.
 *
 * A set of Panes with no such line — which real tmux geometry cannot produce,
 * but a layout that failed to parse can — falls back to an even stack, so the
 * Panes stay visible and pickable rather than vanishing.
 */
export function paneTopologyFrames(panes: TopologyPane[]): Map<number, Frame> {
  const frames = new Map<number, Frame>();
  if (panes.length === 0) return frames;

  const tree = split(panes);
  if (tree === null) {
    panes.forEach((pane, at) => {
      frames.set(pane.index, {
        x: 0,
        y: at / panes.length,
        width: 1,
        height: 1 / panes.length,
      });
    });
    return frames;
  }

  place(tree, { x: 0, y: 0, width: 1, height: 1 }, frames);
  return frames;
}

/** One Pane, or two groups of them side by side or stacked. */
type Node =
  | { kind: 'pane'; index: number; count: 1 }
  | { kind: 'split'; axis: Axis; first: Node; second: Node; count: number };

type Axis = 'columns' | 'rows';

function split(panes: TopologyPane[]): Node | null {
  if (panes.length === 0) return null;
  if (panes.length === 1) return { kind: 'pane', index: panes[0].index, count: 1 };

  for (const axis of ['columns', 'rows'] as const) {
    const cut = guillotine(panes, axis);
    if (!cut) continue;
    const first = split(cut[0]);
    const second = split(cut[1]);
    if (first && second) {
      return { kind: 'split', axis, first, second, count: first.count + second.count };
    }
  }
  return null;
}

/**
 * The first line across this axis with every Pane wholly on one side of it.
 *
 * tmux's coordinates exclude the one-cell divider between Panes, so the gap
 * this looks for is always there: a Pane ending at column 40 sits beside one
 * starting at 41, never at 40.
 */
function guillotine(
  panes: TopologyPane[],
  axis: Axis,
): [TopologyPane[], TopologyPane[]] | null {
  const start = (pane: TopologyPane) => (axis === 'columns' ? pane.left : pane.top);
  const end = (pane: TopologyPane) =>
    axis === 'columns' ? pane.left + pane.width : pane.top + pane.height;

  const sorted = [...panes].sort((a, b) => start(a) - start(b));
  for (let at = 1; at < sorted.length; at += 1) {
    const before = sorted.slice(0, at);
    const after = sorted.slice(at);
    const lastEdge = Math.max(...before.map(end));
    const firstEdge = Math.min(...after.map(start));
    if (lastEdge < firstEdge) return [before, after];
  }
  return null;
}

function place(node: Node, within: Frame, frames: Map<number, Frame>): void {
  if (node.kind === 'pane') {
    frames.set(node.index, within);
    return;
  }

  const share = node.first.count / node.count;
  if (node.axis === 'columns') {
    const width = within.width * share;
    place(node.first, { ...within, width }, frames);
    place(
      node.second,
      { ...within, x: within.x + width, width: within.width - width },
      frames,
    );
    return;
  }

  const height = within.height * share;
  place(node.first, { ...within, height }, frames);
  place(
    node.second,
    { ...within, y: within.y + height, height: within.height - height },
    frames,
  );
}
