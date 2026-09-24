import { MIN_SHARE, paneTopologyFrames, type TopologyPane } from './pane-topology';

function pane(index: number, left: number, top: number, width: number, height: number): TopologyPane {
  return { index, left, top, width, height };
}

/** The layout in the screenshot: left column split in two, right column whole. */
const NESTED = [
  pane(0, 0, 0, 40, 12),
  pane(1, 0, 13, 40, 11),
  pane(2, 41, 0, 39, 24),
];

describe('paneTopologyFrames', () => {
  it('gives a lone Pane the whole board', () => {
    expect(paneTopologyFrames([pane(0, 0, 0, 80, 24)])).toEqual(
      new Map([[0, { x: 0, y: 0, width: 1, height: 1 }]]),
    );
  });

  it('splits a two-Pane Window where tmux did', () => {
    // 60 and 19 cells with the divider between them left out of the count, so
    // the diagram is 60:19 — the Pane the user dragged wide is wide here too.
    const frames = paneTopologyFrames([pane(0, 0, 0, 60, 24), pane(1, 61, 0, 19, 24)]);

    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 60 / 79, height: 1 });
    expect(frames.get(1)?.x).toBeCloseTo(60 / 79);
    expect(frames.get(1)?.width).toBeCloseTo(19 / 79);
  });

  it('weighs a split by the cells on each side, all the way down', () => {
    const frames = paneTopologyFrames(NESTED);

    // 40 columns left, 39 right; the left stack is 12 rows over 11.
    expect(frames.get(2)?.x).toBeCloseTo(40 / 79);
    expect(frames.get(2)?.width).toBeCloseTo(39 / 79);
    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 40 / 79, height: 12 / 23 });
    expect(frames.get(1)?.y).toBeCloseTo(12 / 23);
    expect(frames.get(1)?.height).toBeCloseTo(11 / 23);
  });

  it('measures a nested group by its widest member, not the sum of them', () => {
    // A stack of two 40-wide Panes is 40 wide, not 80: only along the axis
    // being split do extents add up.
    const frames = paneTopologyFrames([
      pane(0, 0, 0, 40, 10),
      pane(1, 0, 11, 40, 13),
      pane(2, 41, 0, 40, 24),
    ]);

    expect(frames.get(2)?.x).toBeCloseTo(0.5);
  });

  it('holds a sliver up to the floor, so it can still be tapped', () => {
    // Four rows of forty is a tenth of the board: too short for its label and
    // too small to hit. It is drawn at the floor and the big Pane gives it up.
    const frames = paneTopologyFrames([pane(0, 0, 0, 80, 4), pane(1, 0, 5, 80, 35)]);

    expect(frames.get(0)?.height).toBeCloseTo(MIN_SHARE);
    expect(frames.get(1)?.y).toBeCloseTo(MIN_SHARE);
    expect(frames.get(1)?.height).toBeCloseTo(1 - MIN_SHARE);
  });

  it('keeps the arrangement as well as the proportions', () => {
    const frames = paneTopologyFrames(NESTED);

    // 0 above 1, both left of 2 — which is the whole point of the diagram.
    expect(frames.get(0)!.y).toBeLessThan(frames.get(1)!.y);
    expect(frames.get(0)!.x + frames.get(0)!.width).toBeLessThanOrEqual(frames.get(2)!.x);
  });

  it('covers the board exactly, leaving no seam and no overlap', () => {
    const frames = paneTopologyFrames(NESTED);
    const area = [...frames.values()].reduce((sum, f) => sum + f.width * f.height, 0);

    expect(area).toBeCloseTo(1);
  });

  it('stacks Panes it cannot cut apart, so none of them disappear', () => {
    // Overlapping rectangles have no guillotine cut. Real tmux geometry never
    // does; a layout that failed to parse does.
    const frames = paneTopologyFrames([pane(0, 0, 0, 0, 0), pane(1, 0, 0, 0, 0)]);

    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
    expect(frames.get(1)).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it('has nothing to lay out for no Panes', () => {
    expect(paneTopologyFrames([])).toEqual(new Map());
  });
});
