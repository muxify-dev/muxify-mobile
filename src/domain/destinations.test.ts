import type { BrowserTab } from '@/browser/tabs';
import type { Pane } from '@/tmux/tmux-client';

import { destinationRows, listedWindows, type DestinationInput } from './destinations';
import type { TitleRow, TitleWindowRow } from './title-rows';

const win = (over: Partial<TitleWindowRow>): TitleWindowRow => ({
  kind: 'window', id: '@1', index: 1, name: 'editor', program: null, mark: null, current: false, ...over,
});
const pane = (index: number, active = false): Pane => ({
  index, id: `%${index}`, command: index === 0 ? 'nvim' : 'zsh', active, path: '/gs/server',
  left: 0, top: 0, width: 80, height: 24,
} as Pane);
const tab = (id: string): BrowserTab => ({ id, url: `https://${id}.example.ts.net`, title: id, active: false });
// The example tree of the proposal: Topic “Fix reward drop bug in GS”.
const topicRows: TitleRow[] = [
  { kind: 'session', name: 'gs-server', current: true, windows: [
    win({ id: '@1', index: 1, name: 'editor', program: 'nvim', current: true }),
    win({ id: '@2', index: 2, name: 'tests', program: 'pnpm', mark: 'working' }),
  ] },
  { kind: 'session', name: 'gs-client', current: false, windows: [
    win({ id: '@7', index: 1, name: 'claude', mark: 'unread' }),
  ] },
];

const base: DestinationInput = {
  topic: 'Fix reward drop bug in GS',
  rows: topicRows,
  attachedSession: 'gs-server',
  panes: [pane(0, true), pane(1)],
  tabs: new Map([['@1', [tab('grafana'), tab('pr-812')]], ['@7', [tab('docs')]]]),
  onScreen: { kind: 'pane' },
};

const keys = (input: DestinationInput) => destinationRows(input).map((row) => row.key);
/** The keys of the rows marked as on screen. */
const here = (input: DestinationInput) => destinationRows(input).filter((row) => 'here' in row && row.here).map((row) => row.key);

describe('destinationRows', () => {
  it('lists the Topic, its Sessions and Windows, the Panes of the Window on screen, and each Window’s Tabs, and nothing else', () => {
    expect(keys(base)).toEqual([
      'topic',
      'session:gs-server',
      'window:gs-server:@1', 'pane:%0', 'pane:%1', 'tab:@1:grafana', 'tab:@1:pr-812',
      'window:gs-server:@2',
      'session:gs-client',
      'window:gs-client:@7', 'tab:@7:docs',
    ]);
  });

  it('gives a Window with one Pane no Pane rows', () => {
    expect(keys({ ...base, panes: [pane(0, true)] })).not.toContain('pane:%0');
  });

  it('lists the attached Session’s Windows under it when the Attach holds no Topic', () => {
    const rows = destinationRows({
      ...base, topic: null, rows: [win({ id: '@1', current: true }), win({ id: '@2', index: 2 })], tabs: new Map(),
      panes: [],
    });
    expect(rows.map((row) => row.key)).toEqual(['window:gs-server:@1', 'window:gs-server:@2']);
    expect(rows[1]).toMatchObject({ kind: 'window', session: 'gs-server' });
  });

  it('carries the Window and Session a Tab belongs to, so a pick can go there first', () => {
    const docs = destinationRows(base).find((row) => row.key === 'tab:@7:docs');
    expect(docs).toMatchObject({ kind: 'tab', session: 'gs-client', window: { id: '@7', index: 1 } });
  });
});

describe('the row on screen', () => {
  it('is the active Pane on the Terminal Screen, when the Panes are listed', () => {
    expect(here(base)).toEqual(['pane:%0']);
  });

  it('is the Window on the Terminal Screen, when the Window has one Pane', () => {
    expect(here({ ...base, panes: [pane(0, true)] })).toEqual(['window:gs-server:@1']);
  });

  it('is the shown Tab on the Web View, and no Pane or Window', () => {
    expect(here({ ...base, onScreen: { kind: 'tab', url: 'https://pr-812.example.ts.net' } })).toEqual(['tab:@1:pr-812']);
  });

  it('is not a Tab of another Window with the same URL', () => {
    const tabs = new Map([['@1', [tab('grafana')]], ['@7', [tab('pr-812')]]]);
    expect(here({ ...base, tabs, onScreen: { kind: 'tab', url: 'https://pr-812.example.ts.net' } })).toEqual([]);
  });

  it('is no row on the Web View while the shown Tab is not listed', () => {
    expect(here({ ...base, tabs: new Map(), onScreen: { kind: 'tab', url: 'https://pr-812.example.ts.net' } })).toEqual([]);
  });

  it('is the first of two Tabs with the same URL', () => {
    const tabs = new Map([['@1', [tab('grafana'), { ...tab('copy'), url: 'https://grafana.example.ts.net' }]]]);
    expect(here({ ...base, tabs, onScreen: { kind: 'tab', url: 'https://grafana.example.ts.net' } })).toEqual(['tab:@1:grafana']);
  });
});

describe('listedWindows', () => {
  it('names every Window the drawer lists, of every Session', () => {
    expect(listedWindows(topicRows)).toEqual(['@1', '@2', '@7']);
    expect(listedWindows([win({ id: '@3' })])).toEqual(['@3']);
  });
});
