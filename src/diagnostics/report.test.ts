import { createTestClock } from '@/lib/test-clock';
import type { AttachState } from '@/tmux/attach';

import { createLog } from './log';
import { renderReport } from './report';

const state = (over: Partial<AttachState> = {}): AttachState => ({
  phase: { kind: 'connected' },
  sessionName: 'work',
  fingerprint: 'SHA256:abc',
  keyChanged: false,
  topology: {
    windows: [
      { id: '@0', index: 0, name: 'shell', active: true, paneCount: 2, zoomed: true, command: 'zsh' },
    ],
    activeWindow: {
      id: '@0',
      index: 0,
      name: 'shell',
      active: true,
      paneCount: 2,
      zoomed: true,
      command: 'zsh',
    },
    panes: [
      { index: 0, id: '%1', command: 'zsh', active: true, path: '/', left: 0, top: 0, width: 49, height: 20 },
      { index: 1, id: '%2', command: 'vim', active: false, path: '/', left: 0, top: 21, width: 49, height: 20 },
    ],
    activePane: {
      index: 0,
      id: '%1',
      command: 'zsh',
      active: true,
      path: '/',
      left: 0,
      top: 0,
      width: 49,
      height: 20,
    },
  },
  sessions: null,
  previews: new Map(),
  trouble: null,
  zoomed: true,
  grid: { cols: 49, rows: 41 },
  scrolled: null,
  mouseTracking: false,
  rowInSight: 12,
  ...over,
});

const context = (attached: { hostName: string; state: AttachState } | null) => ({
  app: 'Muxify 1.0.0',
  device: 'iPhone 17 Pro · iOS 26.5',
  now: new Date(2026, 8, 21, 16, 50, 12).getTime(),
  attached,
});

describe('a report', () => {
  it('leads with where things stand, then the Log oldest first', () => {
    const clock = createTestClock(new Date(2026, 8, 21, 16, 49, 0).getTime());
    const log = createLog({ clock });
    log.record('attach', 'connecting');
    log.record('attach', 'connected');

    const text = renderReport(log, context({ hostName: 'Dev Host', state: state() }));
    const lines = text.split('\n');

    expect(lines[0]).toBe('Muxify log — 2026-09-21 16:50:12');
    expect(lines[1]).toBe('App: Muxify 1.0.0');
    expect(lines[2]).toBe('Device: iPhone 17 Pro · iOS 26.5');
    expect(lines[3]).toBe('Attached: Dev Host / work — connected');
    expect(lines[4]).toBe(
      '  Topology: 1 window, active @0 #0 zoomed; 2 panes: %1* 0,0 49x20 | %2 0,21 49x20',
    );
    expect(lines[5]).toBe(
      '  Client grid: 49x41; Zoom preference on; row in sight 12; mouse tracking off; scrolled live',
    );
    expect(lines[6]).toBe('Entries: 2, oldest first');
    expect(lines[7]).toBe('');
    expect(lines[8]).toMatch(/attach {5}connecting$/);
    expect(lines[9]).toMatch(/attach {5}connected$/);
  });

  it('says so when nothing is attached', () => {
    const text = renderReport(createLog({ clock: createTestClock() }), context(null));
    expect(text).toContain('Attached: nothing');
    expect(text).toContain('Entries: 0, oldest first');
  });

  it('carries a disconnect reason and a line of trouble when there is one', () => {
    const text = renderReport(
      createLog({ clock: createTestClock() }),
      context({
        hostName: 'Dev Host',
        state: state({
          phase: {
            kind: 'disconnected',
            reason: { kind: 'transport-lost', detail: 'The channel closed' },
          },
          trouble: 'Could not select Pane: no such pane',
          grid: null,
        }),
      }),
    );
    expect(text).toContain(
      'Attached: Dev Host / work — disconnected (transport-lost: The channel closed)',
    );
    expect(text).toContain('Client grid: none yet');
    expect(text).toContain('  Trouble: Could not select Pane: no such pane');
  });
});
