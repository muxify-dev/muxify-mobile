import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { fakeHostServer, refused } from '@/test-support/fake-host-server';
import { sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

import { useGoToPaths } from './use-go-to-paths';

const mockPaths = jest.fn();
let mockServer = fakeHostServer();
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));

const row = (name: string): SessionPathRow => ({
  kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null,
});
/** The `ok` of a `session_paths`: these rows, in the order the Host ranked them. */
const listed = (...names: string[]) => sessionPathRowsJson(names.map(row));
const shown = () => ({ query: paths.dataKey ?? '', names: (paths.data ?? []).map((each) => each.name) });

let renderer: ReactTestRenderer;
let paths: ReturnType<typeof useGoToPaths>;
async function mount(enabled = true) {
  function Screen() {
    paths = useGoToPaths('host', enabled);
    return null;
  }
  await act(async () => { renderer = create(<Screen />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockServer = fakeHostServer();
  mockServer.on.session_paths = mockPaths;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  jest.useRealTimers();
});

it('asks the Host Server with no text for an empty field, and draws its rows in the order of the Host', async () => {
  mockPaths.mockResolvedValue(listed('newest', 'older', 'oldest'));
  await mount();
  await act(async () => { paths.ask('  '); });

  expect(mockServer.requests).toEqual([{ session_paths: {} }]);
  expect(shown()).toEqual({ query: '', names: ['newest', 'older', 'oldest'] });
});

it('waits for the typing to pause before it asks the Host for the text', async () => {
  mockPaths.mockResolvedValue(listed('gs-backend'));
  await mount();
  await act(async () => { paths.ask('g'); paths.ask('gs'); });
  expect(mockPaths).not.toHaveBeenCalled();

  await act(async () => { jest.runAllTimers(); });
  expect(mockPaths).toHaveBeenCalledTimes(1);
  expect(mockPaths).toHaveBeenCalledWith({ query: 'gs' });
  expect(shown()).toEqual({ query: 'gs', names: ['gs-backend'] });
});

it('keeps the answer for the newest text when an older answer comes after it', async () => {
  const answers: ((value: unknown) => void)[] = [];
  mockPaths.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
  await mount();
  await act(async () => { paths.ask('a'); jest.runAllTimers(); });
  await act(async () => { paths.ask('ab'); jest.runAllTimers(); });

  await act(async () => { answers[1]!(listed('newest')); });
  await act(async () => { answers[0]!(listed('older')); });

  expect(shown()).toEqual({ query: 'ab', names: ['newest'] });
});

it('keeps the rows on show and says why when the Host cannot be read', async () => {
  mockPaths.mockResolvedValueOnce(listed('kept')).mockRejectedValue(refused('no Config', 'config_invalid'));
  await mount();
  await act(async () => { paths.ask(''); });
  await act(async () => { paths.ask(''); });

  expect(shown().names).toEqual(['kept']);
  expect(paths).toMatchObject({ isPending: false, error: { key: '', reason: 'no Config' } });
});

it('asks nothing of a Host CLI that has no Go to', async () => {
  await mount(false);
  await act(async () => { paths.ask(''); jest.runAllTimers(); });

  expect(mockPaths).not.toHaveBeenCalled();
});
