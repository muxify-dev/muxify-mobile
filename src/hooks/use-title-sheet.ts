import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readBrowserTabs } from '@/browser/read-browser-tabs';
import type { BrowserTab } from '@/browser/tabs';
import type { TopicRow } from '@/components/host-screen-row-view';
import type { PreviewCard } from '@/components/picker-sheet';
import type { TitlePick, TitleSheetProps } from '@/components/title-sheet';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { lastAnswer } from '@/domain/host-listing';
import { topicSections } from '@/domain/host-screen';
import { sessionTitleRows, topicTitleRows, type TitleRow } from '@/domain/title-rows';
import { useHostEntry } from '@/hooks/use-host-entry';
import { useHostReading } from '@/hooks/use-host-reading';
import { describeError } from '@/lib/describe-error';
import type { ChooserLists } from '@/settings/settings';
import { useChooserLists, useSettings } from '@/settings/settings-context';
import type { Attach, AttachState } from '@/tmux/attach';
import { useAttachHolder } from '@/tmux/attach-context';
import { trimPreview } from '@/tmux/preview';
import { lastTopic } from '@/topics/topic-detail';

const say = speakingAs(deviceLog(), 'screen');

/** `sessionsOnly` is the sheet opened by Choose a Session, on a Session that has ended. */
type TitleSheetState = { open: false } | { open: true; revision: number; error?: string; sessionsOnly?: boolean };

export interface TitleSheetOptions {
  attach: Attach | null;
  state: AttachState | null;
  hostId: string | undefined;
  /** A Tab picked in the sheet, which has closed. */
  onOpenTab: (tab: BrowserTab) => void;
  /** The user went to another Window, Session or Topic from the sheet, which has closed. */
  onMoved?: () => void;
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
  const { appearance, palette: chrome } = useSettings();
  const [titleSheet, setTitleSheet] = useState<TitleSheetState>({ open: false });
  const chooserRevision = useRef(0);
  const closeChooser = useCallback(() => {
    chooserRevision.current += 1;
    setTitleSheet({ open: false });
  }, []);
  const entered = useCallback(() => {
    closeChooser();
    onMoved?.();
  }, [closeChooser, onMoved]);

  const chooserLists = useChooserLists(hostId ?? '');
  const topicsOn = chooserLists.includes('topics');
  const windowsOn = chooserLists.includes('windows');
  const sessionsOn = chooserLists.includes('sessions');
  const { topics: hostTopics, listing, read: readHost } = useHostReading(hostId ?? '', topicsOn);
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
  const openTopic = useCallback((row: TopicRow) => {
    if (row.seed.state === 'live') {
      const revision = chooserRevision.current;
      hostEntry.openTopic(row.seed, {
        isCurrent: () => chooserRevision.current === revision && holder.current() === attach,
        onError: (error) => setTitleSheet((previous) => previous.open ? { ...previous, error: describeError(error) } : previous),
      });
      return;
    }
    closeChooser();
    if (handover.current) clearTimeout(handover.current);
    const session = state?.sessionName;
    handover.current = setTimeout(() => {
      if (holder.current() === attach && attach?.state().sessionName === session && navigation.isFocused()) {
        hostEntry.openTopic(row.seed);
      }
    }, SHEET_HANDOVER_MS);
  }, [attach, closeChooser, holder, hostEntry, navigation, state?.sessionName]);

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
  const rereadTopic = useCallback(() => { void attach?.refreshTopic(); }, [attach]);

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
    if (state?.topic) rereadTopic();
    if (topicsOn) void readHost();
  }, [attach, state, rereadTopic, topicsOn, sessionsOn, readHost, beforeOpen]);

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

  const sheet: TitleSheetProps = {
    isPresented: titleSheet.open,
    onDismiss: closeChooser,
    lists: titleSheet.open && titleSheet.sessionsOnly ? SESSIONS_ONLY : chooserLists,
    rows: titleRows,
    topic,
    onRetry: titleSheet.open && titleSheet.error !== undefined ? undefined : rereadTopic,
    loading: titleSheet.open && topicView?.kind === 'loading',
    error: titleSheet.open
      ? (titleSheet.error ?? (topicView?.kind === 'failed' ? topicView.error : undefined))
      : undefined,
    sessions: {
      cards: sessionCards,
      loading: sessionsFromHost ? listing.phase === 'reading' : state?.sessions == null,
      onSelect: selectSession,
    },
    topics: topicsOn ? { sections: pickerTopics, palette: chrome, onOpenTopic: openTopic, onRetry: () => void readHost() } : undefined,
    onPick: pickTitleRow,
    tabs: windowTabs?.revision === titleRevision && windowTabs.session === sessionName && windowTabs.window === activeWindowId
      ? windowTabs.tabs
      : NO_TABS,
    onOpenTab: openTab,
  };

  return { sheet, openTitleSheet, openSessionsOnly, closeChooser, topic, rereadTopic };
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
