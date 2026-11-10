import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ToolbarGlyphButton } from '@/components/toolbar-glyph-button';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';

const say = speakingAs(deviceLog(), 'browser');

/**
 * One Browser Tab's page, loaded on the phone.
 *
 * The page is loaded again here, from its address: the phone shows what the
 * address serves, and not the Tab on the Host, so a form filled in on the Mac
 * is empty here. The Terminal Screen is under this screen and its Attach
 * stays up, so Back finds the Session as it was. See ADR 0007.
 */
export default function WebViewScreen() {
  const { url, title: tabTitle } = useLocalSearchParams<{ url: string; title?: string }>();
  const { palette } = useSettings();
  const page = useRef<WebView>(null);
  const [title, setTitle] = useState(tabTitle ?? '');
  /** Why the last load failed; null while the page loads or shows. */
  const [failure, setFailure] = useState<string | null>(null);

  const reload = () => {
    setFailure(null);
    page.current?.reload();
  };

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      <Stack.Screen
        options={{
          title: title || url,
          headerRight: () => (
            <ToolbarGlyphButton
              systemImage="arrow.clockwise"
              label="Reload"
              tint={palette.toolbarTint}
              onPress={reload}
            />
          ),
        }}
      />
      <WebView
        ref={page}
        source={{ uri: url }}
        style={styles.fill}
        pullToRefreshEnabled
        onNavigationStateChange={(navigation) => {
          if (navigation.title) setTitle(navigation.title);
        }}
        onLoadStart={() => setFailure(null)}
        onError={({ nativeEvent }) => {
          say(`could not load ${nativeEvent.url}: ${nativeEvent.description}`);
          setFailure(nativeEvent.description);
        }}
        onHttpError={({ nativeEvent }) => say(`${nativeEvent.url} answered ${nativeEvent.statusCode}`)}
        // The reason is drawn below, over the page, where Reload is.
        renderError={() => <View />}
      />
      {failure === null ? null : (
        <View style={[styles.failure, { backgroundColor: palette.background }]}>
          <Text style={[styles.reason, { color: palette.destructive }]}>{failure}</Text>
          <Text style={[styles.address, { color: palette.secondaryLabel }]}>{url}</Text>
          <Pressable accessibilityRole="button" onPress={reload}>
            <Text style={[styles.retry, { color: palette.controlAccent }]}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  failure: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  reason: { fontSize: 17, textAlign: 'center' },
  address: { fontSize: 13, textAlign: 'center' },
  retry: { fontSize: 17, fontWeight: '600' },
});
