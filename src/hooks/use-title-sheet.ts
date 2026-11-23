import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RenameParams } from '@/app/rename';
import { readBrowserTabs } from '@/browser/read-browser-tabs';
import type { BrowserTab } from '@/browser/tabs';
import type { PlaceTab } from '@/storage/records';
import type { TopicRow } from '@/components/host-screen-row-view';
import type { PreviewCard } from '@/components/picker-sheet';
import type { TitlePick, TitleSheetProps } from '@/components/title-sheet';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { actionsFor } from '@/domain/cover';
import { lastAnswer } from '@/domain/host-listing';
import { topicSections } from '@/domain/host-screen';
import { titleSheetNotice } from '@/domain/title-sheet-notice';
import { sessionTitleRows, topicTitleRows, type TitleRow, type TitleWindowRow } from '@/domain/title-rows';
import { useHostEntry } from '@/hooks/use-host-entry';
import { useLiveListing } from '@/hooks/use-host-listing';
import { useHostReading } from '@/hooks/use-host-reading';
import { useTmuxWrites } from '@/hooks/use-tmux-writes';
import { describeError } from '@/lib/describe-error';
import type { ChooserLists } from '@/settings/settings';
import { useChooserLists, useSettings } from '@/settings/settings-context';
import type { Attach, AttachState } from '@/tmux/attach';
import { useAttachHolder } from '@/tmux/attach-context';
import { trimPreview } from '@/tmux/preview';
import { lastTopic } from '@/topics/topic-detail';
import {
  sessionActions,
  TMUX_MENU_LABEL,
  TMUX_ORDER_ICON,
  type SessionAction,
  type SessionOnHost,
  type WindowAction,
} from '@/topics/tmux-order';

const say = speakingAs(deviceLog(), 'screen');

/** `sessionsOnly` is the sheet opened by Choose a Session, on a Session that has ended. */
type TitleSheetState = { open: false } | { open: true; revision: number; error?: string; sessionsOnly?: boolean };

export interface TitleSheetOptions {
  attach: Attach | null;
  state: AttachState | null;
  hostId: string | undefined;
  /** A Tab picked in the sheet, which has closed. */
  onOpenTab: (tab: BrowserTab) => void;
  /**
   * The user went to another Window, Session or Topic from the sheet, which
   * has closed. `tab` is the Tab of the Place of a Topic or Session opened there.
   */
  onMoved?: (tab: PlaceTab | null) => void;
  /** The sheet is about to open: a screen closes its other sheets. */
  beforeOpen?: () => void;
  /** A Session picked while the Attach has stopped, which opens a new Attach. */
  onReplacingStopped?: () => void;
}

/**
 * The Title Sheet's state and what its picks do, for each screen that has the
 * Header: the Terminal Screen and the Web View. Each renders `<TitleSheet>`
 * with `sheet`, so the two cannot drift apart.
 */
export function useTitleSheet({ attach, state, hostId, onOpenTab, onMoved, beforeOpen, onReplacingStopped }: TitleSheetOptions) {
  const holder = useAttachHolder();
  const navigation = useNavigation();
  const router = useRouter();
  const { appearance, palette: chrome } = useSettings();
  const [titleSheet, setTitleSheet] = useState<TitleSheetState>({ open: false });
  const chooserRevision = useRef(0);
  const closeChooser = useCallback(() => {
    chooserRevision.current += 1;
    setTitleSheet({ open: false });
  }, []);
  const entered = useCallback((tab: PlaceTab | null = null) => {
    closeChooser();
    onMoved?.(tab);
  }, [closeChooser, onMoved]);

  const chooserLists = useChooserLists(hostId ?? '');
  const topicsOn = chooserLists.includes('topics');
  const windowsOn = chooserLists.includes('windows');
  const sessionsOn = chooserLists.includes('sessions');
  const { topics: hostTopics, listing, read: readHost, problem } = useHostReading(hostId ?? '');
  const pickerTopics = useMemo(
    () => (topicsOn ? topicSections(hostTopics, appearance) : []),
    [topicsOn, hostTopics, appearance],
  );
  const hostEntry = useHostEntry(hostId ?? '', entered, true);
  const handover = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(useCallback(() => () => {
    if (handover.current) clearTimeout(handover.current);
    closeChooser();
  }, [closeChooser]));
  /** Closes the sheet, and runs `next` once it has left, so that another sheet can be presented. */
  const handOver = useCallback((next: () => void) => {
    closeChooser();
    if (handover.current) clearTimeout(handover.current);
    handover.current = setTimeout(next, SHEET_HANDOVER_MS);
  }, [closeChooser]);
  const openTopic = useCallback((row: TopicRow) => {
    // The Topic the user is in: nothing to open, and a restore would show its page again.
    if (row.seed.id === state?.topic?.id) {
      closeChooser();
      return;
    }
    if (row.seed.state === 'live') {
      const revision = chooserRevision.current;
      hostEntry.openTopic(row.seed, {
        isCurrent: () => chooserRevision.current === revision && holder.current() === attach,
        onError: (error) => setTitleSheet((previous) => previous.open ? { ...previous, error: describeError(error) } : previous),
      });
      return;
    }
    const session = state?.sessionName;
    handOver(() => {
      if (holder.current() === attach && attach?.state().sessionName === session && navigation.isFocused()) {
        hostEntry.openTopic(row.seed);
      }
    });
  }, [attach, closeChooser, handOver, holder, hostEntry, navigation, state?.sessionName, state?.topic?.id]);

  /**
   * The Session and Window Actions, offered while the Host Server is live: it
   * knows each Session's id and Topic. Sessions only offers none.
   */
  const live = useLiveListing(hostId ?? '');
  const served = live?.server.kind === 'live' ? live.snapshot : null;
  const onHost = useMemo(
    () => new Map<string, SessionOnHost>(served?.sessions.map((session) => [session.name, { id: session.id, inTopic: session.topic !== null }])),
    [served],
  );
  const tmuxWrites = useTmuxWrites(hostId ?? '');
  const rename = useCallback((params: Omit<RenameParams, 'hostId'>) => {
    if (!hostId) return;
    handOver(() => {
      if (navigation.isFocused()) router.push({ pathname: '/rename', params: { hostId, ...params } });
    });
  }, [handOver, hostId, navigation, router]);
  const actOnSession = (name: string, action: string) => {
    const session = onHost.get(name)?.id;
    if (session === undefined) return;
    switch (action as SessionAction) {
      case 'rename-session':
        rename({ kind: 'session', id: session, name });
        break;
      case 'remove-from-topic':
        void tmuxWrites.order({ kind: 'remove-from-topic', session });
        break;
      case 'stop-session':
        tmuxWrites.confirm({ kind: 'stop-session', session }, name);
        break;
    }
  };
  const actOnWindow = (row: TitleWindowRow, action: WindowAction) => {
    if (action === 'rename-window') rename({ kind: 'window', id: row.id, name: row.name });
    else tmuxWrites.confirm({ kind: 'close-window', window: row.id }, row.name);
  };
  /** A Session card with its menu, and its spinner while one of its Actions runs. A card's id is its Session's name. */
  const withActions = (card: PreviewCard): PreviewCard => {
    const session = onHost.get(card.id);
    if (session === undefined) return card;
    return {
      ...card,
      busy: card.busy || tmuxWrites.writing(session.id),
      menu: sessionActions(session).map((action) => ({
        id: action, label: TMUX_MENU_LABEL[action], systemImage: TMUX_ORDER_ICON[action], destructive: action === 'stop-session',
      })),
    };
  };

  /** The Session a switch is on its way to, whose row shows it is busy. */
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  /**
   * Where the Sessions list comes from. The Attach's own list while it is up;
   * once it has stopped, it has no Connection to ask, so the Host is asked
   * the way the Host Screen asks it.
   */
  const sessionsFromHost = state?.typing.kind !== 'open' && state?.typing.kind !== 'waiting';
  const sessionCards = useMemo((): PreviewCard[] => {
    if (sessionsFromHost) {
      return (lastAnswer(listing) ?? []).map((session) => ({
        id: session.name,
        title: session.name,
        detail: session.windowCount === undefined
          ? session.name
          : `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
        current: false,
        preview: [],
      }));
    }
    if (!state) return [];
    return (state.sessions ?? []).map((session) => ({
      id: session.name,
      title: session.name,
      detail: `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
      current: session.name === state?.sessionName,
      busy: session.name === switchingTo,
      preview: previewOf(state.previews, `${session.name}:`),
    }));
  }, [state, sessionsFromHost, listing, switchingTo]);

  const topicView = state?.topic?.view;
  const topic = topicView ? lastTopic(topicView) : null;
  /** The Title Sheet's Retry: the Topic is followed again with a new subscription. */
  const rereadTopic = useCallback(() => { attach?.refreshTopic(); }, [attach]);
  // While this screen is focused it shows the Topic, in its Header and this
  // sheet, and the Attach follows the Topic's pushes.
  useFocusEffect(useCallback(() => attach?.showTopic(), [attach]));

  const sessionName = state?.sessionName;
  const [windowTabs, setWindowTabs] = useState<{ revision: number; session: string | undefined; window: string; tabs: BrowserTab[] } | null>(null);
  const activeWindowId = state?.topology.activeWindow?.id;
  const titleRevision = titleSheet.open ? titleSheet.revision : null;
  useEffect(() => {
    setWindowTabs(null);
    if (!windowsOn || titleRevision === null || !hostId || !activeWindowId) return;
    let current = true;
    void readBrowserTabs(hostId, activeWindowId).then((read) => {
      if (current && chooserRevision.current === titleRevision && holder.current() === attach &&
          attach?.state().sessionName === sessionName && attach?.state().topology.activeWindow?.id === activeWindowId) {
        setWindowTabs({ revision: titleRevision, session: sessionName, window: activeWindowId, tabs: read.kind === 'listed' ? read.tabs : NO_TABS });
      }
    });
    return () => { current = false; };
  }, [windowsOn, titleRevision, hostId, activeWindowId, sessionName, attach, holder]);

  const openTitleSheet = useCallback(() => {
    if (!attach) return;
    if (handover.current) clearTimeout(handover.current);
    beforeOpen?.();
    setTitleSheet({ open: true, revision: ++chooserRevision.current });
    attach.refreshTopology();
    if (sessionsOn) attach.capturePreviews((state?.sessions ?? []).map((session) => `${session.name}:`));
    if (topicsOn) void readHost();
  }, [attach, state, topicsOn, sessionsOn, readHost, beforeOpen]);

  const openTab = useCallback(
    (tab: BrowserTab) => {
      say(`picked Tab ${tab.id}`);
      closeChooser();
      onOpenTab(tab);
    },
    [onOpenTab, closeChooser],
  );

  const titleRows = useMemo((): TitleRow[] => {
    if (!state) return [];
    if (state.topic) {
      return topic
        ? topicTitleRows(topic, { session: state.sessionName, topology: state.topology })
        : [{ kind: 'session', name: state.sessionName, current: true, windows: sessionTitleRows(state.topology) }];
    }
    return sessionTitleRows(state.topology);
  }, [state, topic]);

  const chooserBusy = useRef(false);
  const choose = useCallback((pick: TitlePick, explicitTopic: boolean) => {
    if (!attach || !state || chooserBusy.current) return;
    const revision = chooserRevision.current;
    const current = () => chooserRevision.current === revision && holder.current() === attach;
    chooserBusy.current = true;
    if (pick.session !== null && pick.session !== state.sessionName) setSwitchingTo(pick.session);
    void (async () => {
      try {
        if (pick.session !== null) {
          await attach.switchSession({ sessionName: pick.session,
            topic: explicitTopic && state.topic ? { id: state.topic.id, seed: topic } : null });
        }
        if (!current() || attach.state().sessionName !== (pick.session ?? state.sessionName)) return;
        if (pick.window !== null) await attach.selectWindow(pick.window);
        if (current()) entered();
      } catch (error) {
        if (current()) setTitleSheet((previous) => previous.open ? { ...previous, error: describeError(error) } : previous);
      } finally {
        chooserBusy.current = false;
        setSwitchingTo(null);
      }
    })();
  }, [attach, state, topic, holder, entered]);
  const selectSession = useCallback((session: string) => {
    if (!sessionsFromHost) {
      choose({ session, window: null }, false);
      return;
    }
    // The Attach has stopped, so the pick is a new one.
    say(`choosing ${session} in place of a Session that has stopped`);
    onReplacingStopped?.();
    hostEntry.openSession(session);
  }, [choose, sessionsFromHost, hostEntry, onReplacingStopped]);

  /** Choose a Session, from a Session that has ended: the Title Sheet with its Sessions only. */
  const openSessionsOnly = useCallback(() => {
    if (handover.current) clearTimeout(handover.current);
    beforeOpen?.();
    setTitleSheet({ open: true, revision: ++chooserRevision.current, sessionsOnly: true });
    void readHost();
  }, [readHost, beforeOpen]);
  const pickTitleRow = useCallback((pick: TitlePick) => choose(pick, true), [choose]);

  /**
   * The one Try again for a Host Problem: every read of the Host the sheet
   * shows, and the Attach too when its Cover would offer the same.
   */
  const tryHostAgain = useCallback(() => {
    void readHost();
    rereadTopic();
    const typing = attach?.state().typing;
    if (typing?.kind === 'stopped' && typing.reason &&
        actionsFor(typing.reason.kind).some((action) => action === 'reconnect' || action === 'try-again')) {
      attach?.reconnect();
    }
  }, [attach, readHost, rereadTopic]);
  const notice = titleSheet.open
    ? titleSheetNotice({ actionError: titleSheet.error, problem, hostName: attach?.hostName ?? 'the Host', topic: topicView })
    : null;

  const sheet: TitleSheetProps = {
    isPresented: titleSheet.open,
    onDismiss: closeChooser,
    lists: titleSheet.open && titleSheet.sessionsOnly ? SESSIONS_ONLY : chooserLists,
    rows: titleRows,
    topic,
    onRetry: notice?.retry === 'host' ? tryHostAgain : notice?.retry === 'topic' ? rereadTopic : undefined,
    loading: titleSheet.open && topicView?.kind === 'loading',
    error: notice?.text,
    sessions: {
      cards: sessionCards.map(withActions),
      loading: sessionsFromHost ? listing.phase === 'reading' : state?.sessions == null,
      onSelect: selectSession,
      onAction: actOnSession,
    },
    topics: topicsOn ? { sections: pickerTopics, palette: chrome, onOpenTopic: openTopic, onRetry: () => void readHost() } : undefined,
    onPick: pickTitleRow,
    onWindowAction: served === null ? undefined : actOnWindow,
    tabs: windowTabs?.revision === titleRevision && windowTabs.session === sessionName && windowTabs.window === activeWindowId
      ? windowTabs.tabs
      : NO_TABS,
    onOpenTab: openTab,
  };

  /** A Topic picked in the sheet is on its way: the Attach can already be in it. */
  const openingTopic = hostEntry.busyCard !== null;
  return { sheet, openTitleSheet, openSessionsOnly, closeChooser, topic, rereadTopic, openingTopic };
}

/** How long a sheet takes to leave, so the next one can be presented. */
const SHEET_HANDOVER_MS = 450;
const NO_TABS: BrowserTab[] = [];
const SESSIONS_ONLY: ChooserLists = ['sessions'];

function previewOf(previews: Map<string, string[]>, target: string): string[] {
  return trimPreview(previews.get(target) ?? [], PREVIEW_LINES, PREVIEW_COLUMNS);
}

/** How many captured lines a preview box can show before it is just noise. */
const PREVIEW_LINES = 14;
const PREVIEW_COLUMNS = 46;

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
