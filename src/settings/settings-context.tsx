import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
import { DEFAULT_SETTINGS, hostListsFor, resolveTheme, chooserListsFor, type ChooserLists, type HostScreenLists, type Settings } from './settings';
import { deviceHostStore } from '@/storage/device-store';
import { describeError } from '@/lib/describe-error';
import { Alert, useColorScheme } from 'react-native';

interface SettingsContextValue {
  settings: Settings;
  /** Changes one or more settings, and writes them. */
  update: (change: Partial<Settings>) => void;
  updateChooserLists: (hostId: string, lists: ChooserLists) => void;
  updateHostLists: (hostId: string, lists: HostScreenLists) => void;
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let present = true;
    void (async () => {
      const records = await deviceHostStore().load();
      const saved = await deviceSettingsStore().load(records.hosts.map((host) => host.id));
      if (!present) return;
      current.current = saved;
      setSettings(saved);
      setReady(true);
    })().catch((error) => {
      if (present) Alert.alert('Could not load settings', describeError(error), [
        { text: 'Retry', onPress: () => setAttempt((value) => value + 1) },
      ]);
    });
    return () => { present = false; };
  }, [attempt]);

  const change = useCallback((makeNext: (value: Settings) => Settings) => {
    const next = makeNext(current.current);
    current.current = next;
    setSettings(next);
    void deviceSettingsStore().save(next).catch((error) => Alert.alert('Could not save settings', describeError(error)));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    change((value) => ({ ...value, ...patch }));
  }, [change]);

  const updateHostLists = useCallback((hostId: string, lists: HostScreenLists) => {
    change((value) => ({ ...value, hostListPreferences: {
      version: 1,
      byHost: { ...value.hostListPreferences?.byHost, [hostId]: lists },
    } }));
  }, [change]);

  const updateChooserLists = useCallback((hostId: string, lists: ChooserLists) => {
    change((value) => ({ ...value, chooserListPreferences: {
      ...value.chooserListPreferences, [hostId]: lists,
    } }));
  }, [change]);

  const theme = resolveTheme(settings, phoneScheme);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      updateHostLists,
      updateChooserLists,
      theme,
      appearance: appearanceFor(theme),
      palette: paletteFor(theme),
      sheetPalette: sheetPaletteFor(theme),
      terminal: Themes[theme].palette,
      ansi: Themes[theme].ansi,
    }),
    [settings, theme, update, updateHostLists, updateChooserLists],
  );

  if (!ready) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings needs a SettingsProvider above it');
  return value;
}

export function useHostLists(hostId: string): HostScreenLists {
  return hostListsFor(useSettings().settings, hostId);
}

export function useChooserLists(hostId: string): ChooserLists {
  return chooserListsFor(useSettings().settings, hostId);
}
