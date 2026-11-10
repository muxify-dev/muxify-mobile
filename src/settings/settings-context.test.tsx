import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SettingsProvider, useSettings } from './settings-context';
import { createSettingsStore, type SettingsStore } from './settings-store';
import { hostListsFor } from './settings';

let mockStore: SettingsStore;
const mockHosts = jest.fn();
jest.mock('./device-settings', () => ({ deviceSettingsStore: () => mockStore }));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: mockHosts }) }));

let value: ReturnType<typeof useSettings> | undefined;
let renderer: ReactTestRenderer;
function Probe() { value = useSettings(); return null; }
beforeEach(() => {
  value = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

it('finishes migration before an editor can change settings', async () => {
  let release!: (records: { hosts: { id: string }[] }) => void;
  mockHosts.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  let contents = JSON.stringify({ hostScreenLists: ['topics'] });
  mockStore = createSettingsStore({ read: async () => contents, write: async (next) => { contents = next; } });
  await act(async () => { renderer = create(<SettingsProvider><Probe /></SettingsProvider>); });
  expect(value).toBeUndefined();
  await act(async () => { release({ hosts: [{ id: 'one' }, { id: 'two' }] }); });
  expect(hostListsFor(value!.settings, 'one')).toEqual(['topics']);
  expect(JSON.parse(contents).hostListPreferences.byHost.two).toEqual(['topics']);
});

it('keeps two Host edits and a global edit issued before React renders again', async () => {
  mockHosts.mockResolvedValue({ hosts: [{ id: 'one' }, { id: 'two' }] });
  let contents = JSON.stringify({ hostScreenLists: ['topics'] });
  mockStore = createSettingsStore({ read: async () => contents, write: async (next) => { contents = next; } });
  await act(async () => { renderer = create(<SettingsProvider><Probe /></SettingsProvider>); });
  const editor = value!;
  await act(async () => {
    editor.updateHostLists('one', ['sessions']);
    editor.updateHostLists('two', ['topics', 'recent']);
    editor.update({ theme: 'dracula' });
  });
  const saved = await mockStore.load();
  expect(hostListsFor(saved, 'one')).toEqual(['sessions']);
  expect(hostListsFor(saved, 'two')).toEqual(['topics', 'recent']);
  expect(saved.theme).toBe('dracula');
});
