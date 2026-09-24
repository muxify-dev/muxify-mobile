import { paneTopologyFrames, type TopologyPane } from './pane-topology';

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

  it('splits a two-Pane Window down the middle, whatever tmux made of it', () => {
    // 60/20 in cells; half and half on the diagram, because both are equally
    // worth pointing at.
    const frames = paneTopologyFrames([pane(0, 0, 0, 60, 24), pane(1, 61, 0, 19, 24)]);

    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(frames.get(1)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it('weighs a split by how many Panes are on each side', () => {
    const frames = paneTopologyFrames(NESTED);

    // Two Panes left, one right: two thirds and one third.
    expect(frames.get(2)?.x).toBeCloseTo(2 / 3);
    expect(frames.get(2)?.width).toBeCloseTo(1 / 3);
    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 2 / 3, height: 0.5 });
    expect(frames.get(1)).toEqual({ x: 0, y: 0.5, width: 2 / 3, height: 0.5 });
  });

  it('keeps the arrangement even though it drops the proportions', () => {
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
