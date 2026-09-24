import { paneFrames, panePreviewTarget, trimPreview, windowPreviewTarget } from './preview';
import type { Pane } from './tmux-client';

function pane(index: number, left: number, top: number, width: number, height: number): Pane {
  return { index, command: 'bash', active: false, title: 'host', left, top, width, height };
}

describe('preview targets', () => {
  it('addresses a Window, which tmux resolves to its active Pane', () => {
    expect(windowPreviewTarget('main', 2)).toBe('main:2');
  });

  it('addresses one Pane', () => {
    expect(panePreviewTarget('main', 2, 1)).toBe('main:2.1');
  });
});

describe('trimPreview', () => {
  it('keeps the first lines, which is the top of the Pane', () => {
    expect(trimPreview(['a', 'b', 'c'], 2, 10)).toEqual(['a', 'b']);
  });

  it('drops trailing blank lines, which a shell Pane is mostly made of', () => {
    expect(trimPreview(['a', '', '  ', ''], 10, 10)).toEqual(['a']);
  });

  it('keeps blank lines in the middle, which are part of the picture', () => {
    expect(trimPreview(['a', '', 'b'], 10, 10)).toEqual(['a', '', 'b']);
  });

  it('cuts long lines to the width of the box', () => {
    expect(trimPreview(['abcdefgh'], 1, 3)).toEqual(['abc']);
  });

  it('is empty for a Pane showing nothing', () => {
    expect(trimPreview(['', ''], 5, 10)).toEqual([]);
  });
});

describe('paneFrames', () => {
  it('gives a single Pane the whole Window', () => {
    const frames = paneFrames([pane(0, 0, 0, 80, 24)]);

    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('puts two side-by-side Panes in their own halves', () => {
    // tmux leaves a column for the divider, so the widths do not quite sum to 1.
    const frames = paneFrames([pane(0, 0, 0, 40, 24), pane(1, 41, 0, 39, 24)]);

    expect(frames.get(0)).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(frames.get(1)?.x).toBeCloseTo(0.5125);
    expect(frames.get(1)?.width).toBeCloseTo(0.4875);
  });

  it('stacks two Panes split top and bottom', () => {
    const frames = paneFrames([pane(0, 0, 0, 80, 12), pane(1, 0, 13, 80, 11)]);

    expect(frames.get(0)?.height).toBeCloseTo(0.5);
    expect(frames.get(1)?.y).toBeCloseTo(0.5417, 3);
  });

  it('is empty for no Panes, rather than dividing by zero', () => {
    expect(paneFrames([])).toEqual(new Map());
  });
});
