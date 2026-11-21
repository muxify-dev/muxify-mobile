import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  appearanceFor,
  paletteFor,
  sheetPaletteFor,
  Themes,
  type AnsiPalette,
  type Appearance,
  type SheetPalette,
  type TerminalPalette,
  type ThemeId,
} from '@/constants/app-theme';
import { deviceSettingsStore } from './device-settings';
import type { HostScreenTab } from '@/domain/host-screen';
import { DEFAULT_SETTINGS, resolveTheme, chooserListsFor, type ChooserLists, type Settings } from './settings';
import { describeError } from '@/lib/describe-error';
import { Alert, Appearance as NativeAppearance, useColorScheme } from 'react-native';

interface SettingsContextValue {
  settings: Settings;
  /** Changes one or more settings, and writes them. */
  update: (change: Partial<Settings>) => void;
  updateChooserLists: (hostId: string, lists: ChooserLists) => void;
  /** Remembers the Host Screen tab the user chose on this Host. */
  rememberHostScreenTab: (hostId: string, tab: HostScreenTab) => void;
  /** The Theme in use, from the appearance setting and the phone's. See resolveTheme. */
  theme: ThemeId;
  /** Whether the app is drawn light or dark, which the Theme in use decides. */
  appearance: 'light' | 'dark';
  /** The chrome colours for that appearance. */
  palette: Appearance;
  /** The colours the Terminal Screen's sheets are drawn with. */
  sheetPalette: SheetPalette;
  /** What the Surface is painted with. */
  terminal: TerminalPalette;
  /** The sixteen colours the Host's own output is painted with. */
  ansi: AnsiPalette | undefined;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Holds the user's settings for the whole app.
 *
 * Shared rather than read per screen because the Theme is not only the
 * terminal's: it decides whether the app is light or dark, so changing it in
 * Settings, or the phone changing its appearance, has to repaint the list
 * behind it and the navigation bar above it in the same frame. A screen that
 * loaded its own copy would keep the old one.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // iOS reports light or dark once the app has a window; anything else is the
  // system default, which is light.
  const phoneScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const current = useRef(settings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let present = true;
    void deviceSettingsStore().load().then((saved) => {
      if (!present) return;
      current.current = saved;
      setSettings(saved);
      setReady(true);
    });
    return () => { present = false; };
  }, []);

  const change = useCallback((makeNext: (value: Settings) => Settings) => {
    const next = makeNext(current.current);
    current.current = next;
    setSettings(next);
    void deviceSettingsStore().save(next).catch((error) => Alert.alert('Could not save settings', describeError(error)));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    change((value) => ({ ...value, ...patch }));
  }, [change]);

  const rememberHostScreenTab = useCallback((hostId: string, tab: HostScreenTab) => {
    change((value) => ({ ...value, hostScreenTabs: { ...value.hostScreenTabs, [hostId]: tab } }));
  }, [change]);

  const updateChooserLists = useCallback((hostId: string, lists: ChooserLists) => {
    change((value) => ({ ...value, chooserListPreferences: {
      ...value.chooserListPreferences, [hostId]: lists,
    } }));
  }, [change]);

  // The native chrome (tab bar, search field, keyboard, sheets) takes light or
  // dark from the window, not from our palette, so a Dark setting on a light
  // phone has to override the window too. System hands it back to the phone,
  // which is also what keeps useColorScheme above reporting the phone's own.
  useLayoutEffect(() => {
    if (!ready) return;
    NativeAppearance.setColorScheme(settings.appearance === 'system' ? 'unspecified' : settings.appearance);
  }, [ready, settings.appearance]);

  const theme = resolveTheme(settings, phoneScheme);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      rememberHostScreenTab,
      updateChooserLists,
      theme,
      appearance: appearanceFor(theme),
      palette: paletteFor(theme),
      sheetPalette: sheetPaletteFor(theme),
      terminal: Themes[theme].palette,
      ansi: Themes[theme].ansi,
    }),
    [settings, theme, update, rememberHostScreenTab, updateChooserLists],
  );

  if (!ready) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings needs a SettingsProvider above it');
  return value;
}

export function useChooserLists(hostId: string): ChooserLists {
  return chooserListsFor(useSettings().settings, hostId);
}
