import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { BrowserTab } from '@/browser/tabs';
import { HeaderTitleButton, type HeaderTitle } from '@/components/terminal-header';
import { TitleSheet } from '@/components/title-sheet';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useTitleSheet } from '@/hooks/use-title-sheet';
import { useSettings } from '@/settings/settings-context';
import { useAttachState, useCurrentAttach } from '@/tmux/attach-context';

const say = speakingAs(deviceLog(), 'browser');

/** How long the page rests before where it is goes into the Topic Place. */
const SCROLL_SETTLE_MS = 400;

interface ShownPage {
  /** The Host Tab's URL. */
  url: string;
  /** What to load: the Tab's URL, or the page a restore goes back to. */
  page: string;
  scrollY: number;
  title: string;
}

/**
 * One Browser Tab's page, loaded on the phone.
 *
 * The page is loaded again here, from its address: the phone shows what the
 * address serves, and not the Tab on the Host, so a form filled in on the Mac
 * is empty here. The Terminal Screen is under this screen and its Attach
 * stays up, so Back finds the Session as it was. See ADR 0007.
 *
 * It has the Terminal Header's title and the same Title Sheet, so the Topics
 * list is a tap away from the page. While it is on top, the Attach keeps its
 * Tab in the Topic Place, and reopening the Topic opens it again. See ADR 0020.
 */
export default function WebViewScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string; page?: string; scrollY?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { palette } = useSettings();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
  const webView = useRef<WebView>(null);
  const [shown, setShown] = useState<ShownPage>(() => ({
    url: params.url,
    page: params.page || params.url,
    scrollY: Number(params.scrollY) || 0,
    title: params.title ?? '',
  }));
  const [title, setTitle] = useState(shown.title);
  /** Why the last load failed; null while the page loads or shows. */
  const [failure, setFailure] = useState<string | null>(null);

  // The Attach's token for this Tab. Going away gives it back, which clears
  // the Tab from the Topic Place, unless the Topic changed first.
  const token = useRef<number | null>(null);
  const where = useRef({ page: shown.page, scrollY: shown.scrollY });
  const scrolled = useRef(false);
  useEffect(() => {
    if (!attach) return;
    const mine = attach.showTab({ url: shown.url, page: shown.page, scrollY: shown.scrollY });
    token.current = mine;
    where.current = { page: shown.page, scrollY: shown.scrollY };
    scrolled.current = shown.scrollY === 0;
    return () => {
      attach.leaveTab(mine);
      if (token.current === mine) token.current = null;
    };
  }, [attach, shown]);

  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);
  const report = useCallback(() => {
    if (token.current !== null) attach?.updateTab(token.current, where.current);
  }, [attach]);

  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current || !navigation.isFocused()) return;
    leaving.current = true;
    router.back();
  }, [navigation, router]);

  const showTab = useCallback((tab: BrowserTab) => {
    setFailure(null);
    setTitle(tab.title);
    setShown({ url: tab.url, page: tab.url, scrollY: 0, title: tab.title });
  }, []);
  const chooser = useTitleSheet({ attach, state, hostId: attach?.hostId, onOpenTab: showTab, onMoved: leave });

  // A Topic opened from here, or a new Attach, is somewhere else: the Terminal
  // Screen shows it, and a restore pushes its own Web View.
  const [arrivedIn] = useState(() => ({ attach, topicId: state?.topic?.id ?? null }));
  const topicId = state?.topic?.id ?? null;
  useEffect(() => {
    if (focused && (attach !== arrivedIn.attach || topicId !== arrivedIn.topicId)) leave();
  }, [focused, attach, topicId, arrivedIn, leave]);

  const pageTitle = title || shown.page;
  const headerTitle = useMemo((): HeaderTitle | null => {
    if (!state) return null;
    return chooser.topic
      ? { kind: 'topic', topic: chooser.topic.label, program: `🌐 ${pageTitle}`, session: state.sessionName }
      : { kind: 'session', session: state.sessionName, program: pageTitle };
  }, [state, chooser.topic, pageTitle]);

  const reload = () => {
    setFailure(null);
    webView.current?.reload();
  };

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: pageTitle }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel="Reload" onPress={reload} />
      </Stack.Toolbar>
      {headerTitle === null ? null : (
        <HeaderTitleButton
          title={headerTitle}
          colors={{ foreground: palette.toolbarTint, dim: palette.secondaryLabel }}
          onTitle={chooser.openTitleSheet}
          testID="web-view-title"
          detailTestID="page-title"
        />
      )}
      <WebView
        ref={webView}
        source={{ uri: shown.page }}
        style={styles.fill}
        pullToRefreshEnabled
        onNavigationStateChange={(navigation) => {
          if (navigation.title) setTitle(navigation.title);
          if (!navigation.loading && navigation.url && navigation.url !== where.current.page) {
            where.current = { page: navigation.url, scrollY: 0 };
            report();
          }
        }}
        onLoadEnd={({ nativeEvent }) => {
          // Back where the page was left, once, and only on the page it was
          // left on: a link followed since makes the old offset meaningless.
          if (scrolled.current) return;
          scrolled.current = true;
          if (nativeEvent.url !== shown.page) return;
          say(`scrolling ${shown.page} back to ${Math.round(shown.scrollY)}`);
          webView.current?.injectJavaScript(`window.scrollTo(0, ${shown.scrollY}); true;`);
        }}
        onScroll={({ nativeEvent }) => {
          where.current = { ...where.current, scrollY: nativeEvent.contentOffset.y };
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(report, SCROLL_SETTLE_MS);
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
          <Text style={[styles.address, { color: palette.secondaryLabel }]}>{shown.page}</Text>
          <Pressable accessibilityRole="button" onPress={reload}>
            <Text style={[styles.retry, { color: palette.controlAccent }]}>Try again</Text>
          </Pressable>
        </View>
      )}
      <TitleSheet {...chooser.sheet} />
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
