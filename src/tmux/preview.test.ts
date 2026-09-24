import { trimPreview, windowPreviewTarget } from './preview';

describe('preview targets', () => {
  it('addresses a Window, which tmux resolves to its active Pane', () => {
    expect(windowPreviewTarget('main', 2)).toBe('main:2');
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
