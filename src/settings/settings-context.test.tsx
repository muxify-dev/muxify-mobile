import React from 'react';
import * as ReactNative from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SettingsProvider, useSettings } from './settings-context';
import { createSettingsStore, type SettingsStore } from './settings-store';
import { chooserListsFor } from './settings';

let mockStore: SettingsStore;
jest.mock('./device-settings', () => ({ deviceSettingsStore: () => mockStore }));

let value: ReturnType<typeof useSettings> | undefined;
let renderer: ReactTestRenderer;
function Probe() { value = useSettings(); return null; }
beforeEach(() => {
  value = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

it('keeps two Host edits and a global edit issued before React renders again', async () => {
  let contents = JSON.stringify({});
  mockStore = createSettingsStore({ read: async () => contents, write: async (next) => { contents = next; } });
  await act(async () => { renderer = create(<SettingsProvider><Probe /></SettingsProvider>); });
  const editor = value!;
  await act(async () => {
    editor.rememberHostScreenTab('one', 'sessions');
    editor.rememberHostScreenTab('two', 'topics');
    editor.updateChooserLists('one', ['windows', 'sessions']);
    editor.updateChooserLists('two', ['topics']);
    editor.update({ darkTheme: 'dracula' });
  });
  const saved = await mockStore.load();
  expect(saved.hostScreenTabs).toEqual({ one: 'sessions', two: 'topics' });
  expect(saved.darkTheme).toBe('dracula');
  expect(chooserListsFor(saved, 'one')).toEqual(['windows', 'sessions']);
  expect(chooserListsFor(saved, 'two')).toEqual(['topics']);
});

it('paints the app and the Surface with the Theme of the phone appearance on System', async () => {
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

it('draws the native chrome in the chosen appearance, and hands it back to the phone on System', async () => {
  const setColorScheme = jest.spyOn(ReactNative.Appearance, 'setColorScheme').mockImplementation(() => {});
  let contents = JSON.stringify({ appearance: 'dark' });
  mockStore = createSettingsStore({ read: async () => contents, write: async (next) => { contents = next; } });
  await act(async () => { renderer = create(<SettingsProvider><Probe /></SettingsProvider>); });
  expect(setColorScheme).toHaveBeenLastCalledWith('dark');

  await act(async () => { value!.update({ appearance: 'light' }); });
  expect(setColorScheme).toHaveBeenLastCalledWith('light');

  await act(async () => { value!.update({ appearance: 'system' }); });
  expect(setColorScheme).toHaveBeenLastCalledWith('unspecified');
  setColorScheme.mockRestore();
});
