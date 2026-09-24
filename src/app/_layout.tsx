import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Muxify' }} />
        <Stack.Screen name="host-form" options={{ title: 'Host' }} />
        <Stack.Screen name="hosts/[id]" options={{ title: 'Sessions' }} />
        {/* No header: the Surface fills the screen to the top, and the Dock's
            Home button already goes back. */}
        <Stack.Screen name="terminal" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
