import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  appearanceFor,
  paletteFor,
  Themes,
  type AnsiPalette,
  type Appearance,
  type TerminalPalette,
} from '@/constants/app-theme';
import { deviceSettingsStore } from './device-settings';
import { DEFAULT_SETTINGS, type Settings } from './settings';

interface SettingsContextValue {
  settings: Settings;
  /** Changes one or more settings, and writes them. */
  update: (change: Partial<Settings>) => void;
  /** Whether the app is drawn light or dark, which the Theme decides. */
  appearance: 'light' | 'dark';
  /** The chrome colours for that appearance. */
  palette: Appearance;
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
 * Settings has to repaint the list behind it and the navigation bar above it in
 * the same frame. A screen that loaded its own copy would keep the old one.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void (async () => setSettings(await deviceSettingsStore().load()))();
  }, []);

  const update = useCallback((change: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      void deviceSettingsStore().save(next);
      return next;
    });
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      appearance: appearanceFor(settings.theme),
      palette: paletteFor(settings.theme),
      terminal: Themes[settings.theme].palette,
      ansi: Themes[settings.theme].ansi,
    }),
    [settings, update],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings needs a SettingsProvider above it');
  return value;
}
