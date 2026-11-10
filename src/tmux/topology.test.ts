import type { ControlEvent } from './control-protocol';
import type { Pane, Window } from './tmux-client';
import { createTopologyStore, type Topology, type TopologyReader } from './topology';

const window = (over: Partial<Window> = {}): Window => ({
  id: '@0',
  index: 0,
  name: 'shell',
  active: true,
  paneCount: 1,
  zoomed: false,
  command: 'zsh',
  ...over,
});

const pane = (over: Partial<Pane> = {}): Pane => ({
  index: 0,
  id: '%0',
  command: 'zsh',
  active: true,
  path: '/home/user',
  left: 0,
  top: 0,
  width: 80,
  height: 24,
  ...over,
});

/** Lets every queued promise run, which is where a self-refresh happens. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

/** A Host whose answers the test sets, and which counts what it was asked. */
function fakeReader(windows: Window[], panes: Record<number, Pane[]> = {}) {
  const asked: string[] = [];
  const reader: TopologyReader = {
    async listWindows(sessionName) {
      asked.push(`windows ${sessionName}`);
      return windows;
    },
    async listPanes(sessionName, windowIndex) {
      asked.push(`panes ${sessionName}:${windowIndex}`);
      return panes[windowIndex] ?? [];
    },
  };
  return { reader, asked };
}

describe('reading a Topology', () => {
  it('reads the Windows, then the Panes of the active one', async () => {
    const { reader, asked } = fakeReader(
      [window({ id: '@0', index: 0, active: false }), window({ id: '@1', index: 1, active: true })],
      { 1: [pane({ id: '%5' })] },
    );
    const store = createTopologyStore(reader, 'work');
    const topology = await store.refresh();

    expect(asked).toEqual(['windows work', 'panes work:1']);
    expect(topology.activeWindow?.id).toBe('@1');
    expect(topology.activePane?.id).toBe('%5');
  });

  it('falls back to the first Window when tmux marks none', async () => {
    const { reader } = fakeReader([window({ id: '@7', index: 7, active: false })], {
      7: [pane()],
    });
    const store = createTopologyStore(reader, 'work');
    expect((await store.refresh()).activeWindow?.id).toBe('@7');
  });

  it('reads a Session that has gone as no Windows and no Panes', async () => {
    const { reader, asked } = fakeReader([]);
    const store = createTopologyStore(reader, 'gone');
    const topology = await store.refresh();
    expect(topology).toEqual({ windows: [], panes: [] });
    expect(asked).toEqual(['windows gone']);
  });

  it('reads the Session it has been moved to', async () => {
    const { reader, asked } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    store.attachedTo('play');
    await store.refresh();
    expect(asked).toEqual(['windows play', 'panes play:0']);
  });

  it('tells whoever is listening', async () => {
    const { reader } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    const seen: Topology[] = [];
    store.subscribe((topology) => seen.push(topology));

    await store.refresh();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.current());
  });

  it('stops telling a listener that has gone away', async () => {
    const { reader } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    const seen: Topology[] = [];
    const stop = store.subscribe((topology) => seen.push(topology));
    stop();
    await store.refresh();
    expect(seen).toHaveLength(0);
  });
});

describe('a notification the model cannot act on', () => {
  it('reads again with no caller involved', async () => {
    // What `'stale'` used to mean, and used to oblige every caller to know:
    // `%window-add @4` says a Window exists and nothing else — not its index,
    // not its name, not what it is running.
    const { reader, asked } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    await store.refresh();
    asked.length = 0;

    store.apply({ kind: 'window-add', window: '@4' });
    await settle();

    expect(asked).toEqual(['windows work', 'panes work:0']);
  });

  it('reads once for the burst of notifications one change produces', async () => {
    // A split on the laptop pushes a layout change, a window-add and a
    // pane-changed in the same breath. Three reads for one split is two round
    // trips nobody asked for.
    const { reader, asked } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    await store.refresh();
    asked.length = 0;

    store.apply({ kind: 'window-add', window: '@4' });
    store.apply({ kind: 'window-add', window: '@5' });
    store.apply({ kind: 'session-changed', session: '$1', name: 'work' });
    await settle();

    expect(asked.filter((each) => each.startsWith('windows'))).toHaveLength(2);
  });

  it('hands a read that failed to whoever wants to know', async () => {
    const troubles: unknown[] = [];
    const reader: TopologyReader = {
      listWindows: () => Promise.reject(new Error('the Pane has gone')),
      listPanes: () => Promise.resolve([]),
    };
    const store = createTopologyStore(reader, 'work', {
      onTrouble: (error) => troubles.push(error),
    });

    store.apply({ kind: 'window-add', window: '@4' });
    await settle();

    expect(String(troubles[0])).toContain('the Pane has gone');
  });
});

describe('what a notification can settle on its own', () => {
  async function opened(windows = [window()], panes = { 0: [pane()] }) {
    const { reader, asked } = fakeReader(windows, panes);
    const store = createTopologyStore(reader, 'work');
    await store.refresh();
    asked.length = 0;
    return { store, asked };
  }

  it('renames another Window without asking the Host anything', async () => {
    const { store, asked } = await opened([window(), window({ id: '@1', index: 1, active: false })]);
    store.apply({ kind: 'window-renamed', window: '@1', name: 'logs' });
    await settle();

    expect(store.current().windows[1].name).toBe('logs');
    expect(store.current().activeWindow?.name).toBe('shell');
    expect(asked).toEqual([]);
  });

  it('reads again when the active Window is renamed, because its program may have changed', async () => {
    // automatic-rename follows the program in the Pane, and nothing else tmux
    // pushes says what a Pane is running.
    const { store, asked } = await opened();
    store.apply({ kind: 'window-renamed', window: '@0', name: 'vim' });
    await settle();

    expect(asked).toEqual(['windows work', 'panes work:0']);
  });

  it('ignores a rename of a Window this Session does not hold', async () => {
    const { store, asked } = await opened();
    store.apply({ kind: 'window-renamed', window: '@9', name: 'other' });
    await settle();
    expect(asked).toEqual([]);
  });

  it('moves the Panes a layout change describes', async () => {
    const { store, asked } = await opened([window({ paneCount: 2 })], {
      0: [pane({ id: '%0', index: 0 }), pane({ id: '%2', index: 1, active: false })],
    });
    store.apply({
      kind: 'layout-change',
      window: '@0',
      layout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      visibleLayout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      flags: '*',
    });
    await settle();

    expect(store.current().panes.map((each) => [each.top, each.height])).toEqual([
      [0, 12],
      [13, 11],
    ]);
    expect(asked).toEqual([]);
  });

  it('asks again when a layout mentions a Pane the model has never seen', async () => {
    // A split made elsewhere: the rectangle is in the layout, but what the new
    // Pane is running and where it is are not.
    const { store, asked } = await opened();
    store.apply({
      kind: 'layout-change',
      window: '@0',
      layout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      visibleLayout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      flags: '*',
    });
    await settle();

    expect(asked).toContain('windows work');
  });

  it('asks again for a layout it cannot read', async () => {
    const { store, asked } = await opened();
    store.apply({
      kind: 'layout-change',
      window: '@0',
      layout: 'nonsense',
      visibleLayout: 'nonsense',
      flags: '*',
    });
    await settle();

    expect(asked).toContain('windows work');
  });

  it('follows the active Pane changing', async () => {
    const { store, asked } = await opened([window({ paneCount: 2 })], {
      0: [pane({ id: '%0' }), pane({ id: '%2', index: 1, active: false })],
    });
    store.apply({ kind: 'window-pane-changed', window: '@0', pane: '%2' });
    await settle();

    expect(store.current().activePane?.id).toBe('%2');
    expect(store.current().panes.map((each) => each.active)).toEqual([false, true]);
    expect(asked).toEqual([]);
  });

  it('moves the active Pane before tmux is asked to, so a tap lands at once', async () => {
    // A tap on a Pane travels to the Host and back, and the notification that
    // confirms it arrives later still. Waiting for either is a Pane that
    // highlights a beat after the finger left it.
    const { store, asked } = await opened([window({ paneCount: 2 })], {
      0: [pane({ id: '%0' }), pane({ id: '%2', index: 1, active: false })],
    });
    expect(store.activate('%2')).toBe(true);
    expect(store.current().activePane?.id).toBe('%2');

    // And tmux's own word for it, when it comes, is no longer news.
    store.apply({ kind: 'window-pane-changed', window: '@0', pane: '%2' });
    await settle();
    expect(asked).toEqual([]);
  });

  it('says a Pane it does not hold cannot be moved to', async () => {
    const { store } = await opened();
    expect(store.activate('%9')).toBe(false);
  });

  it('drops a Window that closed, and asks what is active now', async () => {
    const { store, asked } = await opened([
      window({ id: '@0', index: 0 }),
      window({ id: '@1', index: 1, active: false }),
    ]);
    store.apply({ kind: 'window-close', window: '@1' });
    expect(store.current().windows.map((each) => each.id)).toEqual(['@0']);
    await settle();
    expect(asked).toContain('windows work');
  });

  it('drops a Window tmux unlinked before killing it', async () => {
    // tmux unlinks a Window from its Session first, so the Window the user was
    // just looking at arrives as an *unlinked* close.
    const { store } = await opened([window({ id: '@0' }), window({ id: '@1', active: false })]);
    store.apply({ kind: 'unlinked-window-close', window: '@1' });
    expect(store.current().windows.map((each) => each.id)).toEqual(['@0']);
  });

  it('ignores a Window closing somewhere else entirely', async () => {
    const { store, asked } = await opened();
    store.apply({ kind: 'unlinked-window-close', window: '@9' });
    await settle();
    expect(asked).toEqual([]);
  });

  it('is not troubled by notifications about something else', async () => {
    const { store, asked } = await opened();
    const irrelevant: ControlEvent[] = [
      { kind: 'sessions-changed' },
      { kind: 'pane-mode-changed', pane: '%0' },
      { kind: 'client-detached', client: '/dev/ttys004' },
      { kind: 'unlinked-window-add', window: '@8' },
    ];
    for (const event of irrelevant) store.apply(event);
    await settle();
    expect(asked).toEqual([]);
  });
});

describe('zoom, which rides along in a layout change', () => {
  async function opened(windows: Window[], panes: Record<number, Pane[]>) {
    const { reader } = fakeReader(windows, panes);
    const store = createTopologyStore(reader, 'work');
    await store.refresh();
    return store;
  }

  const TWO_PANES = {
    0: [pane({ id: '%0', index: 0 }), pane({ id: '%2', index: 1, active: false })],
  };
  const layout = (flags: string) => ({
    kind: 'layout-change' as const,
    window: '@0',
    layout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
    visibleLayout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
    flags,
  });

  it('reads a Window becoming zoomed', async () => {
    const store = await opened([window({ paneCount: 2, zoomed: false })], TWO_PANES);
    store.apply(layout('*Z'));
    expect(store.current().activeWindow?.zoomed).toBe(true);
    expect(store.current().windows[0].zoomed).toBe(true);
  });

  it('reads it being turned off again', async () => {
    const store = await opened([window({ paneCount: 2, zoomed: true })], TWO_PANES);
    store.apply(layout('*'));
    expect(store.current().activeWindow?.zoomed).toBe(false);
  });

  it('is the only way a zoom toggled elsewhere is noticed', async () => {
    // The Layout describes the arrangement zoom is hiding, so the rectangles
    // are identical either way — the flags are the whole of the signal. Two
    // applies of the same Layout, so the first settles the rectangles and the
    // second can only differ by its flags.
    const store = await opened([window({ paneCount: 2, zoomed: false })], TWO_PANES);
    store.apply(layout('*'));
    const before = store.current().panes.map((each) => [each.top, each.height]);

    store.apply(layout('*Z'));

    expect(store.current().panes.map((each) => [each.top, each.height])).toEqual(before);
    expect(store.current().activeWindow?.zoomed).toBe(true);
  });
});

describe('a store that has been let go', () => {
  it('tells nobody and reads nothing more', async () => {
    const { reader, asked } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader, 'work');
    const seen: Topology[] = [];
    store.subscribe((topology) => seen.push(topology));
    await store.refresh();
    asked.length = 0;
    seen.length = 0;

    store.dispose();
    store.apply({ kind: 'window-add', window: '@4' });
    await settle();

    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
  });
});


describe('Topology reads across Session retargets', () => {
  it.each([false, true])('ignores an obsolete Windows result, empty=%p', async (empty) => {
    let release!: (windows: Window[]) => void;
    const panes = jest.fn(async () => [pane()]);
    const reader: TopologyReader = {
      listWindows: jest.fn().mockResolvedValueOnce([window()])
        .mockImplementationOnce(() => new Promise<Window[]>((resolve) => { release = resolve; }))
        .mockResolvedValue([window({ id: '@2', index: 2 })]),
      listPanes: panes,
    };
    const store = createTopologyStore(reader, 'work');
    await store.refresh();
    const seen: Topology[] = [];
    store.subscribe((value) => seen.push(value));
    const old = store.refresh();
    store.attachedTo('$2');
    await store.refresh();
    release(empty ? [] : [window()]);
    await old;
    expect(store.current().activeWindow?.id).toBe('@2');
    expect(seen).toHaveLength(1);
    expect(panes.mock.calls).toHaveLength(2);
  });

  it('does not publish Panes from a previous target after another Session has arrived', async () => {
    let release!: (panes: Pane[]) => void;
    const reader: TopologyReader = {
      listWindows: async (target) => [window({ id: target === '$1' ? '@1' : '@2' })],
      listPanes: jest.fn().mockImplementationOnce(() => new Promise<Pane[]>((resolve) => { release = resolve; }))
        .mockResolvedValue([pane({ id: '%2' })]),
    };
    const store = createTopologyStore(reader, '$1');
    const old = store.refresh();
    await settle();
    store.attachedTo('$2');
    await store.refresh();
    release([pane({ id: '%1' })]);
    await old;
    expect(store.current().activePane?.id).toBe('%2');
    expect(reader.listPanes).toHaveBeenNthCalledWith(1, '$1', 0);
    expect(reader.listPanes).toHaveBeenNthCalledWith(2, '$2', 0);
  });

  it('keeps an in-flight read when the observed Session target has not changed', async () => {
    let release!: (windows: Window[]) => void;
    const reader: TopologyReader = {
      listWindows: () => new Promise<Window[]>((resolve) => { release = resolve; }),
      listPanes: jest.fn(async () => [pane()]),
    };
    const store = createTopologyStore(reader, '$1');
    const read = store.refresh();
    store.attachedTo('$1');
    release([window()]);
    await read;
    expect(reader.listPanes).toHaveBeenCalledWith('$1', 0);
    expect(store.current().activePane?.id).toBe('%0');
  });
});
