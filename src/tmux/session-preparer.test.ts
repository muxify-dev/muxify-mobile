import { createSessionPreparer, type SessionChrome } from './session-preparer';

/** A Session's borrowed options, as the Host holds them. */
type Options = { status?: string; windowSize?: string };

function fakeChrome(sessions: Record<string, Options> = {}) {
  const calls: string[] = [];
  const chrome: SessionChrome = {
    async readStatusLine(sessionName) {
      calls.push(`read status ${sessionName}`);
      return sessions[sessionName]?.status;
    },
    async setStatusLine(sessionName, value) {
      calls.push(`status ${sessionName} ${value}`);
      sessions[sessionName] = { ...sessions[sessionName], status: value };
    },
    async readWindowSizing(sessionName) {
      calls.push(`read size ${sessionName}`);
      return sessions[sessionName]?.windowSize;
    },
    async setWindowSizing(sessionName, value) {
      calls.push(`size ${sessionName} ${value}`);
      sessions[sessionName] = { ...sessions[sessionName], windowSize: value };
    },
    async redrawClient(clientTty) {
      calls.push(`redraw ${clientTty ?? 'best'}`);
    },
  };
  return { chrome, calls, sessions };
}

const MAIN: Options = { status: 'on', windowSize: 'latest' };

describe('prepare', () => {
  it('hides the status line, pins the Window to the Surface, and repaints', async () => {
    const { chrome, calls } = fakeChrome({ main: { ...MAIN } });

    await createSessionPreparer(chrome).prepare('main', '/dev/pts/3');

    expect(calls).toEqual([
      'read status main',
      'read size main',
      'status main off',
      'size main smallest',
      'redraw /dev/pts/3',
    ]);
  });

  it('never sets a Window size itself, which the Client now decides', async () => {
    // One size, not two: the Client's pty is set, and `smallest` makes tmux
    // move the Window to match without a round trip to be caught halfway.
    const { chrome, calls } = fakeChrome({ main: { ...MAIN } });

    await createSessionPreparer(chrome).prepare('main');

    expect(calls.some((call) => /^size main \d/.test(call))).toBe(false);
  });

  it('reads both originals before changing either, so they can be put back', async () => {
    const { chrome, calls } = fakeChrome({ main: { ...MAIN } });

    await createSessionPreparer(chrome).prepare('main');

    expect(calls.indexOf('read status main')).toBeLessThan(calls.indexOf('status main off'));
    expect(calls.indexOf('read size main')).toBeLessThan(calls.indexOf('size main smallest'));
  });

  it('remembers the originals only the first time it sees a Session', async () => {
    // Otherwise switching away and back records Muxify's own settings as the
    // originals, and the user's are gone for good.
    const { chrome, calls, sessions } = fakeChrome({ main: { ...MAIN } });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('main');
    await preparer.restoreAll();

    expect(calls.filter((call) => call === 'read status main')).toHaveLength(1);
    expect(calls.filter((call) => call === 'read size main')).toHaveLength(1);
    expect(sessions.main).toEqual(MAIN);
  });

  it('prepares each Session it is pointed at', async () => {
    const { chrome, calls } = fakeChrome({ main: { ...MAIN }, work: { ...MAIN } });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('work');

    expect(calls).toContain('status main off');
    expect(calls).toContain('status work off');
    expect(calls).toContain('size work smallest');
  });
});

describe('restoreAll', () => {
  it('puts back every Session it changed, not just the last one', async () => {
    const { chrome, sessions } = fakeChrome({
      main: { status: 'on', windowSize: 'latest' },
      work: { status: '2', windowSize: 'manual' },
    });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.prepare('work');
    await preparer.restoreAll();

    expect(sessions).toEqual({
      main: { status: 'on', windowSize: 'latest' },
      work: { status: '2', windowSize: 'manual' },
    });
  });

  it('leaves an option alone when tmux would not say what it was', async () => {
    const { chrome, calls } = fakeChrome({ main: {} });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.restoreAll();

    expect(calls.filter((call) => call.startsWith('status main'))).toEqual(['status main off']);
    expect(calls.filter((call) => call.startsWith('size main'))).toEqual(['size main smallest']);
  });

  it('restores nothing twice, so a second teardown cannot undo a later change', async () => {
    const { chrome, calls } = fakeChrome({ main: { ...MAIN } });
    const preparer = createSessionPreparer(chrome);

    await preparer.prepare('main');
    await preparer.restoreAll();
    await preparer.restoreAll();

    expect(calls.filter((call) => call === 'status main on')).toHaveLength(1);
    expect(calls.filter((call) => call === 'size main latest')).toHaveLength(1);
  });

  it('does nothing when it never prepared anything', async () => {
    const { chrome, calls } = fakeChrome();

    await createSessionPreparer(chrome).restoreAll();

    expect(calls).toEqual([]);
  });
});
