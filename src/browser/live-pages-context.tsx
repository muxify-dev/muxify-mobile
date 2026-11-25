import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Portal, PortalHost, PortalProvider } from 'react-native-teleport';
import { WebView } from 'react-native-webview';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import type { PlaceTab } from '@/storage/records';
import { openTopics, sessionNamesHad } from '@/topics/environment';
import { appConnections } from '@/tmux/ssh-connection';

import { createLivePages, type LivePage, type LivePages } from './live-pages';

const say = speakingAs(deviceLog(), 'browser');

/** How long the page rests before where it is goes into the Place. */
const SCROLL_SETTLE_MS = 400;

type Where = Pick<PlaceTab, 'page' | 'scrollY'>;

/** What the Web View that shows a Live Page reads of it, and asks of it. */
export interface LivePageView {
  /** The page's own title, empty until it has one. */
  title(): string;
  /** Why the last load failed; null while the page loads or shows. */
  failure(): string | null;
  /** The page shown now and how far it is scrolled, for the Place. */
  where(): Where;
  /** Hears a new title or failure, a followed link, and a scroll that has come to rest. */
  subscribe(listener: () => void): () => void;
  reload(): void;
}

interface Kept {
  pages: LivePages;
  view(id: number): PageViewState;
}

const LivePagesContext = createContext<Kept | null>(null);

/** The name of the PortalHost that a Web View puts in its body to show the page. */
export function livePageHost(id: number): string {
  return `live-page-${id}`;
}

/**
 * Keeps every Live Page loaded while no screen shows it, so leaving a page
 * and coming back finds it as it was. See ADR 0033.
 *
 * Each page's WebView is rendered here, above the navigator, so that no
 * screen's unmount ends it. A Web View screen that shows the page has a
 * PortalHost of the page's name: react-native-teleport then moves the
 * native WKWebView into it, with no remount, and back here when that screen
 * goes. Here it sits under the navigator's screens, out of sight.
 *
 * The pages of a Topic or Session that a Host's Listing has no more are
 * released here too.
 */
export function LivePagesProvider({ children }: { children: ReactNode }) {
  const kept = useMemo<Kept>(() => {
    const pages = createLivePages(undefined, say);
    const views = new Map<number, PageViewState>();
    pages.subscribe(() => {
      const live = new Set(pages.all().map((page) => page.id));
      for (const id of views.keys()) if (!live.has(id)) views.delete(id);
    });
    return {
      pages,
      view(id) {
        const known = views.get(id);
        if (known) return known;
        const page = pages.all().find((candidate) => candidate.id === id);
        // A released page gets a view that nothing keeps.
        const view = pageViewState(page?.start ?? { page: '', scrollY: 0 });
        if (page) views.set(id, view);
        return view;
      },
    };
  }, []);

  useEffect(() => appConnections().subscribeListing((hostId) => {
    const received = appConnections().listing(hostId)?.received;
    if (!received) return;
    kept.pages.prune(hostId, {
      topics: new Set(openTopics(received.snapshot).map((topic) => topic.id)),
      sessions: sessionNamesHad(received.snapshot),
    }, received.at);
  }), [kept]);

  const pages = useSyncExternalStore(kept.pages.subscribe, kept.pages.all);

  return (
    <LivePagesContext.Provider value={kept}>
      <PortalProvider>
        <View style={styles.fill}>
          <View style={StyleSheet.absoluteFill}>
            {pages.map((page) => (
              <KeptPage key={page.id} page={page} view={kept.view(page.id)} />
            ))}
          </View>
          {children}
        </View>
      </PortalProvider>
    </LivePagesContext.Provider>
  );
}

export function useLivePages(): { pages: LivePages; view(id: number): LivePageView } {
  const kept = useContext(LivePagesContext);
  if (!kept) throw new Error('No LivePagesProvider above this screen');
  return kept;
}

const NO_PAGE = { subscribe: () => () => {}, title: () => '', failure: () => null };

/** The title and the failure of the page a Web View shows. Re-renders when they change. */
export function useLivePageState(view: LivePageView | null): { title: string; failure: string | null } {
  const { subscribe, title, failure } = view ?? NO_PAGE;
  return {
    title: useSyncExternalStore(subscribe, title),
    failure: useSyncExternalStore(subscribe, failure),
  };
}

/** Where a Web View screen shows the page: the WKWebView moves in here. */
export function LivePageHost({ id }: { id: number }) {
  return <PortalHost name={livePageHost(id)} style={styles.fill} />;
}

interface PageViewState extends LivePageView {
  set(change: { title?: string; failure?: string | null; where?: Where }): void;
  /** Where the page is, without telling anyone: a scroll that has not come to rest. */
  move(where: Where): void;
  /** The ref of the page's WebView, which `reload` and the scroll back use. */
  bind(webView: WebView | null): void;
  scrollTo(y: number): void;
}

function pageViewState(start: Where): PageViewState {
  let title = '';
  let failure: string | null = null;
  let where = start;
  const listeners = new Set<() => void>();
  let webView: WebView | null = null;
  return {
    title: () => title,
    failure: () => failure,
    where: () => where,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reload() {
      failure = null;
      for (const listener of [...listeners]) listener();
      webView?.reload();
    },
    set(change) {
      if (change.title !== undefined) title = change.title;
      if (change.failure !== undefined) failure = change.failure;
      if (change.where !== undefined) where = change.where;
      for (const listener of [...listeners]) listener();
    },
    move(next) {
      where = next;
    },
    bind(bound) {
      webView = bound;
    },
    scrollTo(y) {
      webView?.injectJavaScript(`window.scrollTo(0, ${y}); true;`);
    },
  };
}

/** One page's WebView, in the Web View that shows it or out of sight here. */
function KeptPage({ page, view }: { page: LivePage; view: PageViewState }) {
  const scrolled = useRef(page.start.scrollY === 0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  return (
    <Portal hostName={livePageHost(page.id)} style={StyleSheet.absoluteFill}>
      <WebView
        ref={(webView) => view.bind(webView)}
        source={{ uri: page.start.page }}
        style={styles.fill}
        pullToRefreshEnabled
        onNavigationStateChange={(navigation) => {
          if (navigation.title) view.set({ title: navigation.title });
          if (!navigation.loading && navigation.url && navigation.url !== view.where().page) {
            view.set({ where: { page: navigation.url, scrollY: 0 } });
          }
        }}
        onLoadEnd={({ nativeEvent }) => {
          // Back where a Place left the page, once, and only on that page: a
          // link followed since makes the old offset meaningless.
          if (scrolled.current) return;
          scrolled.current = true;
          if (nativeEvent.url !== page.start.page) return;
          say(`scrolling ${page.start.page} back to ${Math.round(page.start.scrollY)}`);
          view.scrollTo(page.start.scrollY);
        }}
        onScroll={({ nativeEvent }) => {
          view.move({ ...view.where(), scrollY: nativeEvent.contentOffset.y });
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => view.set({}), SCROLL_SETTLE_MS);
        }}
        onLoadStart={() => view.set({ failure: null })}
        onError={({ nativeEvent }) => {
          say(`could not load ${nativeEvent.url}: ${nativeEvent.description}`);
          view.set({ failure: nativeEvent.description });
        }}
        onHttpError={({ nativeEvent }) => say(`${nativeEvent.url} answered ${nativeEvent.statusCode}`)}
        // The Web View draws the reason over the page, where Reload is.
        renderError={() => <View />}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
