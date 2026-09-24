import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { SettingsProvider, useSettings } from '@/settings/settings-context';
import { AttachProvider } from '@/tmux/attach-context';

export default function RootLayout() {
  return (
    <SettingsProvider>
      {/* Above the navigator on purpose: the attached Session outlives every
          screen, so the thing that holds it cannot be inside one. Going Home
          changes what is on top and nothing else. See ADR 0007. */}
      <AttachProvider>
        <AppStack />
      </AttachProvider>
    </SettingsProvider>
  );
}

/**
 * The navigation chrome, painted in whatever the chosen Theme wants.
 *
 * Light or dark is not the phone's setting here, it is the Theme's: Solarized is a
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
          // No hairline under the title. The screens below are grouped lists
          // on their own background, so the rule separates the bar from
          // nothing — it only ever drew a line across the top of the app.
          headerShadowVisible: false,
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
            sheetGrabberVisible: true,
            title: 'New Host',
          }}
        />
        <Stack.Screen name="hosts/[id]" options={{ title: 'Host' }} />
        <Stack.Screen
          name="session-form"
          options={{
            // A short sheet: one field, and the Host Screen stays visible
            // behind it because that is where the new Session will appear.
            presentation: 'formSheet',
            sheetAllowedDetents: [0.4],
            sheetGrabberVisible: true,
            title: 'New Session',
          }}
        />
        {/* No header: the Surface fills the screen to the top, and the Dock's
            Home button already goes back. */}
        <Stack.Screen name="terminal" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
