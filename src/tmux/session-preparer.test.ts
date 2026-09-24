import { createSessionPreparer, type SessionChrome } from './session-preparer';

function fakeChrome(statusLines: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const chrome: SessionChrome = {
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
  it('hides the status line and repaints, in that order', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });

    await createSessionPreparer(chrome).prepare('main', '/dev/pts/3');

    expect(calls).toEqual(['read main', 'status main off', 'redraw /dev/pts/3']);
  });

  it('leaves the Window size alone, which the resize scheduler owns', async () => {
    // Two things setting the remote size race, and the Window loses.
    const { chrome, calls } = fakeChrome({ main: 'on' });

    await createSessionPreparer(chrome).prepare('main');

    expect(calls.some((call) => call.startsWith('size'))).toBe(false);
  });

  it('reads the original status line before hiding it, so it can be put back', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });

    await createSessionPreparer(chrome).prepare('main');

    expect(calls.indexOf('read main')).toBeLessThan(calls.indexOf('status main off'));
  });

  it('remembers the original only the first time it sees a Session', async () => {
    // Otherwise switching away and back records 'off' as the original, and the
    // user's status line is gone for good.
    const { chrome, calls, statusLines } = fakeChrome({ main: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('main');
    await preparer.restoreAll();

    expect(calls.filter((call) => call === 'read main')).toHaveLength(1);
    expect(statusLines.main).toBe('on');
  });

  it('prepares each Session it is pointed at', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on', work: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('work');

    expect(calls).toContain('status main off');
    expect(calls).toContain('status work off');
  });
});

describe('restoreAll', () => {
  it('puts back every Session it changed, not just the last one', async () => {
    const { chrome, statusLines } = fakeChrome({ main: 'on', work: '2' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('work');
    await preparer.restoreAll();

    expect(statusLines).toEqual({ main: 'on', work: '2' });
  });

  it('leaves a Session alone when tmux would not say what its status line was', async () => {
    const { chrome, calls } = fakeChrome({ main: undefined });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.restoreAll();

    expect(calls.filter((call) => call.startsWith('status main'))).toEqual(['status main off']);
  });

  it('restores nothing twice, so a second teardown cannot undo a later change', async () => {
    const { chrome, calls } = fakeChrome({ main: 'on' });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
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
