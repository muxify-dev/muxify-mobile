import { TerminalView, type TerminalPasteEvent, type TerminalViewRef } from 'expo-libghostty';
import { File } from 'expo-file-system';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter, type NativeStackNavigationProp } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Presence } from '@/components/banner';
import { TrackpadScroll } from '@/components/trackpad-scroll';
import type { TrackpadTarget } from '@/lib/trackpad-gesture';
import { ReconnectScreen } from '@/components/reconnect-screen';
import { KeyRow, KEY_ROW_HEIGHT } from '@/components/key-row';
import { usePhysicalKeyboard } from '@/hooks/use-physical-keyboard';
import { useKeyboardFrame } from '@/hooks/use-keyboard-frame';
import { terminalClearance, type ScreenRect } from '@/lib/terminal-clearance';
import { LayoutMap } from '@/components/layout-map';
import { ComposerPanel } from '@/composer/composer-panel';
import type { ComposerInputRef } from '@/composer/native-input';
import { stageClipboardImage, stageFile } from '@/composer/staging';
import type { TopicRow } from '@/components/host-screen-row-view';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import {
  TerminalHeader,
  type HeaderTitle,
  type OptionsItem,
} from '@/components/terminal-header';
import { ThemedText } from '@/components/themed-text';
import { TitleSheet, type TitlePick } from '@/components/title-sheet';
import {
  paletteFor,
  sheetPaletteFor,
  type Appearance,
  type TerminalPalette,
} from '@/constants/app-theme';
import { namedKeyName, type NamedKey } from '@/constants/row-keys';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { sessionTitleRows, topicTitleRows, type TitleRow } from '@/domain/title-rows';
import { topicSections } from '@/domain/host-screen';
import { useCopyLog } from '@/hooks/use-copy-log';
import { useHostReading } from '@/hooks/use-host-reading';
import { usePaneSwipe, type PaneSwipe } from '@/hooks/use-pane-swipe';
import { clampFontSize, fontSizeInForce } from '@/settings/settings';
import { useChooserLists, useSettings } from '@/settings/settings-context';
import type { TopicId } from '@/topics/environment';
import { useHostEntry } from '@/hooks/use-host-entry';
import { fieldsParam } from '@/topics/topic-edit';
import { readBrowserTabs } from '@/browser/read-browser-tabs';
import type { BrowserTab } from '@/browser/tabs';
import {
  lastTopic,
  topicSeedParam,
} from '@/topics/topic-detail';
import {
  LOOKUP_START,
  reconnect as reconnectToSession,
  reconnectProgress,
  type Lookup,
  type SessionVisit,
} from '@/domain/reconnect';
import { deviceHostStore } from '@/storage/device-store';
import type { Host } from '@/storage/records';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { describeError } from '@/lib/describe-error';
import { directoryName } from '@/lib/paths';
import { coast, createVelocityTracker, isFlick } from '@/lib/inertia';
import { panAxis, swipeOf, type PanAxis } from '@/lib/pan-axis';
import {
  applyModifiers,
  armedAfter,
  NO_MODIFIERS,
  type ModifiedInput,
  type Modifier,
  type Modifiers,
} from '@/lib/modifier-keys';
import { toShellInput, withoutTerminalReplies } from '@/lib/terminal-input';
import type { Attach, AttachPhase, AttachState, Paste } from '@/tmux/attach';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { phaseLabel } from '@/tmux/attach-labels';
import { retryCouldWork } from '@/tmux/disconnect-reason';
import { cellOf, paneBoxes, windowSlide, clippedRowHeight, type Extent, type PaneBox } from '@/tmux/pane-layout';
import type { PaneSurface, PaneView, SurfacePoint } from '@/tmux/pane-view';
import { paneTopologyFrames } from '@/tmux/pane-topology';
import { trimPreview } from '@/tmux/preview';
import type { Grid, Pane } from '@/tmux/tmux-client';

/**
 * The screen's own voice in the Log.
 *
 * What it says is what the Attach cannot know: which Surfaces are on screen
 * and where, what the Options menu, the Key Row and the sheets were asked for
 * and whether there was a Pane to ask it of, when the keyboard moved. A Pane
 * that went blank is described from both sides — the Attach's line says what
 * it was told, and this one says what was drawn.
 */
const say = speakingAs(deviceLog(), 'screen');

/**
 * How much Scrollback a finger moves, against how far it travels.
 *
 * One would be the content keeping pace with the finger, as a scroll view does.
 * A terminal is not a scroll view: there is nothing to take hold of and no
 * inertia to carry it on, and a screenful of lines is a short distance to cross
 * a long history with. Two is the finger moving a screen and the Scrollback
 * moving two.
 */
const SCROLL_SPEED = 2;

/** One Pane on screen: which Pane, where it goes, and how tall it is in cells. */
type PaneSlot = {
  pane: Pane;
  box: PaneBox;
  /** The Pane's height in cells, which its Scrollback captures are cut to. */
  rows: number;
  /**
   * Whether this Surface covers the whole Window.
   *
   * True for the single-Pane and zoomed cases, and only then is the grid it
   * reports the Window's grid — which is what the Client is sized from.
   */
  fillsWindow: boolean;
  /**
   * The Pane's part in a Pane Swipe: it moves with the finger, it waits off
   * the screen for the Pane before it to leave, or it stays where it is.
   */
  swipe: 'moves' | 'waits' | 'still';
};

type PickerState = { open: false } | { open: true; error?: string };
type TitleSheetState = { open: false } | { open: true; revision: number; error?: string };

/**
 * One Session, on screen.
 *
 * A view over the Attach the app is holding, and nothing more. It subscribes
 * on mount and unsubscribes on unmount and starts and stops nothing: the
 * Connection, the Client's size, the Topology and each Pane's readiness all
 * belong to modules that outlive this screen. What is left here is layout,
 * gestures and chrome — which is the whole of what this file is for.
 *
 * If it arrives with nothing attached, or with a Session other than the one
 * the route names, it asks the root to open one. That is the only thing it
 * ever asks of an Attach's life.
 */
export default function TerminalScreen() {
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const {
    hostId: routeHostId,
    session: sessionParam,
    topicId: routeTopicId,
    reconnect,
  } = useLocalSearchParams<{
    hostId?: string;
    session?: string;
    /** The Topic from an external link or Last Place. */
    topicId?: string;
    /** Set by a cold start that reopens the Last Place: look first, then attach. */
    reconnect?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { settings, update, terminal, ansi, appearance } = useSettings();

  const bootstrap = useRef({ hostId: routeHostId, session: sessionParam, topicId: routeTopicId, reconnect });
  const bootstrapAttempt = useRef(-1);
  const holder = useAttachHolder();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
  const hostId = attach?.hostId ?? routeHostId;
  /** Why the screen could not even ask for an Attach: a Host that has gone. */
  const [missing, setMissing] = useState<string | null>(null);
  /** The visit that finds the Session before a cold-start reconnect attaches. */
  const [lookup, setLookup] = useState<Lookup>(reconnect ? LOOKUP_START : { kind: 'found' });
  const [reconnectHost, setReconnectHost] = useState('');
  /** Dismissed by the user; the Attach still knows the key changed. */
  const [keyWarningSeen, setKeyWarningSeen] = useState(false);
  /** Bumped by Try again, to run the reconnect once more. Nothing else retries it. */
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const tryReconnectAgain = useCallback(() => {
    setKeyWarningSeen(false);
    setLookup(LOOKUP_START);
    setReconnectAttempt((attempt) => attempt + 1);
  }, []);
  const reconnecting = reconnectProgress(lookup, state?.phase ?? null);
  /** Up until the reconnect first attaches; a later drop is the Banner's. */
  const [showReconnect, setShowReconnect] = useState(reconnect !== undefined);
  useEffect(() => {
    if (reconnecting.kind === 'attached') setShowReconnect(false);
  }, [reconnecting.kind]);

  const goHost = useCallback(() => {
    if (hostId) router.dismissTo({ pathname: '/hosts/[id]', params: { id: hostId } });
    else router.dismissTo('/');
  }, [hostId, router]);

  useLayoutEffect(() => {
    if (!hostId) return;
    const ensureParents = () => {
      if (!navigation.isFocused()) return;
      const stack = navigation.getState();
      if (!stack || stack.routes[stack.index]?.name !== 'terminal') return;
      const parent = stack.routes[stack.index - 1];
      if (stack.index === 2 && stack.routes[0]?.name === 'index' && parent?.name === 'hosts/[id]' && (parent.params as { id?: string })?.id === hostId) return;
      const home = stack.routes.find((route) => route.name === 'index') ?? { name: 'index' };
      const host = stack.routes.find((route) => route.name === 'hosts/[id]' && (route.params as { id?: string })?.id === hostId)
        ?? { name: 'hosts/[id]', params: { id: hostId } };
      const routes: { key?: string; name: string; params?: object }[] = [home, host, stack.routes[stack.index]];
      say('restoring Host parents for Terminal');
      navigation.reset({ index: 2, routes });
    };
    const stop = navigation.addListener('state', ensureParents);
    ensureParents();
    return stop;
  }, [hostId, navigation]);

  /**
   * Asks the root for the Session this route names, if it is not already up.
   *
   * The only life-cycle act left in this file, and it is a request rather than
   * a start: the holder decides whether anything happens, and tapping the row
   * of a Session that is already attached happens to mean nothing at all.
   */
  useEffect(() => {
    say(`opened for ${hostId ?? '?'}:${sessionParam ?? '?'}`);
    const requested = routeHostId && sessionParam
      ? { hostId: routeHostId, session: sessionParam, topicId: routeTopicId, reconnect }
      : reconnectAttempt > 0 && reconnectAttempt > bootstrapAttempt.current ? bootstrap.current : null;
    if (!requested?.hostId || !requested.session) {
      setMissing(holder.current() ? null : 'No Host was chosen.');
      return;
    }
    bootstrap.current = requested;
    bootstrapAttempt.current = reconnectAttempt;
    let left = false;
    void (async () => {
      const store = deviceHostStore();
      const records = await store.load();
      const host = records.hosts.find((candidate) => candidate.id === requested.hostId);
      if (left) return;
      if (!host) {
        say('the Host in the route is no longer saved');
        setMissing('This Host is no longer saved.');
        return;
      }
      setMissing(null);
      const request = {
        host,
        destination: { sessionName: requested.session!, topic: requested.topicId ? { id: requested.topicId as TopicId, seed: null } : null },
        zoomed: settings.zoomMultipaneWindows,
      };
      if (!requested.reconnect) {
        await holder.open(request);
        if (!left) router.setParams({ hostId: '', session: '', topicId: '', reconnect: '' });
        return;
      }
      setReconnectHost(host.displayName);
      let accepted = false;
      await reconnectToSession({
        session: requested.session!,
        visit: sessionVisit(host),
        attach: async () => {
          if (left) return;
          const opened = await holder.open(request);
          // Try again after a failed Attach: the holder hands back the same
          // Attach, still disconnected, so it is asked for another go.
          if (opened.state().phase.kind === 'disconnected') opened.reconnect();
          accepted = true;
        },
        progress: (next) => {
          if (!left) setLookup(next);
        },
      });
      if (!left && accepted) router.setParams({ hostId: '', session: '', topicId: '', reconnect: '' });
    })().catch((error) => { if (!left) setMissing(describeError(error)); });
    return () => {
      left = true;
      say('left');
    };
    // The Zoom preference is what the Session is *opened* with; changing it in
    // Settings must not reopen a Session that is already up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holder, routeHostId, sessionParam, reconnectAttempt]);

  /** The Surface area's size in points, which every Pane is placed inside. */
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [paneGrids, setPaneGrids] = useState<ReadonlyMap<string, Grid>>(new Map());
  /** Scroll distance not yet worth a notch of the wheel. */
  const carriedLines = useRef(0);
  const physicalKeyboard = usePhysicalKeyboard();
  const keyboardFrame = useKeyboardFrame();
  const keyboardVisible = keyboardFrame !== null && keyboardFrame.height > 0;
  const rootView = useRef<View>(null);
  const [rootBounds, setRootBounds] = useState<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const clearance = terminalClearance(
    rootBounds,
    keyboardFrame,
    insets.bottom,
    physicalKeyboard ? 'hidden' : Platform.OS === 'ios' && Platform.isPad ? 'dockable' : 'floating',
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const composerInput = useRef<ComposerInputRef | null>(null);
  /**
   * The sticky modifiers the Key Row is holding down.
   *
   * A phone keyboard cannot hold a key while another is pressed, so ctrl is
   * armed by a tap and spent on whatever comes next — from the row or from the
   * system keyboard. See modifier-keys.
   */
  const [armed, setArmed] = useState<Modifiers>(NO_MODIFIERS);
  /** The same, where the Surface's input callback can read it without rebuilding. */
  const armedRef = useRef<Modifiers>(NO_MODIFIERS);
  armedRef.current = physicalKeyboard ? NO_MODIFIERS : armed;
  useLayoutEffect(() => {
    if (physicalKeyboard) setArmed(NO_MODIFIERS);
    say(`physical keyboard ${physicalKeyboard ? 'connected' : 'disconnected'}`);
  }, [physicalKeyboard]);
  const [picker, setPicker] = useState<PickerState>({ open: false });
  const [titleSheet, setTitleSheet] = useState<TitleSheetState>({ open: false });
  const chooserRevision = useRef(0);
  const closeChooser = useCallback(() => {
    chooserRevision.current += 1;
    setTitleSheet({ open: false });
  }, []);

  /**
   * The Theme this Session was opened with.
   *
   * Frozen on arrival rather than followed: a Theme changed under a live
   * Surface would repaint it in colours the Host never sent. It applies from
   * the next Attach, a step away. The font size is not frozen: the Options
   * menu changes it live, the Surfaces reflow and report new grids, and the
   * sizing path resizes the Client to them.
   */
  const [opened] = useState(() => ({ terminal, ansi }));
  const fontSize = fontSizeInForce(settings.fontSize);

  const topology = state?.topology;
  const visibleGrid = state?.grid ?? null;
  const activePaneId = topology?.activePane?.id ?? '';
  const connected = state?.phase.kind === 'connected';

  /**
   * How big one cell is, as the Surface that drew it says.
   *
   * Two things need it and both need it badly. Turning a touch into a cell by
   * dividing the Pane by its grid is out by however much of the Pane the grid
   * does not fill, and that error is a whole row by the bottom of the screen —
   * where a terminal application puts its buttons. And how far to slide the
   * Window under the keyboard is a question about rows, which nothing can
   * answer in points without it. Every Surface has the same font, so one
   * reading serves them all.
   */
  const [cellSize, setCellSize] = useState<Extent | null>(null);
  const reportCell = useCallback((cell: Extent) => {
    setCellSize((was) => {
      if (was && was.width === cell.width && was.height === cell.height) return was;
      say(`cell ${cell.width.toFixed(2)}x${cell.height.toFixed(2)} points`);
      return cell;
    });
  }, []);

  /** The full height survives keyboard and Composer layout changes. */
  const windowHeight = Math.max(0, rootBounds.height - (physicalKeyboard ? 0 : KEY_ROW_HEIGHT) - clearance.resting);
  const [selectionArea, setSelectionArea] = useState<Extent | null>(null);
  const selecting = selectionArea !== null;
  const windowArea = useMemo(
    (): Extent => selectionArea ?? {
      width: containerSize.width,
      height: keyboardVisible && state?.alternate && !composerOpen
        ? containerSize.height
        : windowHeight || containerSize.height,
    },
    [containerSize, windowHeight, keyboardVisible, state?.alternate, composerOpen, selectionArea],
  );

  /**
   * How far up the Window is slid so the row in sight clears the keys.
   *
   * The row is the active Pane's, and a Pane in a split does not start at
   * the Window's top — so its row is offset by where the Layout puts it. A
   * zoomed Pane is drawn at the top whatever the Layout says its place is,
   * because the Layout describes the arrangement zoom is hiding.
   */
  const spansWindow =
    (topology?.activeWindow?.zoomed ?? true) || (topology?.panes.length ?? 0) <= 1;

  /** The frozen Pane's view. The view and not its id: the Pane can go first. */
  const frozenView = useRef<PaneView | null>(null);
  const rowInSight =
    state?.rowInSight == null
      ? null
      : state.rowInSight + (spansWindow ? 0 : (topology?.activePane?.top ?? 0));
  const liveSlide = windowSlide(containerSize.height, windowArea.height, cellSize, rowInSight);
  /**
   * The slide from before the Selection. The Selection Layer takes the
   * keyboard down, and a Window that slid back then would move the text
   * from under the finger that pressed it.
   */
  const heldSlide = useRef(0);
  if (!selecting) heldSlide.current = liveSlide;
  const slide = heldSlide.current;
  const clippedRow = clippedRowHeight(slide, cellSize);

  // Told from here rather than from the layout event, because the Window's
  // area is not the container's: it is what the Panes are laid out in, and it
  // is what a Client's size is worked out from.
  useEffect(() => {
    if (windowArea.width > 0 && windowArea.height > 0) attach?.containerLaidOut(windowArea);
  }, [attach, windowArea]);

  /**
   * The Pane follows the finger only where it is the one Pane on screen and
   * there is another to go to. See usePaneSwipe.
   */
  const swipe = usePaneSwipe({
    attach,
    panes: topology?.panes ?? [],
    activePaneId,
    follows: spansWindow && (topology?.panes.length ?? 0) > 1,
    width: windowArea.width,
    // The Surface refuses the pan itself. This is for the other Panes of a
    // split, which are not under the Selection Layer.
    frozen: () => frozenView.current !== null,
  });
  const leavingPaneId = swipe.leaving;

  /**
   * Which Panes are on screen, and where.
   *
   * Zoomed — or with nothing to split — that is one Surface filling the
   * Window's area, which is the shape this app has had all along. Otherwise it
   * is every Pane at the rectangle the Layout gives it, on one cell metric. See
   * paneBoxes, and ADR 0006 for why this is possible at all. All of them sit
   * `slide` points higher than the area they are laid out in, which is how the
   * keyboard is kept off the row being typed on.
   *
   * A Pane Swipe has two for a moment: the Pane it is leaving, until that is
   * off the screen, and the active one behind it.
   */
  const slots = useMemo((): PaneSlot[] => {
    const panes = topology?.panes ?? [];
    const active = topology?.activePane;
    if (panes.length === 0 || !active) return [];

    // tmux's zoom, not Muxify's preference for it. The preference says what a
    // Session should arrive as and what the switch asks for; what is on screen
    // has to follow the Window, or unzooming from the laptop would leave this
    // showing one Pane stretched across a split.
    if (spansWindow) {
      const filling = (pane: Pane, part: PaneSlot['swipe']): PaneSlot => ({
        pane,
        box: { left: 0, top: -slide, width: windowArea.width, height: windowArea.height },
        rows: visibleGrid?.rows ?? pane.height,
        fillsWindow: true,
        swipe: part,
      });
      const leaving = panes.find((pane) => pane.id === leavingPaneId && pane.id !== active.id);
      return leaving ? [filling(active, 'waits'), filling(leaving, 'moves')] : [filling(active, 'moves')];
    }

    const boxes = paneBoxes(panes, windowArea);
    return panes.flatMap((pane) => {
      const box = boxes.get(pane.id);
      if (!box) return [];
      const placed = { ...box, top: box.top - slide };
      return [{ pane, box: placed, rows: pane.height, fillsWindow: false, swipe: 'still' }];
    });
  }, [topology, spansWindow, windowArea, slide, visibleGrid, leavingPaneId]);

  /** Whether anything on screen spans the Window, which sizing needs to know. */
  const spanning = slots.length === 0 || slots.some((slot) => slot.fillsWindow);
  useEffect(() => {
    attach?.spanningSurface(spanning);
  }, [attach, spanning]);

  /**
   * What is on screen, written to the Log whenever it changes.
   *
   * The ruler or the Panes, each at its box — the one fact about a blank Pane
   * that nothing below this screen can record, because nothing below it knows
   * what was mounted. Described as a string first so that a render which
   * changed nothing says nothing.
   */
  const onScreen = useMemo(() => {
    if (slots.length === 0) {
      return (
        `the ruler alone at ${Math.round(windowArea.width)}x${Math.round(windowArea.height)}; ` +
        `the Topology has ${topology?.panes.length ?? 0} Panes, active ${activePaneId || 'none'}`
      );
    }
    return slots
      .map(
        (slot) =>
          `${slot.pane.id}${slot.pane.active ? '*' : ''}${slot.fillsWindow ? ' filling' : ''} at ` +
          `${Math.round(slot.box.left)},${Math.round(slot.box.top)} ` +
          `${Math.round(slot.box.width)}x${Math.round(slot.box.height)}, ${slot.rows} rows`,
      )
      .join(' | ');
  }, [slots, windowArea, topology, activePaneId]);
  useEffect(() => {
    say(`on screen: ${onScreen}`);
  }, [onScreen]);

  /**
   * Whether a sheet is up, forwarded as it changes.
   *
   * The *state*, not the edge: noticing a sheet closing used to be a ref here
   * whose only job was to remember the last render's value. What a closing
   * sheet means for the Client's size is the sizing module's business.
   */
  const [screenFocused, setScreenFocused] = useState(navigation.isFocused());
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));
  const sheetOpen = picker.open || titleSheet.open;
  const trackpadTargets: TrackpadTarget[] = slots.map((slot) => ({
    paneId: slot.pane.id,
    box: slot.box,
    grid: paneGrids.get(slot.pane.id) ?? (slot.fillsWindow && visibleGrid
      ? visibleGrid : { cols: slot.pane.width, rows: slot.rows }),
  }));
  const trackpadContext = JSON.stringify([
    state?.sessionName, topology?.activeWindow?.index, activePaneId,
    trackpadTargets, containerSize, fontSize,
  ]);
  useEffect(() => {
    attach?.sheetPresented(sheetOpen);
  }, [attach, sheetOpen]);

  const activeView = useCallback(
    () => (activePaneId === '' ? undefined : attach?.view(activePaneId)),
    [attach, activePaneId],
  );

  /**
   * One finger on a Pane, moving it through its Scrollback.
   *
   * The gesture is the library's own — the same pan and the same momentum it
   * would otherwise spend on ghostty's scrollback, which a Surface painted from
   * a capture does not have. Points become lines here because only this side
   * knows both the Pane's grid and the height it was laid out at.
   *
   * The fraction of a line left over is carried between frames rather than
   * dropped, so a slow drag moves at the speed of the finger instead of
   * stalling until a whole line has accumulated.
   */
  const handlePaneScroll = useCallback(
    (paneId: string, grid: Grid, height: number, points: number) => {
      if (!attach || grid.rows <= 0 || height <= 0) return;

      // A finger moving down pulls older output into view.
      carriedLines.current += points * (grid.rows / height) * SCROLL_SPEED;
      const lines = Math.trunc(carriedLines.current);
      if (lines === 0) return;
      carriedLines.current -= lines;

      attach.view(paneId).scroll(lines, grid);
    },
    [attach],
  );

  /**
   * A tap at one cell of the active Pane, while something wants the mouse.
   *
   * See MouseLayer for why this does not go through the Surface's own gesture.
   */
  const handleTapCell = useCallback(
    (column: number, row: number) => {
      const view = activeView();
      if (!view) return;
      const wasScrolled = view.scrolledBack();
      view.click(column, row);
      // And the keyboard, because a tap on a terminal means both. This layer
      // takes the touch away from the Surface, which would otherwise have
      // raised it — so an application listening for the mouse, which is to say
      // Claude Code, was a Pane you could click but never type into. A tap
      // that only got as far as leaving the Scrollback is not that tap: it
      // spent itself coming back to the present.
      if (!wasScrolled) view.focusKeyboard();
    },
    [activeView],
  );

  /** A drag, already counted in whole lines by whoever owned the finger. */
  const handleScrollLines = useCallback(
    (lines: number, size: Grid) => {
      activeView()?.scroll(lines, size);
    },
    [activeView],
  );

  /**
   * A long press on a Pane: the Pane freezes and the Selection Layer gets
   * its text. See beginSelection on the Pane view.
   */
  const beginSelection = useCallback(
    (paneId: string, press: SurfacePoint) => {
      if (!attach || frozenView.current !== null) return;
      const view = attach.view(paneId);
      if (!view.beginSelection(press)) return;
      frozenView.current = view;
      setSelectionArea(windowArea);
    },
    [attach, windowArea],
  );

  /**
   * Ends the Selection: the Selection Layer closes and the Pane is live
   * again. Also what the Layer's own ending arrives as, which changes
   * nothing the second time.
   */
  const endSelection = useCallback(() => {
    const view = frozenView.current;
    if (view === null) return;
    frozenView.current = null;
    view.endSelection();
    setSelectionArea(null);
  }, []);

  // A Selection is of one Pane as it stands. Another Pane, Window or Session,
  // the loss of the Attach, and leaving the screen all end it.
  const activeWindowIndex = topology?.activeWindow?.index;
  const sessionName = state?.sessionName;
  useEffect(
    () => endSelection,
    [endSelection, activePaneId, activeWindowIndex, sessionName, connected],
  );

  /** A handle held at the top or bottom edge of a Selection: one more line. */
  const scrollSelection = useCallback(
    (paneId: string, grid: Grid, direction: 'up' | 'down') => {
      attach?.view(paneId).scroll(direction === 'up' ? 1 : -1, grid);
    },
    [attach],
  );

  /** The Pane the mouse layer belongs to, and only its rectangle. */
  const activeSlot = slots.find((slot) => slot.pane.id === activePaneId);

  /**
   * With a hardware keyboard, the active Pane takes the keyboard by itself, so
   * the user can type at once: on Attach, after a pick in the title chooser,
   * after a Pane change, and when the keyboard connects. The Composer, a
   * Selection, a sheet or another screen holds input while it is up, and the
   * Pane takes it back when that closes. Without a hardware keyboard a focus
   * would raise the on-screen keyboard, so nothing happens.
   */
  const takesKeyboard = physicalKeyboard && activeSlot !== undefined && screenFocused
    && !composerOpen && !selecting && !sheetOpen && !showReconnect;
  useEffect(() => {
    if (takesKeyboard) activeView()?.focusKeyboard();
  }, [takesKeyboard, activeView, sessionName]);
  const mouseGrid = activeSlot
    ? activeSlot.fillsWindow
      ? visibleGrid
      : { cols: activeSlot.pane.width, rows: activeSlot.rows }
    : null;

  /**
   * A Surface for one Pane, arriving or going — with the grid it has reported,
   * if it has, so an Attach meeting a Surface that has been up for a while is
   * told both halves at once. See PaneSurfaceView for why that matters.
   *
   * The whole of what the screen does about painting. Which Surface belongs to
   * which Pane, whether both halves have arrived and what the cursor should do
   * are all the Pane view's, which is where they can be tested.
   */
  const adoptPaneSurface = useCallback(
    (paneId: string, ref: TerminalViewRef | null, grid: Grid | null) => {
      attach?.surfaceForPane(paneId, ref === null ? null : surfaceFor(ref), grid);
    },
    [attach],
  );

  const { surfaceReported } = swipe;
  const reportPaneGrid = useCallback(
    (paneId: string, grid: Grid) => {
      setPaneGrids((before) => {
        const known = before.get(paneId);
        return known?.cols === grid.cols && known.rows === grid.rows
          ? before : new Map(before).set(paneId, grid);
      });
      attach?.paneGridReported(paneId, grid);
      surfaceReported(paneId);
    },
    [attach, surfaceReported],
  );

  /**
   * The last grid a Surface spanning the Window reported, and the area it was
   * laid out in.
   *
   * Remembered so it can be told again. A Surface says its grid once per size,
   * and which Attach is listening at that moment is an accident of timing: the
   * holder swaps Attaches with a beat of nothing between them, and the ruler
   * that mounts in that beat reports into the gap. An Attach that arrives to a
   * grid nobody passed on waits for a settled grid forever — a Session that
   * shows Connecting and never connects. So whatever Attach is current is
   * told the grid on arrival, from here.
   */
  const windowGrid = useRef<{ grid: Grid; area: Extent } | null>(null);
  useEffect(() => {
    const known = windowGrid.current;
    if (attach && known) attach.windowGridReported(known.grid, known.area);
  }, [attach]);

  /**
   * A Surface that fills the Window reporting its grid.
   *
   * Only the single-Pane and zoomed cases go through here, and that is the
   * point: its grid *is* the Window's. A Pane in a split reports only its own
   * share, which would size the Window to a fraction of itself.
   */
  const reportWindowGrid = useCallback(
    ({ nativeEvent }: { nativeEvent: Grid }) => {
      const grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
      // The area the Surface was laid out in, which is the Window's and not
      // the container's: the cell metric is worked out by dividing one by the
      // other, and with the keyboard up the container is the smaller strip.
      windowGrid.current = { grid, area: windowArea };
      attach?.windowGridReported(grid, windowArea);
    },
    [attach, windowArea],
  );

  /** The active Pane's text onto the clipboard, with a word on how much. */
  const copyPaneText = useCallback(() => {
    if (!attach) return;
    void (async () => {
      try {
        const text = await attach.capturePaneText();
        await Clipboard.setStringAsync(text);
        const lines = text === '' ? 0 : text.split('\n').length;
        Alert.alert('Pane text copied', `${lines} ${plural(lines, 'line')} on the clipboard.`);
      } catch (error) {
        Alert.alert('Could not copy the Pane text', describeError(error));
      }
    })();
  }, [attach]);

  /**
   * The clipboard into the active Pane, with nothing pressed after it.
   *
   * An image first, then text: a copied image often carries its file name as
   * text too, and the name is not what was copied.
   */
  const pasteClipboard = useCallback(() => {
    void pasteInto(attach, async () => {
      const image = await stageClipboardImage();
      if (image) return { kind: 'image', file: image };
      return { kind: 'text', text: await Clipboard.getStringAsync() };
    });
  }, [attach]);

  /**
   * Paste from the Surface's edit menu or from command-V on a hardware
   * keyboard. The Surface read the clipboard inside the system's own paste
   * action, so iOS asks nothing, and the text goes the same safe way in.
   */
  const pasteFromSurface = useCallback(
    (pasted: TerminalPasteEvent) => {
      void pasteInto(attach, async () => {
        const { imageUri } = pasted;
        if (!imageUri) return { kind: 'text', text: pasted.text ?? '' };
        const written = new File(imageUri);
        try {
          return { kind: 'image', file: await stageFile(imageUri, 'pasted-image.png', true) };
        } finally {
          if (written.exists) written.delete();
        }
      });
    },
    [attach],
  );

  const clearPane = useCallback(() => {
    void attach
      ?.clearPane()
      .catch((error: unknown) => Alert.alert('Could not clear the Pane', describeError(error)));
  }, [attach]);

  /** What typing or a pair key turned into, on its way to a Pane or to the phone. */
  const deliverInput = useCallback(
    (view: PaneView, input: ModifiedInput) => {
      // A key is for the live Pane, not for the still picture of it.
      endSelection();
      if (input.kind === 'key') view.press(input.key);
      else if (input.kind === 'shortcut') {
        ({ copy: copyPaneText, paste: pasteClipboard, clear: clearPane })[input.shortcut]();
      }
      if (input.rest.length > 0) view.type(input.rest);
    },
    [copyPaneText, pasteClipboard, clearPane, endSelection],
  );

  /**
   * Bytes typed into one Pane's Surface.
   *
   * Aimed at the Surface that had first responder, which is the only one the
   * keyboard was ever talking to — so a split needs no routing of its own.
   */
  const handlePaneInput = useCallback(
    (paneId: string, data: string) => {
      const view = attach?.view(paneId);
      if (!view) return;
      // `data` is base64. The sibling `text` field must not be used: a
      // multi-byte character split across reads is corrupted by text decoding.
      //
      // What comes out of the Surface is not quite what a shell expects — every
      // keystroke arrives wrapped as a bracketed paste. See toShellInput.
      const typed = toShellInput(withoutTerminalReplies(base64ToBytes(data)));
      if (typed.length === 0) return;

      // Whatever the Key Row is holding down applies to the first key of this
      // and nothing after it, so ctrl and then `r` is one `C-r` with the rest
      // of a fast typist's burst behind it as ordinary input.
      const held = armedRef.current;
      const input = applyModifiers(typed, held);
      deliverInput(view, input);
      const left = armedAfter(input, held);
      if (left !== held) setArmed(left);
    },
    [attach, deliverInput],
  );

  /**
   * Shows or hides the system keyboard, on the Surface that actually has it.
   *
   * The question goes to the Surface rather than to a global listener: React
   * Native's registry never heard of this view, so `Keyboard.dismiss()` was a
   * no-op and there was no way at all to raise the keyboard again. The
   * listener below only decides which way the Key Row's button points.
   */
  const toggleKeyboard = useCallback(() => {
    if (composerOpen) {
      if (keyboardVisible) void composerInput.current?.blur();
      else void composerInput.current?.focus();
      return;
    }
    const view = activeView();
    say(view ? `Keyboard button, for ${activePaneId}` : 'Keyboard button, with no active Pane to ask');
    void view?.toggleKeyboard();
  }, [activeView, activePaneId, composerOpen, keyboardVisible]);

  const toggleComposer = useCallback(() => {
    if (composerOpen) void composerInput.current?.blur();
    else setArmed(NO_MODIFIERS);
    setComposerOpen((open) => !open);
  }, [composerOpen]);

  /** Puts the active Pane back at the live bottom, and the indicator with it. */
  const jumpToLatest = useCallback(() => {
    carriedLines.current = 0;
    activeView()?.jumpToLatest();
  }, [activeView]);

  const chooserLists = useChooserLists(hostId ?? '');
  const topicsOn = chooserLists.includes('topics');
  const windowsOn = chooserLists.includes('windows');
  const sessionsOn = chooserLists.includes('sessions');
  const { topics: hostTopics, read: readHost } = useHostReading(hostId ?? '', topicsOn);
  const pickerTopics = useMemo(
    () => (topicsOn ? topicSections(hostTopics, appearance) : []),
    [topicsOn, hostTopics, appearance],
  );
  const hostEntry = useHostEntry(hostId ?? '', closeChooser, true);
  const handover = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(useCallback(() => () => {
    if (handover.current) clearTimeout(handover.current);
    closeChooser();
    setPicker({ open: false });
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

  const sessionCards = useMemo((): PreviewCard[] => {
    if (!state) return [];
    return (state.sessions ?? []).map((session) => ({
      id: session.name,
      title: session.name,
      detail: `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
      current: session.name === state?.sessionName,
      preview: previewOf(state.previews, `${session.name}:`),
    }));
  }, [state]);
  const paneCards = useMemo((): PreviewCard[] => {
    if (!state) return [];
    const frames = paneTopologyFrames(state.topology.panes);
    return state.topology.panes.map((pane) => ({
      id: String(pane.index),
      title: directoryName(pane.path) || `Pane ${pane.index}`,
      detail: pane.command,
      current: pane.active,
      frame: frames.get(pane.index),
      preview: [],
    }));
  }, [state]);
  const openPanes = useCallback(() => {
    closeChooser();
    setPicker({ open: true });
    attach?.refreshTopology();
  }, [attach, closeChooser]);
  const showPickerError = useCallback((error: unknown) => {
    setPicker((previous) => (previous.open ? { ...previous, error: describeError(error) } : previous));
  }, []);
  const selectPane = useCallback((id: string) => {
    const pane = state?.topology.panes.find((each) => each.index === Number(id));
    if (!attach || !pane) return;
    attach.selectPane(pane.id);
    setPicker({ open: false });
  }, [attach, state]);

  /** The Splits: the Panes sheet's bottom bar. */
  const runSheetAction = useCallback(
    (id: string) => {
      say(`sheet action ${id}`);
      if (!attach) return;
      void (async () => {
        try {
          if (id === 'split-right') await attach.split('right');
          else if (id === 'split-down') await attach.split('down');
          setPicker({ open: false });
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [attach, showPickerError],
  );

  /** The Theme's chrome colours: the Key Row's labels and the Banners. */
  const chrome = useMemo(() => paletteFor(settings.theme), [settings.theme]);

  /**
   * Escape, tab or an arrow from the Key Row, into the Pane that has the
   * keyboard.
   *
   * Carries whatever is armed with it, so ctrl and then the left arrow is
   * `C-Left` — one key, named, for tmux to encode. The modifiers are spent
   * either way: a key that cannot take them still clears them, or ctrl tapped
   * by mistake would stay on until something happened to use it.
   */
  const pressKey = useCallback(
    (key: NamedKey) => {
      endSelection();
      activeView()?.press(namedKeyName(key, armed));
      setArmed(NO_MODIFIERS);
    },
    [activeView, armed, endSelection],
  );

  /** One symbol of a pair key: typed as the system keyboard would type it. */
  const pressSymbol = useCallback(
    (symbol: string) => {
      const view = activeView();
      if (view) deliverInput(view, applyModifiers(new TextEncoder().encode(symbol), armed));
      setArmed(NO_MODIFIERS);
    },
    [activeView, armed, deliverInput],
  );

  /** A modifier tapped: on if it was off, and off if it was on. */
  const armModifier = useCallback((modifier: Modifier) => {
    setArmed((previous) => ({ ...previous, [modifier]: !previous[modifier] }));
  }, []);

  const topicView = state?.topic?.view;
  const topic = topicView ? lastTopic(topicView) : null;
  const rereadTopic = useCallback(() => { void attach?.refreshTopic(); }, [attach]);
  useFocusEffect(useCallback(() => { rereadTopic(); }, [rereadTopic]));

  /** The header's lines. Until a Topic read lands, a Topic's Session reads as a Session. */
  const headerTitle = useMemo((): HeaderTitle | null => {
    if (!state) return null;
    const program = topology?.activePane?.command ?? null;
    return topic
      ? { kind: 'topic', topic: topic.label, program, session: state.sessionName }
      : { kind: 'session', session: state.sessionName, program };
  }, [state, topology, topic]);

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
    setPicker({ open: false });
    setTitleSheet({ open: true, revision: ++chooserRevision.current });
    attach.refreshTopology();
    if (sessionsOn) attach.capturePreviews((state?.sessions ?? []).map((session) => `${session.name}:`));
    if (state?.topic) rereadTopic();
    if (topicsOn) void readHost();
  }, [attach, state, rereadTopic, topicsOn, sessionsOn, readHost]);

  /** A Tab picked in the Title Sheet: its page in the Web View, over the Attach, which stays up. */
  const openTab = useCallback(
    (tab: BrowserTab) => {
      say(`picked Tab ${tab.id}`);
      closeChooser();
      router.push({ pathname: '/web-view', params: { url: tab.url, title: tab.title } });
    },
    [router, closeChooser],
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
    void (async () => {
      try {
        if (pick.session !== null) {
          await attach.switchSession({ sessionName: pick.session,
            topic: explicitTopic && state.topic ? { id: state.topic.id, seed: topic } : null });
        }
        if (!current() || attach.state().sessionName !== (pick.session ?? state.sessionName)) return;
        if (pick.window !== null) await attach.selectWindow(pick.window);
        if (current()) closeChooser();
      } catch (error) {
        if (current()) setTitleSheet((previous) => previous.open ? { ...previous, error: describeError(error) } : previous);
      } finally {
        chooserBusy.current = false;
      }
    })();
  }, [attach, state, topic, holder, closeChooser]);
  const selectSession = useCallback((session: string) => choose({ session, window: null }, false), [choose]);
  const pickTitleRow = useCallback((pick: TitlePick) => choose(pick, true), [choose]);

  /**
   * One step of font size, from the size in force. The Surfaces follow the
   * setting live and the sizing path resizes the Client to the new grids.
   */
  const stepFontSize = useCallback(
    (step: 1 | -1) => {
      const next = clampFontSize(fontSize + step);
      say(`Font size ${step > 0 ? '+' : '−'}: ${fontSize} → ${next}`);
      update({ fontSize: next });
    },
    [fontSize, update],
  );

  const copyLog = useCopyLog('the Options menu');

  const disconnect = useCallback(() => {
    void holder.disconnect().then(goHost).catch((error) => Alert.alert('Could not disconnect', describeError(error)));
  }, [holder, goHost]);

  /** A tmux verb from the menu. No sheet to show a failure in, so an Alert does. */
  const runVerb = useCallback((label: string, verb: () => Promise<void>) => {
    void verb().catch((error: unknown) => Alert.alert(`Could not ${label}`, describeError(error)));
  }, []);

  /**
   * The ⋯ menu, in the spec's order. Each entry is said to the Log as it is
   * asked for, so the Log shows what the user reached for.
   */
  const options = useMemo((): OptionsItem[] => {
    const action = (
      id: string,
      label: string,
      systemImage: SFSymbol,
      run: () => void,
      over: { disabled?: boolean; destructive?: boolean } = {},
    ): OptionsItem => ({
      kind: 'action',
      id,
      label,
      systemImage,
      run: () => {
        say(`Options: ${label}`);
        run();
      },
      ...over,
    });
    return [
      action(
        'compose',
        composerOpen ? 'Close composer' : 'Compose',
        'square.and.pencil',
        toggleComposer,
        { disabled: !activePaneId },
      ),
      action('panes', 'Panes', 'square.grid.2x2', openPanes, { disabled: !connected }),
      action('keyboard', 'Keyboard', 'keyboard', toggleKeyboard),
      ...(state?.topic ? [{
        kind: 'menu' as const, id: 'topic', label: 'Topic', systemImage: 'rectangle.stack' as const,
        items: [
          action('edit-topic', 'Edit Topic…', 'square.and.pencil', () => {
            if (!topic || !hostId) return;
            router.push({ pathname: '/topic-edit', params: { hostId, topicId: topic.id,
              topic: fieldsParam({ title: topic.label, note: topic.note, tags: topic.tags }) } });
          }, { disabled: !topic }),
          action('add-session', 'Add a Session…', 'plus', () => {
            if (!hostId || !state.topic) return;
            router.push({ pathname: '/topic-add-session', params: { hostId, topicId: state.topic.id,
              fromAttach: '1', ...(topic ? { seed: topicSeedParam(topic) } : {}) } });
          }),
        ],
      }] : []),
      {
        kind: 'toggle',
        id: 'zoom',
        label: 'Zoom Pane',
        systemImage: 'arrow.up.left.and.arrow.down.right',
        isOn: state?.zoomed ?? false,
        set: (on) => {
          say(`Options: Zoom Pane ${on ? 'on' : 'off'}`);
          attach?.setZoom(on);
        },
      },
      action(
        'new-window',
        'New Window',
        'plus.rectangle',
        () => runVerb('add a Window', () => attach?.newWindow() ?? Promise.resolve()),
        { disabled: !connected },
      ),
      {
        kind: 'menu',
        id: 'split',
        label: 'Split Pane',
        systemImage: 'rectangle.split.2x1',
        items: [
          action(
            'split-right',
            'Split →',
            'rectangle.split.2x1',
            () => runVerb('split the Pane', () => attach?.split('right') ?? Promise.resolve()),
            { disabled: !connected },
          ),
          action(
            'split-down',
            'Split ↓',
            'rectangle.split.1x2',
            () => runVerb('split the Pane', () => attach?.split('down') ?? Promise.resolve()),
            { disabled: !connected },
          ),
        ],
      },
      action('font-smaller', 'Font size −', 'textformat.size.smaller', () => stepFontSize(-1)),
      action('font-larger', 'Font size +', 'textformat.size.larger', () => stepFontSize(1)),
      action('copy-pane', 'Copy Pane text', 'doc.on.clipboard', copyPaneText, {
        disabled: !activePaneId,
      }),
      { kind: 'divider', id: 'divider' },
      action('configure-chooser', 'Configure chooser', 'list.bullet', () => {
        closeChooser();
        if (hostId) router.push({ pathname: '/host-lists', params: { hostId } });
      }),
      action('copy-log', 'Copy log', 'doc.text', copyLog),
      action('disconnect', 'Disconnect', 'xmark.circle', disconnect, { destructive: true }),
    ];
  }, [
    topic,
    state?.topic,
    hostId,
    router,
    composerOpen,
    toggleComposer,
    openPanes,
    toggleKeyboard,
    activePaneId,
    state?.zoomed,
    attach,
    connected,
    runVerb,
    stepFontSize,
    copyPaneText,
    copyLog,
    disconnect,
    closeChooser,
  ]);


  const status = statusOf(state, missing);
  /**
   * A changed key, from the reconnect's visit, which stopped at it, or from an
   * Attach, which went on. Accepting it after the visit is the user asking to
   * go on, so the reconnect runs again.
   */
  const keyWarning =
    reconnecting.kind === 'failed' && reconnecting.step === 'checking-host-key'
      ? {
          hostName: reconnectHost,
          fingerprint: reconnecting.fingerprint,
          onAccepted: tryReconnectAgain,
        }
      : state?.keyChanged === true && attach
        ? { hostName: attach.hostName, fingerprint: state.fingerprint, onAccepted: () => {} }
        : null;
  const keyBanner = (
    <Presence shown={keyWarning !== null && !keyWarningSeen}>
      {keyWarning ? (
        <HostKeyWarning
          hostName={keyWarning.hostName}
          appearance={appearance}
          palette={chrome}
          onAccept={() => {
            setKeyWarningSeen(true);
            void (async () => {
              if (hostId && keyWarning.fingerprint) {
                await deviceHostStore().rememberFingerprint(hostId, keyWarning.fingerprint);
              }
              keyWarning.onAccepted();
            })();
          }}
          onDismiss={() => setKeyWarningSeen(true)}
        />
      ) : null}
    </Presence>
  );
  const reconnectShown = showReconnect && reconnecting.kind !== 'attached';

  return (
    // The ground the Surface sits on follows the Theme, or the safe-area strip
    // above it shows as a band of a different dark.
    <View
      ref={rootView}
      onLayout={() => rootView.current?.measureInWindow((x, y, width, height) => {
        setRootBounds({ x, y, width, height });
      })}
      style={[
        styles.container,
        { backgroundColor: opened.terminal.background },
      ]}>
      {/* The Theme decides this, not the phone: white glyphs over Solarized's
          near-white terminal are a status bar nobody can read. */}
      <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />

      <TerminalHeader
        title={headerTitle}
        terminal={opened.terminal}
        chrome={reconnectShown ? chrome : null}
        onTitle={openTitleSheet}
        options={options}
      />

      <View
        style={[styles.surfaceArea, { backgroundColor: opened.terminal.background }]}
        testID="surface-area"
        onLayout={({ nativeEvent }) => {
          const size = { width: nativeEvent.layout.width, height: nativeEvent.layout.height };
          say(
            `container ${Math.round(size.width)}x${Math.round(size.height)}` +
              (keyboardVisible ? ', keyboard up' : ''),
          );
          setContainerSize(size);
        }}>
        {/* Before there is a Topology there are no Panes to place, and nothing
            but a Surface can measure a cell — so one stands in as the ruler.
            That is the sizing module's decision, not this screen's; see its
            docblock. It is replaced by the real Panes the moment they are
            known, and their resync paints them. */}
        {slots.length === 0 ? (
          <TerminalView
            // In the Window's box rather than filling the container, so that the
            // grid it measures is the Window's whatever the keyboard is doing.
            style={[styles.paneBox, { left: 0, top: -slide, ...windowArea }]}
            fontSize={fontSize}
            accessoryBar={false}
            shortcutBar={false}
            theme={{
              background: opened.terminal.background,
              foreground: opened.terminal.foreground,
              cursorColor: opened.terminal.cursor,
              palette: opened.ansi ? [...opened.ansi] : undefined,
            }}
            onResize={(event) => {
              say(`the ruler reported ${event.nativeEvent.cols}x${event.nativeEvent.rows}`);
              reportWindowGrid(event);
            }}
          />
        ) : null}

        <TrackpadScroll
          style={StyleSheet.absoluteFill}
          enabled={connected && screenFocused && !composerOpen && !sheetOpen && !showReconnect}
          context={trackpadContext}
          targets={trackpadTargets}
          scrollSpeed={SCROLL_SPEED}
          selectionPane={frozenView.current?.paneId() ?? null}
          attach={attach}
          swipe={swipe}>
          {slots.map((slot) => (
            <PaneSurfaceView
              key={slot.pane.id}
              slot={slot}
              font={fontSize}
              terminal={opened.terminal}
              ansi={opened.ansi}
              onRef={adoptPaneSurface}
              onPaneResize={reportPaneGrid}
              onWindowResize={slot.fillsWindow ? reportWindowGrid : undefined}
              onCell={reportCell}
              onInput={handlePaneInput}
              onScroll={handlePaneScroll}
              swipe={swipe}
              onSelect={(paneId) => attach?.selectPane(paneId)}
              onSelectionPress={beginSelection}
              onSelectionEnd={endSelection}
              onSelectionEdge={scrollSelection}
              onPaste={pasteFromSurface}
            />
          ))}

          {/* Under the Scrollback chrome, and that ordering is the whole of
              whether the Jump to latest pill can be pressed. The layer covers
              the Pane and claims every touch in it, so drawn after the pill it
              took the pill's presses as well — and judged them by a terminal's
              rules rather than a button's, where ten points of finger travel is
              a scroll and not a tap. A press that drifted did nothing at all,
              except scroll further back. Measured: a fourteen-point drag on the
              pill left it exactly where it was. */}
          {/* Gone while a Selection is open: the touches are the Selection
              Layer's then, which is under this one. */}
          {state?.mouseTracking && activeSlot && mouseGrid && !selecting ? (
            <MouseLayer
              box={activeSlot.box}
              grid={mouseGrid}
              cell={cellSize}
              onTap={handleTapCell}
              onLongPress={(press) => beginSelection(activePaneId, press)}
              onScroll={(lines) => handleScrollLines(lines, mouseGrid)}
              swipe={swipe}
            />
          ) : null}

        </TrackpadScroll>

        {state?.scrolled ? (
          <>
            <ScrollRail
              position={state.scrolled}
              rows={visibleGrid?.rows ?? 0}
              palette={opened.terminal}
            />
            <ScrollBackIndicator
              position={state.scrolled}
              palette={opened.terminal}
              appearance={appearance}
              onPress={jumpToLatest}
            />
          </>
        ) : null}

        {clippedRow > 0 ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: clippedRow, backgroundColor: opened.terminal.background }}
          />
        ) : null}

        {/* Last, so it is over the mouse layer and a tap on it is the map's. */}
        {(state?.topology.panes.length ?? 0) > 1 ? (
          <LayoutMap
            panes={state?.topology.panes ?? []}
            appearance={appearance}
            palette={sheetPaletteFor(settings.theme)}
            onPress={openPanes}
          />
        ) : null}
      </View>

      <PickerSheet
        title="Panes"
        isPresented={picker.open}
        onDismiss={() => setPicker({ open: false })}
        loading={false}
        error={picker.open ? picker.error : undefined}
        emptyMessage="No Panes in this Window"
        cards={paneCards}
        onSelect={selectPane}
        actions={PANE_ACTIONS}
        onAction={runSheetAction}
        zoom={state ? { on: state.zoomed, onChange: (on: boolean) => attach?.setZoom(on) } : undefined}
      />

      <TitleSheet
        lists={chooserLists}
        isPresented={titleSheet.open}
        onDismiss={closeChooser}
        rows={titleRows}
        topic={topic}
        onRetry={titleSheet.open && titleSheet.error !== undefined ? undefined : rereadTopic}
        loading={titleSheet.open && topicView?.kind === 'loading'}
        error={
          titleSheet.open
            ? (titleSheet.error ??
              (topicView?.kind === 'failed' ? topicView.error : undefined))
            : undefined
        }
        sessions={{ cards: sessionCards, loading: state?.sessions == null, onSelect: selectSession }}
        topics={topicsOn ? { sections: pickerTopics, palette: chrome, onOpenTopic: openTopic, onRetry: () => void readHost() } : undefined}
        onPick={pickTitleRow}
        tabs={windowTabs?.revision === titleRevision && windowTabs.session === sessionName && windowTabs.window === activeWindowId ? windowTabs.tabs : NO_TABS}
        onOpenTab={openTab}
      />

      {composerOpen && attach && activePaneId ? (
        <ComposerPanel
          key={`${attach.hostId}:${activePaneId}`}
          composer={attach.composer}
          paneId={activePaneId}
          connected={connected}
          palette={chrome}
          appearance={appearance}
          inputRef={composerInput}
        />
      ) : null}
      {!physicalKeyboard ? <KeyRow
        armed={armed}
        onArm={armModifier}
        onKey={pressKey}
        onSymbol={pressSymbol}
        onPanes={openPanes}
        onKeyboard={toggleKeyboard}
        keyboardVisible={keyboardVisible}
        keysDisabled={!connected || composerOpen}
        // One Pane is when you reach for Split, so never disabled while connected.
        panesDisabled={!connected}
        palette={chrome}
        placement={clearance.placement}
      /> : null}
      <View style={{ height: clearance.bottom }} pointerEvents="none" />

      {/* The native Header ends where this content area begins. */}
      <View style={[styles.top, { top: 0 }]} pointerEvents="box-none">
        {reconnectShown ? null : keyBanner}

        <Presence shown={!status.quiet}>
          <StatusBanner
            status={status}
            appearance={appearance}
            palette={chrome}
            onReconnect={attach ? () => attach.reconnect() : undefined}
          />
        </Presence>

        <View style={styles.overlay} pointerEvents="none">
          {state?.trouble ? (
            // Loud enough to notice over whatever the Session is painting, quiet
            // enough not to be a Banner: the Connection is fine, one command was
            // not.
            <ThemedText
              type="code"
              style={[styles.troubleText, { color: chrome.destructive }]}
              testID="pane-trouble">
              {state.trouble}
            </ThemedText>
          ) : null}
        </View>
      </View>

      {reconnectShown ? (
        <ReconnectScreen
          hostName={reconnectHost}
          session={bootstrap.current.session ?? ''}
          progress={reconnecting}
          palette={chrome}
          appearance={appearance}
          onTryAgain={tryReconnectAgain}
          onGoHost={goHost}
        />
      ) : null}
      {/* The reconnect stops at a changed key, so its warning sits above it. */}
      {reconnectShown ? (
        <View style={[styles.top, { top: 0 }]} pointerEvents="box-none">
          {keyBanner}
        </View>
      ) : null}
    </View>
  );
}

/**
 * What the banner and the quiet line say, from the Attach's phase.
 *
 * The labels are `remux`'s own, so the two apps describe the same thing the
 * same way: Connecting, Connected, Restoring after a foreground check,
 * Reconnecting after a lost transport, and a short label per disconnect
 * reason. See shortLabel.
 */
type Status = {
  label: string;
  busy: boolean;
  /** Only a lost transport is worth offering; see allowsAutomaticReconnect. */
  offerReconnect: boolean;
  quiet: boolean;
  detail?: string;
  /** What the Banner leads with when it is not busy. */
  symbol: SFSymbol;
};

/** Something is being waited on: the Banner leads with a spinner. */
const WAITING: Omit<Status, 'label'> = {
  busy: true,
  offerReconnect: false,
  quiet: false,
  symbol: 'antenna.radiowaves.left.and.right',
};

function statusOf(state: AttachState | null, missing: string | null): Status {
  if (missing) {
    return {
      label: 'Failed',
      detail: missing,
      busy: false,
      offerReconnect: false,
      quiet: false,
      symbol: 'exclamationmark.triangle.fill',
    };
  }
  // Nothing attached yet, which from here is indistinguishable from an Attach
  // that has not answered — and is the same word either way.
  if (!state) return { label: 'Connecting', ...WAITING };
  return statusForPhase(state.phase);
}

function statusForPhase(phase: AttachPhase): Status {
  const label = phaseLabel(phase);
  switch (phase.kind) {
    case 'connected':
      return { label, busy: false, offerReconnect: false, quiet: true, symbol: 'checkmark' };
    case 'connecting':
    case 'restoring':
    case 'reconnecting':
      return { label, ...WAITING };
    case 'disconnected': {
      // Offered for a lost transport and nothing else: a wrong password and a
      // Session that has ended would both fail again in exactly the same way,
      // and a button that cannot work is worse than none.
      const offerReconnect = retryCouldWork(phase.reason);
      return {
        label,
        detail: phase.reason.detail,
        busy: false,
        offerReconnect,
        quiet: false,
        symbol: offerReconnect ? 'wifi.slash' : 'exclamationmark.triangle.fill',
      };
    }
    case 'closed':
      return { label, busy: false, offerReconnect: false, quiet: false, symbol: 'xmark.circle.fill' };
  }
}

/**
 * The `expo-libghostty` view, as the Pane view wants it.
 *
 * One of the seam's two adapters — the other is the recording fake in
 * `pane-view.test.ts` — and the only place in the app that knows the library
 * takes base64. Everything above deals in bytes, because a multi-byte
 * character split across two reads survives byte handling and does not survive
 * text decoding.
 */
function surfaceFor(ref: TerminalViewRef): PaneSurface {
  return {
    write: (bytes) => void ref.write(bytesToBase64(bytes)),
    focus: () => void ref.focus(),
    blur: () => void ref.blur(),
    isFocused: () => ref.isFocused(),
    showSelection: (rows, press) => void ref.showSelection(rows.rows, rows.top, press),
    endSelection: () => void ref.endSelection(),
  };
}

/**
 * Pastes what `read` gives into the active Pane, and says so when it cannot.
 * An empty text pastes nothing. A staged image is let go afterwards.
 */
async function pasteInto(attach: Attach | null, read: () => Promise<Paste>): Promise<void> {
  if (!attach) return;
  try {
    const content = await read();
    if (content.kind === 'text') {
      if (content.text !== '') await attach.paste(content, confirmRunLines);
      return;
    }
    try {
      await attach.paste(content, confirmRunLines);
    } finally {
      content.file.dispose();
    }
  } catch (error) {
    Alert.alert('Could not paste', describeError(error));
  }
}

/**
 * One Pane's Surface, placed where the Layout puts it.
 *
 * The Surface is the library's and unchanged; what is new is that there may be
 * several of them, each with its own grid, cursor and palette against the one
 * shared `ghostty_app_t`. Only the Pane that fills the Window reports a grid
 * the Client is sized from — see `fillsWindow`.
 *
 * An inactive Pane is covered by a tap target rather than left live. Tapping
 * one should move tmux's active Pane to it, and a Surface taking first
 * responder instead would raise the keyboard over a Pane that is not the one
 * being typed into.
 */
function PaneSurfaceView({
  slot,
  font,
  terminal,
  ansi,
  onRef,
  onPaneResize,
  onWindowResize,
  onCell,
  onInput,
  onScroll,
  swipe,
  onSelect,
  onSelectionPress,
  onSelectionEnd,
  onSelectionEdge,
  onPaste,
}: {
  slot: PaneSlot;
  font: number;
  terminal: TerminalPalette;
  ansi: readonly string[] | undefined;
  /** The Surface arriving or going, with the grid it has reported if any. */
  onRef: (paneId: string, ref: TerminalViewRef | null, grid: Grid | null) => void;
  onPaneResize: (paneId: string, grid: Grid) => void;
  onWindowResize?: (event: { nativeEvent: Grid }) => void;
  /** How big a cell is, which only the Surface knows. See cellSize. */
  onCell: (cell: Extent) => void;
  onInput: (paneId: string, data: string) => void;
  onScroll: (paneId: string, grid: Grid, height: number, points: number) => void;
  swipe: PaneSwipe;
  onSelect: (paneId: string) => void;
  /** A long press on the Surface, which has no text until it is given some. */
  onSelectionPress: (paneId: string, press: SurfacePoint) => void;
  /** The Selection Layer closed its selection, or found no text to select. */
  onSelectionEnd: () => void;
  /** A handle of the Selection is held at the top or bottom edge. */
  onSelectionEdge: (paneId: string, grid: Grid, direction: 'up' | 'down') => void;
  onPaste: (pasted: TerminalPasteEvent) => void;
}) {
  /**
   * The grid this Surface last reported, or null before it has.
   *
   * Not the Pane's size from tmux, which is a guess about the Surface rather
   * than the Surface's own word; a Pane view painted at a guess is what the
   * Pane view was deepened to stop. Kept so the Surface can be introduced to
   * an Attach with its grid — see register.
   */
  const reported = useRef<Grid | null>(null);
  /** What a scroll is measured against: the Surface's grid, or tmux's until then. */
  const own = useRef<Grid>({ cols: slot.pane.width, rows: slot.rows });
  /** Where a touch on an inactive Pane started, so a drag is not a tap. */
  const from = useRef({ x: 0, y: 0 });
  /** How fast that touch is going sideways, which can make a short drag a swipe. */
  const sideways = useRef(createVelocityTracker());
  const paneId = slot.pane.id;
  /**
   * Stable, and that matters more than it looks.
   *
   * React calls a ref callback with null and then the instance whenever the
   * callback's identity changes — so an inline arrow here means the Surface is
   * unregistered and re-registered on every render. A resync that finished
   * during one of those gaps wrote its bytes to nothing, and the Pane stayed
   * blank until something else happened to write to it.
   *
   * It does change identity when the Attach does, and that is the one time it
   * should: the Surface is then handed to the new Attach — with the grid it
   * has already reported, because the Surface will not say it again for a
   * size that has not changed, and an Attach that has a Surface and no grid
   * paints nothing and raises no keyboard.
   */
  const register = useCallback(
    (ref: TerminalViewRef | null) => onRef(paneId, ref, reported.current),
    [onRef, paneId],
  );

  const { offset } = swipe;
  const part = slot.swipe;
  const { width } = slot.box;
  const moved = useAnimatedStyle(
    () => ({
      transform: [{ translateX: part === 'moves' ? offset.get() : part === 'waits' ? width : 0 }],
    }),
    [part, width, offset],
  );

  return (
    <Animated.View style={[styles.paneBox, slot.box, moved]}>
      <TerminalView
        ref={register}
        style={styles.surface}
        fontSize={font}
        // The library's own bar of ctrl/esc/tab/arrows above the keyboard,
        // and the iPad's undo, redo and Paste bar, both turned off by a local
        // patch. The Key Row stands in their place; see ADR 0003.
        accessoryBar={false}
        shortcutBar={false}
        theme={{
          background: terminal.background,
          foreground: terminal.foreground,
          cursorColor: terminal.cursor,
          // The sixteen colours everything on the Host actually paints with.
          // Undefined for the Default Theme, which is ghostty's own palette.
          palette: ansi ? [...ansi] : undefined,
        }}
        onResize={({ nativeEvent }) => {
          const grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
          say(`Surface for ${slot.pane.id} reported ${grid.cols}x${grid.rows}`);
          reported.current = grid;
          own.current = grid;
          onWindowResize?.({ nativeEvent });
          onPaneResize(slot.pane.id, grid);
          onCell({ width: nativeEvent.cellWidth, height: nativeEvent.cellHeight });
        }}
        onInput={({ nativeEvent }) => onInput(slot.pane.id, nativeEvent.data)}
        // The Scrollback is tmux's, so the gesture has to be Muxify's:
        // ghostty would otherwise spend it on one of its own that does not
        // exist here. The library locks the drag to one axis when it begins:
        // a vertical drag is the scroll and a horizontal one is the swipe,
        // which says how far it has gone and ticks at its commit point.
        // Needs the local patch.
        ownsScrollGesture
        onScroll={({ nativeEvent }) =>
          onScroll(slot.pane.id, own.current, slot.box.height, nativeEvent.points)
        }
        onSwipeProgress={({ nativeEvent }) =>
          swipe.drag(nativeEvent.translation, nativeEvent.width, false)
        }
        onSwipe={({ nativeEvent }) => swipe.swipe(nativeEvent.direction)}
        onSwipeCancel={swipe.cancel}
        // The Selection Layer, which the local patch adds: iOS text selection
        // over the Surface, with its text read from tmux. See ADR 0014.
        onSelectionPress={({ nativeEvent }) =>
          onSelectionPress(slot.pane.id, { x: nativeEvent.x, y: nativeEvent.y })
        }
        onSelectionEnd={onSelectionEnd}
        onSelectionEdge={({ nativeEvent }) =>
          onSelectionEdge(slot.pane.id, own.current, nativeEvent.direction)
        }
        onPaste={({ nativeEvent }) => onPaste(nativeEvent)}
      />

      {/* The seam, and only the seam. A rectangle per Pane drew a rule along
          the bottom of the Window and another along the top, neither of which
          divides anything, and doubled every line between Panes — each side of
          it drawing its own. A Pane that does not start at the Window's own
          edge has a neighbour there, so that is where the line goes, and the
          Pane on the far side of it draws nothing. It sits in the cell tmux
          keeps for a separator, which the two Panes share half each. */}
      {!slot.fillsWindow && slot.pane.top > 0 ? (
        <View pointerEvents="none" style={[styles.seamTop, { backgroundColor: terminal.dim }]} />
      ) : null}
      {!slot.fillsWindow && slot.pane.left > 0 ? (
        <View pointerEvents="none" style={[styles.seamLeft, { backgroundColor: terminal.dim }]} />
      ) : null}

      {!slot.fillsWindow && !slot.pane.active ? (
        <View
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={`Pane ${slot.pane.index}`}
          onStartShouldSetResponder={() => true}
          onResponderGrant={({ nativeEvent }: GestureResponderEvent) => {
            from.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
            sideways.current.clear();
            sideways.current.add(nativeEvent.locationX, Date.now());
          }}
          onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
            const dx = nativeEvent.locationX - from.current.x;
            const dy = nativeEvent.locationY - from.current.y;
            sideways.current.add(nativeEvent.locationX, Date.now());
            if (Math.hypot(dx, dy) > TAP_SLOP && panAxis(dx, dy) === 'horizontal') {
              swipe.drag(dx, width, true);
            }
          }}
          // A tap, not a drag. Without the slop a finger that started on the
          // other Pane on its way somewhere moved the keyboard with it. A
          // horizontal drag is the same swipe as on the active Pane.
          onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
            const dx = nativeEvent.locationX - from.current.x;
            const dy = nativeEvent.locationY - from.current.y;
            if (Math.hypot(dx, dy) <= TAP_SLOP) {
              onSelect(slot.pane.id);
              return;
            }
            const direction =
              panAxis(dx, dy) === 'horizontal'
                ? swipeOf(dx, width, sideways.current.velocity(Date.now()))
                : null;
            if (direction) swipe.swipe(direction);
            else swipe.cancel();
          }}
          onResponderTerminate={swipe.cancel}
        />
      ) : null}
    </Animated.View>
  );
}

/** How far a finger may travel and still be a tap rather than a drag, in points. */
const TAP_SLOP = 10;

/** How long a finger stays still to be a long press, as iOS counts it. */
const LONG_PRESS_MS = 500;

/** What the Jump to latest pill claims beyond its own edges, to reach 44pt. */
const PILL_SLOP = { top: 8, bottom: 8, left: 12, right: 12 };

/**
 * The finger, while an application in the Pane is listening for the mouse.
 *
 * It covers the Surface and takes every touch: a tap becomes a click at the
 * cell underneath, and a vertical drag becomes wheel notches — which is what
 * the application would get from any terminal, and what makes Claude Code's
 * "Jump to bottom", vim's status line or a file in a picker tappable at all.
 * A horizontal drag is the swipe to another Pane, on the same axis lock as the
 * Surface's own gesture, so the application gets nothing from it. See panAxis.
 *
 * Why a layer rather than the Surface's own gesture. A tap already means
 * something there — it raises the keyboard — and that behaviour lives in the
 * library, below anything this app can reach. Wrapping the Surface in a
 * gesture recogniser of our own was tried and is worse than either outcome: it
 * loses the race to the library's own recogniser, so no click is sent, while
 * still cancelling the touch, so the keyboard stops rising too.
 *
 * So the trade is made explicitly and only where it is wanted. While something
 * is listening for the mouse the finger belongs to it, and the keyboard is
 * raised from the Key Row — which is what that button is for. The moment nothing
 * is listening this layer is gone and the Surface behaves exactly as it did.
 */
function MouseLayer({
  box,
  grid,
  cell,
  onTap,
  onLongPress,
  onScroll,
  swipe,
}: {
  box: PaneBox;
  grid: Grid;
  /** How big a cell is, or null before a Surface has said. See cellOf. */
  cell: Extent | null;
  onTap: (column: number, row: number) => void;
  /** A finger held still: the start of a Selection, and no click. */
  onLongPress: (press: SurfacePoint) => void;
  onScroll: (lines: number) => void;
  swipe: PaneSwipe;
}) {
  const size = useRef({ width: 0, height: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const previous = useRef(0);
  /** What the drag is for, or null while the touch could still be a tap. */
  const axis = useRef<PanAxis | null>(null);
  /**
   * Where a horizontal drag began: where the finger left the tap slop, which
   * is where the Surface's own gesture counts from. The Pane does not jump.
   */
  const swipeFrom = useRef(0);
  /** How fast the finger is going sideways, which can make a short drag a swipe. */
  const sideways = useRef(createVelocityTracker());
  /** Fractions of a line a slow drag has not yet spent. */
  const carried = useRef(0);
  /** Where the finger has been lately, which is what a flick is worth. */
  const track = useRef(createVelocityTracker());
  /** When it last moved, so a finger that stopped before lifting throws nothing. */
  const movedAt = useRef(0);
  /** The frame loop a flick is coasting on, so a new touch can stop it. */
  const coasting = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  /** Runs out when the finger has been still long enough to be a long press. */
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether this touch became a long press, so its release is not a tap. */
  const held = useRef(false);
  const stopHolding = useCallback(() => {
    if (holding.current !== null) clearTimeout(holding.current);
    holding.current = null;
  }, []);

  /** Points of travel, banked until they make whole lines. */
  const spend = useCallback(
    (points: number) => {
      const { height } = size.current;
      if (height <= 0 || grid.rows <= 0) return;
      // A finger moving down pulls older output into view, which is the same
      // sign the Surface's own scroll reports.
      const lineHeight = cell && cell.height > 0 ? cell.height : height / grid.rows;
      carried.current += (points / lineHeight) * SCROLL_SPEED;
      const lines = Math.trunc(carried.current);
      if (lines === 0) return;
      carried.current -= lines;
      onScroll(lines);
    },
    [cell, grid.rows, onScroll],
  );

  const stopCoasting = useCallback(() => {
    if (coasting.current === null) return;
    cancelAnimationFrame(coasting.current);
    coasting.current = null;
  }, []);

  /**
   * Keeps a flick going after the finger has gone.
   *
   * The Surface's own gesture gets this from the terminal library, which ends
   * a pan by decaying the velocity on a display link. This layer takes the
   * finger instead whenever something is listening for the mouse — which on a
   * phone is most of the time, because that is what Claude Code and vim do —
   * and without this a flick there stopped dead on release. Same constants, so
   * both feel the same. See coast.
   */
  const fling = useCallback(
    (velocity: number) => {
      stopCoasting();
      if (!isFlick(velocity)) return;
      let speedNow = velocity;
      let lastFrame = Date.now();
      const frame = () => {
        const now = Date.now();
        const seconds = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        const step = coast(speedNow, seconds);
        if (!step.moving) {
          coasting.current = null;
          return;
        }
        speedNow = step.velocity;
        spend(step.points);
        coasting.current = requestAnimationFrame(frame);
      };
      coasting.current = requestAnimationFrame(frame);
    },
    [spend, stopCoasting],
  );

  useEffect(() => stopCoasting, [stopCoasting]);
  useEffect(() => stopHolding, [stopHolding]);

  return (
    <View
      style={[styles.paneBox, box]}
      testID="mouse-layer"
      onLayout={({ nativeEvent }) => {
        size.current = { width: nativeEvent.layout.width, height: nativeEvent.layout.height };
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={({ nativeEvent }: GestureResponderEvent) => {
        // A finger landing stops whatever the last one threw, exactly as
        // catching a scroll view does.
        stopCoasting();
        origin.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
        previous.current = nativeEvent.locationY;
        axis.current = null;
        carried.current = 0;
        track.current.clear();
        movedAt.current = Date.now();
        track.current.add(nativeEvent.locationY, movedAt.current);
        // The application takes every touch here, so the long press that
        // the Surface would see is timed here.
        const press = { x: nativeEvent.locationX, y: nativeEvent.locationY };
        held.current = false;
        stopHolding();
        holding.current = setTimeout(() => {
          holding.current = null;
          held.current = true;
          onLongPress(press);
        }, LONG_PRESS_MS);
      }}
      onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
        const travelled = nativeEvent.locationY - previous.current;
        previous.current = nativeEvent.locationY;
        if (axis.current === null) {
          const dx = nativeEvent.locationX - origin.current.x;
          const dy = nativeEvent.locationY - origin.current.y;
          if (Math.hypot(dx, dy) > TAP_SLOP) axis.current = panAxis(dx, dy);
          if (axis.current !== null) stopHolding();
          if (axis.current === 'horizontal') {
            swipeFrom.current = nativeEvent.locationX;
            sideways.current.clear();
          }
        }
        if (held.current) return;
        if (axis.current === 'horizontal') {
          sideways.current.add(nativeEvent.locationX, Date.now());
          swipe.drag(nativeEvent.locationX - swipeFrom.current, size.current.width, true);
          return;
        }

        // The last moment of the drag rather than the whole of it: what a
        // flick is worth is how fast the finger was going when it left, not
        // how fast it went on the way there.
        movedAt.current = Date.now();
        track.current.add(nativeEvent.locationY, movedAt.current);

        spend(travelled);
      }}
      onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
        const { width, height } = size.current;
        stopHolding();
        if (held.current) return;
        if (axis.current === 'horizontal') {
          const direction = swipeOf(
            nativeEvent.locationX - swipeFrom.current,
            width,
            sideways.current.velocity(Date.now()),
          );
          if (direction) swipe.swipe(direction);
          else swipe.cancel();
          return;
        }
        if (axis.current === 'vertical') {
          // Stale by more than a frame or two means the finger had already
          // stopped before it lifted, which is a placement rather than a throw.
          const now = Date.now();
          if (now - movedAt.current < 80) fling(track.current.velocity(now));
          return;
        }
        if (width <= 0 || height <= 0) return;
        onTap(
          cellOf(nativeEvent.locationX, cell?.width, width, grid.cols),
          cellOf(nativeEvent.locationY, cell?.height, height, grid.rows),
        );
      }}
      onResponderTerminate={() => {
        stopCoasting();
        stopHolding();
        if (axis.current === 'horizontal') swipe.cancel();
      }}
    />
  );
}


/**
 * A hairline down the right edge saying where in the Scrollback you are.
 *
 * Deliberately almost invisible, and only while a drag has actually moved:
 * it is an orientation cue on a phone-sized screen, not a control. Nothing
 * grabs it — the finger scrolls the Surface itself — so it is drawn without a
 * track, because a track would suggest otherwise.
 *
 * The arithmetic is the whole buffer, not just what has scrolled off: the
 * thumb is the visible rows as a share of Scrollback plus screen, and it sits
 * `back` lines up from the bottom of that.
 */
function ScrollRail({
  position,
  rows,
  palette,
}: {
  position: { back: number; scrollbackLines: number };
  rows: number;
  palette: TerminalPalette;
}) {
  const total = position.scrollbackLines + Math.max(1, rows);
  const thumb = Math.max(RAIL_MIN_FRACTION, Math.max(1, rows) / total);
  // Clamped so the thumb cannot be pushed off the bottom by its own minimum.
  const top = Math.min(1 - thumb, (position.scrollbackLines - position.back) / total);

  return (
    <View style={styles.rail} pointerEvents="none" testID="scroll-rail">
      <View
        style={[
          styles.railThumb,
          {
            backgroundColor: palette.foreground,
            top: `${Math.max(0, top) * 100}%`,
            height: `${thumb * 100}%`,
          },
        ]}
      />
    </View>
  );
}

/**
 * Says how far back the Pane is being viewed, and takes you back.
 *
 * Shown only while it is true, and it is tmux's own count of the Scrollback
 * rather than one this app kept — the two part company as soon as the
 * Scrollback runs out under a flick, and a number that is quietly wrong is
 * worse than no number.
 *
 * It doubles as the way out, because the two things a finger wants here are
 * "how far am I" and "take me back", and remux offers neither: its scrolled
 * pane has no indicator and no jump, so the only way down is to drag all the
 * way back by hand.
 */
function ScrollBackIndicator({
  position,
  palette,
  appearance,
  onPress,
}: {
  position: { back: number; scrollbackLines: number };
  palette: TerminalPalette;
  appearance: 'light' | 'dark';
  onPress: () => void;
}) {
  const atOldest = position.back >= position.scrollbackLines;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Jump to latest"
      // The pill is as tall as its own text and sits at the very bottom of the
      // Pane, which makes it the smallest target in the app at around thirty
      // points. iOS asks for forty-four, and a thumb reaching past the Key Row
      // for it is not aiming carefully. The slop costs nothing: there is
      // nothing else down there to press.
      hitSlop={PILL_SLOP}
      style={styles.scrollPill}
      testID="scroll-position">
      {isGlassEffectAPIAvailable() ? (
        <GlassView
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
          glassEffectStyle="regular"
          colorScheme={appearance}
          isInteractive
        />
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.background, borderRadius: 999 }]} />
      )}
      <ThemedText type="code" style={[styles.scrollPillText, { color: palette.foreground }]}>
        {atOldest ? `oldest of ${position.scrollbackLines} lines` : `${position.back} lines back`}
      </ThemedText>
      <ThemedText type="code" style={[styles.scrollPillAction, { color: palette.foreground }]}>
        Jump to latest
      </ThemedText>
    </Pressable>
  );
}

/**
 * The Banner for the Attach's phase, shown while it is anything but connected.
 *
 * It carries the Reconnect action, and only where trying again could work: a
 * lost transport, and nothing else. The quiet always-present indicator beneath
 * it carries the same label for assertions.
 */
function StatusBanner({
  status,
  appearance,
  palette,
  onReconnect,
}: {
  status: Status;
  appearance: 'light' | 'dark';
  palette: Appearance;
  onReconnect?: () => void;
}) {
  return (
    <Banner
      title={status.label}
      body={status.detail}
      leading={status.busy ? { busy: true } : { symbol: status.symbol }}
      tone={status.busy ? 'neutral' : 'warning'}
      actions={
        status.offerReconnect && onReconnect
          ? [{ id: 'reconnect', label: 'Reconnect', onPress: onReconnect, testID: 'reconnect' }]
          : undefined
      }
      appearance={appearance}
      palette={palette}
      accessibilityLabel={status.label}
    />
  );
}

const PANE_ACTIONS: SheetAction[] = [
  { id: 'split-right', label: 'Split →' },
  { id: 'split-down', label: 'Split ↓' },
];

/** How long a sheet takes to leave, so the next one can be presented. */
const SHEET_HANDOVER_MS = 450;

const NO_TABS: BrowserTab[] = [];

/** How many captured lines a preview box can show before it is just noise. */
const PREVIEW_LINES = 14;
const PREVIEW_COLUMNS = 46;

function previewOf(previews: Map<string, string[]>, target: string): string[] {
  return trimPreview(previews.get(target) ?? [], PREVIEW_LINES, PREVIEW_COLUMNS);
}

/**
 * Asks before a paste that the program in the Pane will run line by line.
 * See `paste` on the Attach.
 */
function confirmRunLines(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Paste more than one line?',
      'The program in this Pane did not ask for bracketed paste. It can run each line as the line arrives.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Paste', style: 'destructive', onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * Shown when a Host presents a different key from the one last seen.
 *
 * Loud, and over the terminal, because the two explanations — a rebuilt machine
 * or something sitting in the middle — look identical from here and only the
 * user knows which. It does not block: someone who has just rebuilt a machine
 * still has to be able to reach it.
 */
function HostKeyWarning({
  hostName,
  appearance,
  palette,
  onAccept,
  onDismiss,
}: {
  hostName: string;
  appearance: 'light' | 'dark';
  palette: Appearance;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <Banner
      title={`${hostName} presented a different host key`}
      body="It may have been rebuilt, or something may be intercepting the connection."
      leading={{ symbol: 'exclamationmark.shield.fill' }}
      tone="warning"
      actions={[
        { id: 'dismiss', label: 'Not now', onPress: onDismiss, prominent: false },
        { id: 'accept', label: 'Accept new key', onPress: onAccept },
      ]}
      appearance={appearance}
      palette={palette}
      accessibilityLabel={`Host key changed for ${hostName}`}
    />
  );
}

/** The shortest the rail's thumb may get, so it never vanishes entirely. */
const RAIL_MIN_FRACTION = 0.04;

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    right: 2,
    width: 2,
  },
  railThumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 1,
    // Barely there on purpose: enough to find with an eye that is looking for
    // it, not enough to read as chrome over somebody's output.
    opacity: 0.25,
  },
  scrollPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  scrollPillText: {
    fontSize: 13,
  },
  scrollPillAction: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  container: {
    flex: 1,
  },
  surfaceArea: {
    flex: 1,
    // The Window is taller than this while the keyboard is up, and slid; what
    // is past either edge is clipped rather than drawn under the glass Key Row.
    overflow: 'hidden',
  },
  paneBox: {
    position: 'absolute',
    overflow: 'hidden',
  },
  // Quiet: a division, not a frame. Drawn in the Theme's dim tone so it reads
  // as part of the terminal rather than as chrome laid over it.
  seamTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  seamLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  surface: {
    flex: 1,
  },
  top: {
    position: 'absolute',
    // Inset from the sides as far as the Key Row is from the bottom.
    left: 8,
    right: 8,
    gap: 8,
  },
  overlay: {
    alignItems: 'flex-end',
    gap: 2,
    paddingRight: 4,
  },
  troubleText: {
    maxWidth: 260,
    textAlign: 'right',
  },
});

/** The reconnect's visit to `host`, on the Host's Connection. */
function sessionVisit(host: Host): SessionVisit {
  return async ({ onHostKey, onSignedIn }) => {
    const sessions = await appConnections().read(
      host,
      (transport) => {
        onSignedIn();
        return new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions();
      },
      { onHostKey },
    );
    const names = sessions.map((candidate) => candidate.name);
    say(`reconnect: ${host.displayName} has ${names.join(', ') || 'no Sessions'}`);
    return names;
  };
}
