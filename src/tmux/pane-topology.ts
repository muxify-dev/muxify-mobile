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
 * The least of a diagram either side of a split may be given, as a fraction
 * of the space being split.
 *
 * A Pane holding four rows of a forty-row Window is a tenth of the board: a
 * tile too short for its own two lines of label, and too small to tap with
 * any confidence. A fifth is the smallest tile on which the title and the
 * command both still fit, measured on the Panes sheet's 4:3 well.
 */
export const MIN_SHARE = 0.2;

/**
 * Lays the Panes of a Window out for a diagram, to tmux's proportions.
 *
 * Each split divides its space the way tmux did — by the cells on either side
 * of it — so a Pane the user dragged wide is wide on the diagram too, and a
 * Pane they squeezed reads as squeezed. Under that sits a floor: neither side
 * of a split is given less than MIN_SHARE of the space, because the diagram is
 * a picker before it is a picture and a sliver cannot be tapped. ADR 0004
 * records the equal-weight version this replaced, and why.
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
  | { kind: 'pane'; pane: TopologyPane }
  | { kind: 'split'; axis: Axis; first: Node; second: Node };

type Axis = 'columns' | 'rows';

function split(panes: TopologyPane[]): Node | null {
  if (panes.length === 0) return null;
  if (panes.length === 1) return { kind: 'pane', pane: panes[0] };

  for (const axis of ['columns', 'rows'] as const) {
    const cut = guillotine(panes, axis);
    if (!cut) continue;
    const first = split(cut[0]);
    const second = split(cut[1]);
    if (first && second) return { kind: 'split', axis, first, second };
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

/**
 * How many cells a group of Panes spans along an axis, dividers excluded.
 *
 * Dividers are left out on both sides of a split so that two Panes tmux made
 * 40 and 39 wide are drawn 40:39, not 41:39 with the divider counted against
 * one of them.
 */
function extent(node: Node, axis: Axis): number {
  if (node.kind === 'pane') return axis === 'columns' ? node.pane.width : node.pane.height;
  if (node.axis === axis) return extent(node.first, axis) + extent(node.second, axis);
  return Math.max(extent(node.first, axis), extent(node.second, axis));
}

/** tmux's share for the first side of a split, held off the floor. */
function shareOf(node: Node & { kind: 'split' }): number {
  const first = extent(node.first, node.axis);
  const total = first + extent(node.second, node.axis);
  // Degenerate geometry — a layout that parsed to zero-width Panes — has no
  // proportion to draw; halve rather than divide by nothing.
  const share = total > 0 ? first / total : 0.5;
  return Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, share));
}

function place(node: Node, within: Frame, frames: Map<number, Frame>): void {
  if (node.kind === 'pane') {
    frames.set(node.pane.index, within);
    return;
  }

  const share = shareOf(node);
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
