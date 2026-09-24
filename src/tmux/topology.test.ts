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

const WINDOWS: Window[] = [
  { index: 0, name: 'editor', active: false },
  { index: 1, name: 'server', active: true },
];

describe('readTopology', () => {
  it('reads the Panes of the Window tmux marks active', async () => {
    const source = reader(WINDOWS, { 1: [{ index: 0, command: 'bash', active: true }] });

    const topology = await readTopology(source, 'main');

    expect(source.asked).toEqual(['windows main', 'panes main:1']);
    expect(topology.activeWindow).toEqual(WINDOWS[1]);
    expect(topology.panes).toHaveLength(1);
  });

  it('falls back to the first Window when tmux marks none active', async () => {
    const source = reader([
      { index: 3, name: 'only', active: false },
      { index: 4, name: 'other', active: false },
    ]);

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
