import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { AppPalette } from '@/constants/app-theme';

/**
 * Dark whatever the phone is set to.
 *
 * Not a preference: the Surface is a terminal and it is dark, so a light list
 * behind it reads as two different apps stitched together. The one place this
 * shows is a phone in light mode, which would otherwise flash a white
 * navigation bar over the terminal on every push.
 */
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: AppPalette.background,
    card: AppPalette.background,
    text: AppPalette.toolbarTint,
    primary: AppPalette.controlAccent,
    border: AppPalette.separator,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: AppPalette.background },
          headerTintColor: AppPalette.toolbarTint,
          headerTitleStyle: { color: AppPalette.toolbarTint },
          headerTitleAlign: 'center',
          // A chevron on its own, as remux has it: the title of the screen you
          // came from is a word the user already read.
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: AppPalette.background },
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
