import { applyGrid, type GridTargets } from './apply-grid';
import type { Grid } from './tmux-client';

function recorder() {
  const calls: string[] = [];
  const targets: GridTargets = {
    async setWindowSize(grid: Grid) {
      calls.push(`window ${grid.rows}`);
    },
    setClientSize(grid: Grid) {
      calls.push(`client ${grid.rows}`);
    },
    async redraw() {
      calls.push('redraw');
    },
  };
  return { calls, targets };
}

describe('applyGrid', () => {
  it('shrinks the Client before the Window, so tmux never pads', async () => {
    const { calls, targets } = recorder();

    await applyGrid(targets, { cols: 38, rows: 19 }, { cols: 38, rows: 32 });

    // Set again after the Window, because the library only flushes a pending
    // window-change when the channel sees other traffic.
    expect(calls).toEqual(['client 19', 'window 19', 'client 19', 'redraw']);
  });

  it('grows the Window before the Client, for the same reason', async () => {
    const { calls, targets } = recorder();

    await applyGrid(targets, { cols: 38, rows: 32 }, { cols: 38, rows: 19 });

    expect(calls).toEqual(['window 32', 'client 32', 'redraw']);
  });

  it('treats the first size as a growth, since there is nothing to shrink from', async () => {
    const { calls, targets } = recorder();

    await applyGrid(targets, { cols: 38, rows: 32 }, null);

    expect(calls).toEqual(['window 32', 'client 32', 'redraw']);
  });

  it('repaints last, once both sizes agree', async () => {
    const { calls, targets } = recorder();

    await applyGrid(targets, { cols: 38, rows: 10 }, { cols: 38, rows: 20 });

    expect(calls[calls.length - 1]).toBe('redraw');
  });

  it('counts a width-only change as a growth, leaving the order alone', async () => {
    const { calls, targets } = recorder();

    await applyGrid(targets, { cols: 20, rows: 24 }, { cols: 38, rows: 24 });

    expect(calls).toEqual(['window 24', 'client 24', 'redraw']);
  });
});
