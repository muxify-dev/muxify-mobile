import { createSessionPreparer, type SessionChrome } from './session-preparer';
import type { Grid } from './tmux-client';

const GRID: Grid = { cols: 38, rows: 32 };

function fakeChrome(statusLines: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const chrome: SessionChrome = {
    async setWindowSize(sessionName, grid) {
      calls.push(`size ${sessionName} ${grid.cols}x${grid.rows}`);
    },
    async readStatusLine(sessionName) {
      calls.push(`read ${sessionName}`);
      return statusLines[sessionName];
    },
    async setStatusLine(sessionName, value) {
      calls.push(`status ${sessionName} ${value}`);
      statusLines[sessionName] = value;
    },
    async redrawClient(clientTty) {
      calls.push(`redraw ${clientTty ?? 'best'}`);
    },
  };
  return { chrome, calls, statusLines };
}

describe('prepare', () => {
  it('sizes the Window, hides the status line and repaints, in that order', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });

    await createSessionPreparer(chrome).prepare('main', GRID, '/dev/pts/3');

    expect(calls).toEqual([
      'size main 38x32',
      'read main',
      'status main off',
      'redraw /dev/pts/3',
    ]);
  });

  it('reads the original status line before hiding it, so it can be put back', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });

    await createSessionPreparer(chrome).prepare('main', GRID);

    expect(calls.indexOf('read main')).toBeLessThan(calls.indexOf('status main off'));
  });

  it('remembers the original only the first time it sees a Session', async () => {
    // Otherwise switching away and back records 'off' as the original, and the
    // user's status line is gone for good.
    const { chrome, calls, statusLines } = fakeChrome({ main: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main', GRID);
    await preparer.prepare('main', GRID);
    await preparer.restoreAll();

    expect(calls.filter((call) => call === 'read main')).toHaveLength(1);
    expect(statusLines.main).toBe('on');
  });

  it('prepares each Session it is pointed at', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on', work: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main', GRID);
    await preparer.prepare('work', GRID);

    expect(calls).toContain('status main off');
    expect(calls).toContain('status work off');
  });
});

describe('restoreAll', () => {
  it('puts back every Session it changed, not just the last one', async () => {
    const { chrome, statusLines } = fakeChrome({ main: 'on', work: '2' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main', GRID);
    await preparer.prepare('work', GRID);
    await preparer.restoreAll();

    expect(statusLines).toEqual({ main: 'on', work: '2' });
  });

  it('leaves a Session alone when tmux would not say what its status line was', async () => {
    const { chrome, calls } = fakeChrome({ main: undefined });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main', GRID);
    await preparer.restoreAll();

    expect(calls.filter((call) => call.startsWith('status main'))).toEqual(['status main off']);
  });

  it('restores nothing twice, so a second teardown cannot undo a later change', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main', GRID);
    await preparer.restoreAll();
    await preparer.restoreAll();

    expect(calls.filter((call) => call === 'status main on')).toHaveLength(1);
  });

  it('does nothing when it never prepared anything', async () => {
    const { chrome, calls } = fakeChrome();

    await createSessionPreparer(chrome).restoreAll();

    expect(calls).toEqual([]);
  });
});
