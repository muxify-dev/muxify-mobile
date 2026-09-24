import { resizeShellChannel } from './shell-resize';

function fakeShell() {
  const sizes: string[] = [];
  return { sizes, resize: (cols: number, rows: number) => sizes.push(`${cols}x${rows}`) };
}

describe('resizeShellChannel', () => {
  it('asks for the size, then a different one, so the size actually lands', () => {
    const shell = fakeShell();

    resizeShellChannel(shell, { cols: 38, rows: 32 });

    // The second call is what makes the first take effect; see the module.
    expect(shell.sizes).toEqual(['38x32', '38x31']);
  });

  it('never asks for a height below one row', () => {
    const shell = fakeShell();

    resizeShellChannel(shell, { cols: 38, rows: 1 });

    expect(shell.sizes).toEqual(['38x1', '38x1']);
  });

  it('keeps the width, so the flush cannot reflow the remote', () => {
    const shell = fakeShell();

    resizeShellChannel(shell, { cols: 80, rows: 24 });

    expect(shell.sizes.every((size) => size.startsWith('80x'))).toBe(true);
  });
});
