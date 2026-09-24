import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { SettingsProvider, useSettings } from '@/settings/settings-context';

export default function RootLayout() {
  return (
    <SettingsProvider>
      <AppStack />
    </SettingsProvider>
  );
}

/**
 * The navigation chrome, painted in whatever the chosen Theme wants.
 *
 * Light or dark is not the phone's setting here, it is the Theme's: Latte is a
 * light terminal, and dark chrome around it would read as two apps. See
 * appearanceFor.
 */
function AppStack() {
  const { appearance, palette } = useSettings();

  const theme = useMemo(() => {
    const base = appearance === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: palette.background,
        card: palette.background,
        text: palette.toolbarTint,
        primary: palette.controlAccent,
        border: palette.separator,
      },
    };
  }, [appearance, palette]);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.toolbarTint,
          headerTitleStyle: { color: palette.toolbarTint },
          headerTitleAlign: 'center',
          // A chevron on its own, as remux has it: the title of the screen you
          // came from is a word the user already read.
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: palette.background },
        }}>
        <Stack.Screen name="index" options={{ title: 'Muxify' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen
          name="host-form"
          options={{
            // A sheet, not a push: adding a Host is a detour from the list, and
            // the list staying visible behind it says so. Full height because
            // the form is longer than any part-height detent would show.
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: false,
            title: 'New Host',
          }}
        />
        <Stack.Screen name="hosts/[id]" options={{ title: 'Sessions' }} />
        {/* No header: the Surface fills the screen to the top, and the Dock's
            Home button already goes back. */}
        <Stack.Screen name="terminal" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
