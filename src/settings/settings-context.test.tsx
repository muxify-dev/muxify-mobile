import React from 'react';
import * as ReactNative from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SettingsProvider, useSettings } from './settings-context';
import { createSettingsStore, type SettingsStore } from './settings-store';
import { chooserListsFor, hostListsFor } from './settings';

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
    editor.updateChooserLists('one', ['windows', 'sessions']);
    editor.updateChooserLists('two', ['topics']);
    editor.update({ darkTheme: 'dracula' });
  });
  const saved = await mockStore.load();
  expect(hostListsFor(saved, 'one')).toEqual(['sessions']);
  expect(hostListsFor(saved, 'two')).toEqual(['topics', 'recent']);
  expect(saved.darkTheme).toBe('dracula');
  expect(chooserListsFor(saved, 'one')).toEqual(['windows', 'sessions']);
  expect(chooserListsFor(saved, 'two')).toEqual(['topics']);
});

it('paints the app and the Surface with the Theme of the phone appearance on System', async () => {
  mockHosts.mockResolvedValue({ hosts: [] });
  const scheme = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
  let contents = JSON.stringify({ appearance: 'system', lightTheme: 'gruvbox-light', darkTheme: 'gruvbox-dark-hard' });
  mockStore = createSettingsStore({ read: async () => contents, write: async (next) => { contents = next; } });
  await act(async () => { renderer = create(<SettingsProvider><Probe /></SettingsProvider>); });
  expect(value).toMatchObject({ theme: 'gruvbox-dark-hard', appearance: 'dark' });
  expect(value!.terminal.background).toBe('#1d2021');

  scheme.mockReturnValue('light');
  await act(async () => { renderer.update(<SettingsProvider><Probe /></SettingsProvider>); });
  expect(value).toMatchObject({ theme: 'gruvbox-light', appearance: 'light' });
  expect(value!.terminal.background).toBe('#fbf1c7');

  await act(async () => { value!.update({ appearance: 'dark' }); });
  expect(value!.theme).toBe('gruvbox-dark-hard');
  scheme.mockRestore();
});
