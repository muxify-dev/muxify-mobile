import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { BrowserTab } from '@/browser/tabs';
import { ON_PANE, type OnScreen } from '@/domain/destinations';
import type { Attach, AttachState } from '@/tmux/attach';

import { useTitleSheet } from './use-title-sheet';

/**
 * The Edge Drawer through the chooser hook, as a screen drives it: open it,
 * then pick a row. The Attach is a stand-in that records what it was asked.
 */

let mockAttach: Attach | null = null;
const mockReadTabs = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ isFocused: () => true }),
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => (() => void) | void) => React.useEffect(() => effect(), [effect]),
  };
});
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/settings/settings-context', () => ({
  useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }),
  useChooserLists: () => ['windows'],
}));
jest.mock('@/hooks/use-host-reading', () => ({
  useHostReading: () => ({ topics: { kind: 'absent' }, listing: { phase: 'answered', sessions: [] }, read: async () => {}, problem: null }),
}));
jest.mock('@/hooks/use-host-entry', () => ({
  useHostEntry: () => ({ openSession: jest.fn(), openTopic: jest.fn(), busyCard: null }),
}));
// One holder for every render, as the app's context gives.
const mockHolder = { current: () => mockAttach };
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => mockHolder }));
jest.mock('@osuki-dev/react-native-ssh', () => ({ connect: jest.fn() }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }), placeFor: async () => null }),
}));
jest.mock('@/tmux/ssh-connection', () => ({
  appConnections: () => ({ listing: () => null, subscribeListing: () => () => {} }),
}));
jest.mock('@/browser/read-browser-tabs', () => ({ readBrowserTabs: (...args: unknown[]) => mockReadTabs(...args) }));

const GRAFANA: BrowserTab = { id: 'g', url: 'https://grafana.tail1234.ts.net/', title: 'Grafana', active: true };
const LOGS: BrowserTab = { id: 'l', url: 'https://logs.tail1234.ts.net/', title: 'Logs', active: true };

/** An Attach on Window 1 `editor` of Session `gs-server`, which has two Panes, and Window 2 `logs`. */
function fakeAttach() {
  const asked: string[] = [];
  const editor = { id: '@1', index: 1, name: 'editor', active: true, paneCount: 2, zoomed: false, command: 'nvim' };
  const logs = { id: '@2', index: 2, name: 'logs', active: false, paneCount: 1, zoomed: false, command: 'tail' };
  const pane = (index: number, active: boolean) => ({ index, id: `%${index}`, command: active ? 'nvim' : 'zsh', active, path: '/gs' });
  const state = {
    sessionName: 'gs-server', topic: null, typing: { kind: 'open' },
    topology: { windows: [editor, logs], activeWindow: editor, panes: [pane(0, true), pane(1, false)] },
    sessions: [{ name: 'gs-server', windowCount: 2 }, { name: 'dotfiles', windowCount: 1 }],
    previews: new Map(),
  } as unknown as AttachState;
  const attach = {
    hostId: 'host',
    state: () => state,
    subscribe: () => () => {},
    showTopic: () => () => {},
    refreshTopic: () => {},
    refreshTopology: () => {},
    refreshSessions: () => {},
    capturePreviews: () => {},
    switchSession: async () => {},
    selectWindow: async (index: number) => { asked.push(`window ${index}`); },
    selectPane: (id: string) => { asked.push(`pane ${id}`); return true; },
  } as unknown as Attach;
  return { attach, asked };
}

type Chooser = ReturnType<typeof useTitleSheet>;
let renderer: ReactTestRenderer;
let chooser: Chooser;
const moved = jest.fn();
const openedTab = jest.fn();

function Screen({ attach, onScreen = ON_PANE }: { attach: Attach; onScreen?: OnScreen }) {
  const seen = useTitleSheet({ attach, state: attach.state(), hostId: 'host', onOpenTab: openedTab, onMoved: moved, onScreen });
  React.useEffect(() => { chooser = seen; });
  return null;
}

async function mountAndOpen() {
  const fake = fakeAttach();
  mockAttach = fake.attach;
  await act(async () => { renderer = create(<Screen attach={fake.attach} />); });
  await act(async () => { chooser.openDrawer(); });
  return fake;
}

/** The keys of the rows the drawer marks as on screen. */
const marked = () => chooser.drawer.rows.filter((row) => 'here' in row && row.here).map((row) => row.key);

const pick = (key: string) => act(async () => {
  const row = chooser.drawer.rows.find((each) => each.key === key);
  if (!row) throw new Error(`no row ${key} in ${chooser.drawer.rows.map((each) => each.key).join(', ')}`);
  chooser.drawer.onPick(row);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReadTabs.mockImplementation(async (_host: string, window: string) =>
    ({ kind: 'listed', tabs: window === '@1' ? [GRAFANA] : [LOGS] }));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

it('opens the drawer, not the Title Sheet, and lists the Tabs of every Window it lists under that Window', async () => {
  await mountAndOpen();

  expect(chooser.sheet.isPresented).toBe(false);
  expect(chooser.drawer.open).toBe(true);
  expect(mockReadTabs.mock.calls.map(([, window]) => window).sort()).toEqual(['@1', '@2']);
  expect(chooser.drawer.rows.map((row) => row.key)).toEqual([
    'window:gs-server:@1', 'pane:%0', 'pane:%1', 'tab:@1:g',
    'window:gs-server:@2', 'tab:@2:l',
  ]);
});

it('goes to the Window of a Tab first, then opens the Tab, so the Tab is in its own Window’s Place', async () => {
  const { asked } = await mountAndOpen();

  await pick('tab:@2:l');

  expect(asked).toEqual(['window 2']);
  expect(openedTab).toHaveBeenCalledWith(LOGS);
  expect(moved).not.toHaveBeenCalled();
  expect(chooser.drawer.open).toBe(false);
});

it('opens a Tab of the Window on screen at once', async () => {
  const { asked } = await mountAndOpen();

  await pick('tab:@1:g');

  expect(asked).toEqual([]);
  expect(openedTab).toHaveBeenCalledWith(GRAFANA);
});

it('goes to a Pane and tells the screen it moved, so the Web View gives way to the Terminal Screen', async () => {
  const { asked } = await mountAndOpen();

  await pick('pane:%1');

  expect(asked).toEqual(['pane %1']);
  expect(moved).toHaveBeenCalledWith(null);
  expect(chooser.drawer.open).toBe(false);
});

it('marks the shown Tab on the Web View, and the active Pane once the screen is the terminal again', async () => {
  const fake = fakeAttach();
  mockAttach = fake.attach;
  const page: OnScreen = { kind: 'tab', url: GRAFANA.url };
  await act(async () => { renderer = create(<Screen attach={fake.attach} onScreen={page} />); });
  await act(async () => { chooser.openDrawer(); });

  expect(marked()).toEqual(['tab:@1:g']);

  await act(async () => { renderer.update(<Screen attach={fake.attach} onScreen={ON_PANE} />); });

  expect(marked()).toEqual(['pane:%0']);
});
