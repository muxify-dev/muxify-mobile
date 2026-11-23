import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Place, Records } from '@/storage/records';

import { useRouteSession, type RouteSession, type RouteSessionState, type RouteShows } from './use-route-session';

const mockOpen = jest.fn();
const mockSetParams = jest.fn();
const mockLoad = jest.fn();
const mockRead = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ setParams: mockSetParams, push: jest.fn(), dismissTo: jest.fn() }),
}));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockLoad }) }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ settings: { zoomMultipaneWindows: false } }) }));
const mockHolder = { open: (...args: unknown[]) => mockOpen(...args), current: () => null };
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => mockHolder }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ read: mockRead }) }));

const host = { id: 'host', displayName: 'Mac', address: 'mac', port: 22, identityId: 'key' };
const TAB = { url: 'http://localhost:3000/', page: 'http://localhost:3000/docs', scrollY: 40 };
const place: Place = {
  hostId: 'host', owner: { kind: 'session', session: 'work' }, session: 'work',
  window: { id: '@2', index: 1, name: 'web' }, pane: '%3', tab: TAB, at: '2026-11-23T10:00:00.000Z',
};
const records: Records = { hosts: [host], identities: [], fingerprints: [], recentSessions: [], lastPlace: null, places: [place] };
const COLD_START: RouteSession = { hostId: 'host', session: 'work', reconnect: '1' };

let opening: RouteSessionState;
let renderer: ReactTestRenderer;
const said: string[] = [];

function Screen({ route, shows }: { route: RouteSession | null; shows: RouteShows }) {
  opening = useRouteSession(route, shows, (line) => said.push(line));
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  said.length = 0;
  mockLoad.mockResolvedValue(records);
  mockOpen.mockResolvedValue({});
  mockRead.mockImplementation(async (_host: unknown, _list: unknown, { onHostKey }: { onHostKey: (verdict: unknown, fingerprint: string) => boolean }) => {
    onHostKey({ kind: 'known' }, 'SHA256:x');
    return [{ name: 'work' }];
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
});

async function mount(route: RouteSession | null, shows: RouteShows) {
  await act(async () => { renderer = create(<Screen route={route} shows={shows} />); });
}

it('opens a cold start on the Web View at the whole Place, its Tab included', async () => {
  await mount(COLD_START, 'page');

  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockOpen.mock.calls[0][0].destination).toEqual({ sessionName: 'work', topic: null, restore: place });
  expect(opening.lookup).toEqual({ kind: 'found' });
  expect(opening.hostName).toBe('Mac');
  expect(mockSetParams).toHaveBeenCalledWith({ hostId: '', session: '', topicId: '', reconnect: '' });
});

it('opens the Terminal Screen at the Window and Pane only: the route means the terminal', async () => {
  await mount(COLD_START, 'terminal');

  expect(mockOpen.mock.calls[0][0].destination.restore).toEqual({ ...place, tab: null });
});

it('asks for no Attach when the visit does not find the Session', async () => {
  mockRead.mockResolvedValue([{ name: 'other' }]);
  await mount(COLD_START, 'page');

  expect(mockOpen).not.toHaveBeenCalled();
  expect(opening.lookup).toEqual({ kind: 'failed', step: 'looking-for-session', reason: null });
  expect(mockSetParams).not.toHaveBeenCalled();
});

it('does nothing for a screen that was not opened for a Session', async () => {
  await mount(null, 'page');

  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
  expect(opening).toMatchObject({ missing: null, lookup: null });
  expect(said).toEqual([]);
});
