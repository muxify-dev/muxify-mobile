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
    const store = createTopologyStore(reader);
    const topology = await store.refresh('work');

    expect(asked).toEqual(['windows work', 'panes work:1']);
    expect(topology.activeWindow?.id).toBe('@1');
    expect(topology.activePane?.id).toBe('%5');
  });

  it('falls back to the first Window when tmux marks none', async () => {
    const { reader } = fakeReader([window({ id: '@7', index: 7, active: false })], {
      7: [pane()],
    });
    const store = createTopologyStore(reader);
    expect((await store.refresh('work')).activeWindow?.id).toBe('@7');
  });

  it('reads a Session that has gone as no Windows and no Panes', async () => {
    const { reader, asked } = fakeReader([]);
    const store = createTopologyStore(reader);
    const topology = await store.refresh('gone');
    expect(topology).toEqual({ windows: [], panes: [] });
    expect(asked).toEqual(['windows gone']);
  });

  it('tells whoever is listening', async () => {
    const { reader } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader);
    const seen: Topology[] = [];
    store.subscribe((topology) => seen.push(topology));

    await store.refresh('work');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.current());
  });

  it('stops telling a listener that has gone away', async () => {
    const { reader } = fakeReader([window()], { 0: [pane()] });
    const store = createTopologyStore(reader);
    const seen: Topology[] = [];
    const stop = store.subscribe((topology) => seen.push(topology));
    stop();
    await store.refresh('work');
    expect(seen).toHaveLength(0);
  });
});

describe('what a notification can settle on its own', () => {
  async function opened(windows = [window()], panes = { 0: [pane()] }) {
    const { reader, asked } = fakeReader(windows, panes);
    const store = createTopologyStore(reader);
    await store.refresh('work');
    asked.length = 0;
    return { store, asked };
  }

  it('renames a Window without asking the Host anything', async () => {
    const { store, asked } = await opened();
    expect(store.apply({ kind: 'window-renamed', window: '@0', name: 'logs' })).toBe('changed');
    expect(store.current().windows[0].name).toBe('logs');
    expect(store.current().activeWindow?.name).toBe('logs');
    expect(asked).toEqual([]);
  });

  it('ignores a rename of a Window this Session does not hold', async () => {
    const { store } = await opened();
    expect(store.apply({ kind: 'window-renamed', window: '@9', name: 'other' })).toBe(
      'unchanged',
    );
  });

  it('moves the Panes a layout change describes', async () => {
    const { store, asked } = await opened(
      [window({ paneCount: 2 })],
      { 0: [pane({ id: '%0', index: 0 }), pane({ id: '%2', index: 1, active: false })] },
    );
    const applied = store.apply({
      kind: 'layout-change',
      window: '@0',
      layout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      visibleLayout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      flags: '*',
    });
    expect(applied).toBe('changed');
    expect(store.current().panes.map((each) => [each.top, each.height])).toEqual([
      [0, 12],
      [13, 11],
    ]);
    expect(asked).toEqual([]);
  });

  it('asks again when a layout mentions a Pane the model has never seen', async () => {
    // A split made elsewhere: the rectangle is in the layout, but what the new
    // Pane is running and where it is are not.
    const { store } = await opened();
    expect(
      store.apply({
        kind: 'layout-change',
        window: '@0',
        layout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
        visibleLayout: 'b25d,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
        flags: '*',
      }),
    ).toBe('stale');
  });

  it('asks again for a layout it cannot read', async () => {
    const { store } = await opened();
    expect(
      store.apply({
        kind: 'layout-change',
        window: '@0',
        layout: 'nonsense',
        visibleLayout: 'nonsense',
        flags: '*',
      }),
    ).toBe('stale');
  });

  it('follows the active Pane changing', async () => {
    const { store, asked } = await opened(
      [window({ paneCount: 2 })],
      { 0: [pane({ id: '%0' }), pane({ id: '%2', index: 1, active: false })] },
    );
    expect(store.apply({ kind: 'window-pane-changed', window: '@0', pane: '%2' })).toBe(
      'changed',
    );
    expect(store.current().activePane?.id).toBe('%2');
    expect(store.current().panes.map((each) => each.active)).toEqual([false, true]);
    expect(asked).toEqual([]);
  });

  it('drops a Window that closed, and asks what is active now', async () => {
    const { store } = await opened([
      window({ id: '@0', index: 0 }),
      window({ id: '@1', index: 1, active: false }),
    ]);
    expect(store.apply({ kind: 'window-close', window: '@1' })).toBe('stale');
    expect(store.current().windows.map((each) => each.id)).toEqual(['@0']);
  });

  it('drops a Window tmux unlinked before killing it', async () => {
    // tmux unlinks a Window from its Session first, so the Window the user was
    // just looking at arrives as an *unlinked* close.
    const { store } = await opened([window({ id: '@0' }), window({ id: '@1', active: false })]);
    expect(store.apply({ kind: 'unlinked-window-close', window: '@1' })).toBe('stale');
    expect(store.current().windows.map((each) => each.id)).toEqual(['@0']);
  });

  it('ignores a Window closing somewhere else entirely', async () => {
    const { store } = await opened();
    expect(store.apply({ kind: 'unlinked-window-close', window: '@9' })).toBe('unchanged');
  });

  it('asks again when a Window appears, because the notification says nothing else', async () => {
    const { store } = await opened();
    expect(store.apply({ kind: 'window-add', window: '@4' })).toBe('stale');
  });

  it('asks again when the Session under the Client changes', async () => {
    const { store } = await opened();
    expect(store.apply({ kind: 'session-changed', session: '$1', name: 'play' })).toBe('stale');
  });

  it('is not troubled by notifications about something else', async () => {
    const { store } = await opened();
    const irrelevant: ControlEvent[] = [
      { kind: 'sessions-changed' },
      { kind: 'pane-mode-changed', pane: '%0' },
      { kind: 'client-detached', client: '/dev/ttys004' },
      { kind: 'unlinked-window-add', window: '@8' },
    ];
    for (const event of irrelevant) expect(store.apply(event)).toBe('unchanged');
  });
});
