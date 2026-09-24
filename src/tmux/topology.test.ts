import { readTopology, type TopologyReader } from './topology';
import type { Pane, Window } from './tmux-client';

function reader(
  windows: Window[],
  panesByWindow: Record<number, Pane[]> = {},
): TopologyReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async listWindows(sessionName) {
      asked.push(`windows ${sessionName}`);
      return windows;
    },
    async listPanes(sessionName, windowIndex) {
      asked.push(`panes ${sessionName}:${windowIndex}`);
      return panesByWindow[windowIndex] ?? [];
    },
  };
}

function window(index: number, name: string, active: boolean): Window {
  return { index, name, active, paneCount: 1, zoomed: false, command: 'bash' };
}

function pane(index: number, active: boolean): Pane {
  return {
    index,
    id: index,
    command: 'bash',
    active,
    path: '/home/ubuntu',
    left: 0,
    top: 0,
    width: 80,
    height: 24,
  };
}

const WINDOWS: Window[] = [window(0, 'editor', false), window(1, 'server', true)];

describe('readTopology', () => {
  it('reads the Panes of the Window tmux marks active', async () => {
    const source = reader(WINDOWS, { 1: [pane(0, true)] });

    const topology = await readTopology(source, 'main');

    expect(source.asked).toEqual(['windows main', 'panes main:1']);
    expect(topology.activeWindow).toEqual(WINDOWS[1]);
    expect(topology.panes).toHaveLength(1);
  });

  it('falls back to the first Window when tmux marks none active', async () => {
    const source = reader([window(3, 'only', false), window(4, 'other', false)]);

    const topology = await readTopology(source, 'main');

    expect(topology.activeWindow?.index).toBe(3);
    expect(source.asked).toContain('panes main:3');
  });

  it('does not ask for Panes of a Session that has no Windows', async () => {
    // A Session that vanished reads as no Windows; asking about a Window that
    // is not there is a round trip that can only fail.
    const source = reader([]);

    const topology = await readTopology(source, 'gone');

    expect(source.asked).toEqual(['windows gone']);
    expect(topology.activeWindow).toBeUndefined();
    expect(topology.panes).toEqual([]);
  });

  it('keeps the Windows in the order tmux gave them', async () => {
    const source = reader(WINDOWS);

    const topology = await readTopology(source, 'main');

    expect(topology.windows.map((window) => window.name)).toEqual(['editor', 'server']);
  });
});
