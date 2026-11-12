import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { chromeHeaderColors } from '@/constants/app-theme';
import { SettingsProvider, useSettings } from '@/settings/settings-context';
import { AttachProvider } from '@/tmux/attach-context';

export const unstable_settings = { initialRouteName: 'index' };

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
          ...chromeHeaderColors(palette),
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
        <Stack.Screen name="index" options={{ title: 'Hosts' }} />
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
        <Stack.Screen
          name="topic-form"
          options={{
            // A title and a row of Tags: half height leaves the Host Screen in
            // view, where the new Topic will be.
            presentation: 'formSheet',
            sheetAllowedDetents: [0.5],
            sheetGrabberVisible: true,
            title: 'New Topic',
          }}
        />
        <Stack.Screen
          name="topic-edit"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6],
            sheetGrabberVisible: true,
            title: 'Edit Topic',
          }}
        />
        <Stack.Screen
          name="topic-add-session"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.65, 1],
            sheetGrabberVisible: true,
            title: 'Add a Session',
          }}
        />
        {/* The title is the page's own, which the screen sets when it has one. */}
        <Stack.Screen name="web-view" options={{ title: '' }} />
        <Stack.Screen
          name="terminal"
          options={{
            headerShown: true,
            headerTransparent: false,
            headerBackVisible: true,
            title: 'Session',
            // A swipe right on the Surface is the previous Pane. From iOS 26
            // the system's back swipe starts anywhere on a screen, and it took
            // that drag. Back stays in the Header and at the left edge.
            fullScreenGestureEnabled: false,
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
