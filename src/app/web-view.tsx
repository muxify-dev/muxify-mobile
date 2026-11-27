import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import type { ParamListBase } from 'expo-router/react-navigation';

import { findLivePage } from '@/browser/live-pages';
import { LivePageHost, useLivePages, useLivePageState } from '@/browser/live-pages-context';
import { placeTabRoute } from '@/browser/place-tab-route';
import { readBrowserTabs } from '@/browser/read-browser-tabs';
import { tabRestoreOf, type BrowserTab } from '@/browser/tabs';
import { ConnectionScreen } from '@/components/connection-screen';
import { EdgeDrawer, useEdgeSwitcher } from '@/components/edge-drawer';
import { EdgeGrip } from '@/components/edge-grip';
import { HeaderBand } from '@/components/header-band';
import { HeaderTitleButton, type HeaderTitle } from '@/components/terminal-header';
import { TitleSheet } from '@/components/title-sheet';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { coverOf } from '@/domain/cover';
import type { OnScreen } from '@/domain/destinations';
import { useCoverAction, useGoHost } from '@/hooks/use-cover-action';
import { useRouteSession, type RouteSession } from '@/hooks/use-route-session';
import { useTitleSheet } from '@/hooks/use-title-sheet';
import { requestGoTo } from '@/keyboard/go-to-request';
import { NO_GRIP_ACTIONS, type GripActionRuns } from '@/lib/grip-actions';
import { useSettings } from '@/settings/settings-context';
import { placeOwner, type PlaceOwner, type PlaceTab } from '@/storage/records';
import type { Attach } from '@/tmux/attach';
import { useAttachState, useCurrentAttach } from '@/tmux/attach-context';

const say = speakingAs(deviceLog(), 'browser');

interface ShownPage {
  /** The Host Tab's URL. */
  url: string;
  /** What a new Live Page loads: the Tab's URL, or the page a restore goes back to. */
  page: string;
  scrollY: number;
  title: string;
  /** Whose Live Page it is: the owner the Attach held when the Tab was shown. */
  of: { hostId: string; owner: PlaceOwner } | null;
}

/** The owner whose Live Page a Tab opened in an Attach now goes to. */
function ownerOf(attach: Attach | null): ShownPage['of'] {
  if (!attach) return null;
  const { topic, sessionName } = attach.state();
  return { hostId: attach.hostId, owner: placeOwner(topic?.id ?? null, sessionName) };
}

/**
 * One Browser Tab's page, loaded on the phone.
 *
 * The page is loaded again on the phone, from its address: the phone shows
 * what the address serves, and not the Tab on the Host, so a form filled in on
 * the Mac is empty here. The Attach stays up under it, so the Terminal Screen
 * finds the Session as it was. See ADR 0007.
 *
 * The page is a Live Page of the Tab's owner, which outlives this screen: Back,
 * a pick in the Title Sheet or another Tab hides it, and opening it again finds
 * it as it was left, a form half filled in included. Close Page releases it.
 * See ADR 0033.
 *
 * It has the Terminal Header's title and the same Title Sheet. While it is on
 * top, the Attach keeps its Tab in the Place of its Topic, or of its Session
 * when it holds no Topic. It stands in the Terminal Screen's place, over the
 * Host Screen: Back and the swipe from the edge go there and leave the Tab in
 * the Place, so opening the Topic or Session again opens the page again, and a
 * pick in the Title Sheet puts the Terminal Screen back. See ADR 0020.
 */
export default function WebViewScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string; page?: string; scrollY?: string; restored?: string } & RouteSession>();
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { appearance, palette, settings } = useSettings();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
  // A cold start whose Place has a Tab opens here, with no Terminal Screen
  // first: the reconnect runs from this screen, behind the Connection Screen.
  const [coldStart] = useState(() => (params.reconnect ? { hostId: params.hostId, session: params.session, topicId: params.topicId, reconnect: params.reconnect } : null));
  const opening = useRouteSession(coldStart, 'page', say);
  const kept = useLivePages();
  const [shown, setShown] = useState<ShownPage>(() => ({
    url: params.url,
    page: params.page || params.url,
    scrollY: Number(params.scrollY) || 0,
    title: params.title ?? '',
    // A cold start's page is its Last Place's, before any Attach holds it.
    of: coldStart?.hostId && coldStart.session
      ? { hostId: coldStart.hostId, owner: placeOwner(coldStart.topicId ?? null, coldStart.session) }
      : ownerOf(attach),
  }));
  // The page opens once for each Tab shown, before the first paint. A page
  // released after that is not opened again: the screen leaves (see below).
  const livePages = useSyncExternalStore(kept.pages.subscribe, kept.pages.all);
  const openedFor = useRef<ShownPage | null>(null);
  useLayoutEffect(() => {
    if (!shown.of) return;
    kept.pages.open(shown.of.hostId, shown.of.owner, shown.url, { page: shown.page, scrollY: shown.scrollY });
    openedFor.current = shown;
  }, [kept, shown]);
  const page = shown.of ? findLivePage(livePages, shown.of.hostId, shown.of.owner, shown.url) : null;
  const view = page ? kept.view(page.id) : null;
  const { title, failure } = useLivePageState(view);

  // The Attach's token for this Tab. Back keeps the Tab in the Place; a pick
  // that leaves the page (see `leaving`) gives the token back, which clears the
  // Tab from the Place, unless the owner changed first.
  const leaving = useRef(false);
  useEffect(() => {
    if (!attach || !page || !view) return;
    let told = view.where();
    const mine = attach.showTab({ url: page.url, ...told });
    const stop = view.subscribe(() => {
      const where = view.where();
      if (where.page === told.page && where.scrollY === told.scrollY) return;
      told = where;
      attach.updateTab(mine, where);
    });
    return () => {
      stop();
      if (leaving.current) {
        attach.leaveTab(mine);
      } else {
        attach.updateTab(mine, view.where());
        say('Back: to the Host Screen, and the Live Page waits');
      }
    };
  }, [attach, page, view]);

  // The page sits right over the Host Screen, in the Terminal Screen's place,
  // so Back and the swipe from the edge are the stack's own and go to the Host
  // Screen, and the Place keeps the page. A pick in the Title Sheet gives the
  // place back to the Terminal Screen.
  const hostId = attach?.hostId ?? coldStart?.hostId;
  const [release, setRelease] = useState<(() => void) | null>(null);
  const leave = useCallback(() => {
    if (leaving.current || !navigation.isFocused()) return false;
    leaving.current = true;
    setRelease(() => () => router.replace('/terminal'));
    return true;
  }, [navigation, router]);
  useEffect(() => release?.(), [release]);

  /** Close Page: the Pane under it, and the page released, its form with it. */
  const closePage = useCallback(() => {
    if (!page || !leave()) return;
    say(`Close Page: releasing ${page.url}`);
    kept.pages.close(page.id);
  }, [page, leave, kept]);

  // A page released under this screen, as when its Topic closed on the Mac,
  // has nothing to show: the Terminal Screen takes its place. The store is
  // read here and not the render's `page`, which a render opened no page for.
  useEffect(() => {
    const { of } = shown;
    if (of && openedFor.current === shown && !kept.pages.find(of.hostId, of.owner, shown.url)) leave();
  }, [kept, livePages, shown, leave]);

  // Another Tab of the Title Sheet: its own Live Page. This one waits.
  const showTab = useCallback((tab: BrowserTab) => {
    setShown({ url: tab.url, page: tab.url, scrollY: 0, title: tab.title, of: ownerOf(attach) });
  }, [attach]);
  /**
   * A pick in the Title Sheet. A Topic or Session whose Place has a Tab shows that
   * page in place of this one, in one move; any other pick puts the Terminal
   * Screen back in this one's place.
   */
  const moved = useCallback((tab: PlaceTab | null) => {
    if (!tab) {
      leave();
      return;
    }
    if (leaving.current) return;
    leaving.current = true;
    setRelease(() => () => router.replace(placeTabRoute(tab)));
  }, [leave, router]);
  const onScreen = useMemo((): OnScreen => ({ kind: 'tab', url: shown.url }), [shown.url]);
  const chooser = useTitleSheet({ attach, state, hostId, onOpenTab: showTab, onMoved: moved,
    onReplacingStopped: opening.forgetLookup, onScreen });
  const switcher = useEdgeSwitcher(chooser.drawer, chooser.openDrawer);
  const goHost = useGoHost(hostId);
  /**
   * The Grip actions this screen runs. The page has no Pane, Composer or
   * Options of its own, so those slots are dimmed and keep their places.
   */
  const gripActions: GripActionRuns = {
    ...NO_GRIP_ACTIONS,
    'go-to': hostId ? () => { requestGoTo(hostId); goHost(); } : undefined,
    'title-sheet': chooser.openTitleSheet,
    'host-screen': goHost,
  };

  // A page that a Place opened: once the Attach is back in the Place's
  // Window, the Host must still list the Tab. A Tab closed on the Mac sends the
  // user to the Pane, and the Place forgets it. A read that fails says nothing,
  // and the page stays.
  const restored = params.restored === '1';
  const tabToRestore = state?.tabToRestore ?? null;
  useEffect(() => {
    if (!restored || !attach || !tabToRestore || !focused || !hostId) return;
    const wanted = attach.takeTabToRestore();
    if (!wanted || wanted.tab.url !== shown.url) return;
    const window = attach.state().topology.activeWindow?.id;
    void (async () => {
      const read = window ? await readBrowserTabs(hostId, window) : { kind: 'failed' as const, error: 'no active Window' };
      const restore = tabRestoreOf(read, wanted.tab.url);
      if (restore.kind === 'gone') {
        say(`the Place's Tab ${wanted.tab.url} is no longer listed; going to the Pane`);
        if (leave() && page) kept.pages.close(page.id);
      } else if (restore.unread !== null) {
        say(`the Tabs of ${window} did not read (${restore.unread}); keeping ${wanted.tab.url}`);
      }
    })();
  }, [restored, attach, tabToRestore, focused, hostId, shown.url, leave, page, kept]);

  // A new Attach, or a Topic that the Attach went to from elsewhere, is
  // somewhere else: the Terminal Screen shows it. A Topic picked in this
  // screen's Title Sheet waits for the pick, which says where to go. A cold
  // start's page arrives with no Attach, and the first one is its own.
  const topicId = state?.topic?.id ?? null;
  const [arrivedIn, setArrivedIn] = useState(() => (coldStart ? null : { attach, topicId }));
  if (arrivedIn === null && attach) setArrivedIn({ attach, topicId });
  const openingTopic = chooser.openingTopic;
  useEffect(() => {
    if (arrivedIn && focused && !openingTopic && (attach !== arrivedIn.attach || topicId !== arrivedIn.topicId)) leave();
  }, [focused, openingTopic, attach, topicId, arrivedIn, leave]);

  // The cold start's Connection Screen, until its Attach is attached. The
  // page counts as the Attach's first paint: after it, a wait or a failure
  // leaves the page as it is, as on a page opened from the Host Screen.
  const [pageShownFor, setPageShownFor] = useState<Attach | null>(null);
  if (attach && attach !== pageShownFor && state?.typing.kind === 'open') setPageShownFor(attach);
  const place = {
    hostName: attach?.hostName ?? opening.hostName,
    session: state?.sessionName ?? opening.session,
  };
  const cover = coverOf({
    missing: opening.missing,
    lookup: opening.lookup,
    attach: state ? { typing: state.typing, step: state.step, paintedOnce: attach === pageShownFor } : null,
    place,
  });
  const runCoverAction = useCoverAction({ opening, attach, hostId, openSessionsOnly: chooser.openSessionsOnly, say });

  const pageTitle = title || shown.title || shown.page;
  const headerTitle = useMemo((): HeaderTitle | null => {
    if (!state) return null;
    return chooser.topic
      ? { kind: 'topic', topic: chooser.topic.label, program: `🌐 ${pageTitle}`, session: state.sessionName }
      : { kind: 'session', session: state.sessionName, program: pageTitle };
  }, [state, chooser.topic, pageTitle]);

  const reload = () => view?.reload();

  return (
    <HeaderBand color={palette.background}>
      <Stack.Screen options={{ title: pageTitle }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel="Reload" onPress={reload} />
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close Page" onPress={closePage} />
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
      <View style={styles.fill}>
        {page ? <LivePageHost id={page.id} /> : <View style={styles.fill} />}
        {failure === null ? null : (
          <View style={[styles.failure, { backgroundColor: palette.background }]}>
            <Text style={[styles.reason, { color: palette.destructive }]}>{failure}</Text>
            <Text style={[styles.address, { color: palette.secondaryLabel }]}>{shown.page}</Text>
            <Pressable accessibilityRole="button" onPress={reload}>
              <Text style={[styles.retry, { color: palette.controlAccent }]}>Try again</Text>
            </Pressable>
          </View>
        )}
        {/* Over the page at the right edge: the page scrolls under the rest. */}
        <EdgeGrip
          enabled={state?.typing.kind === 'open' && !chooser.sheet.isPresented && cover.kind !== 'connection-screen'}
          actions={gripActions}
          {...switcher.grip}
        />
        <EdgeDrawer {...switcher.drawer} />
      </View>
      {coldStart && cover.kind === 'connection-screen' ? (
        <ConnectionScreen
          cover={cover}
          place={opening.missing === null && place.hostName !== '' ? place : null}
          palette={palette}
          appearance={appearance}
          onAction={runCoverAction}
        />
      ) : null}
      <TitleSheet {...chooser.sheet} />
    </HeaderBand>
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
