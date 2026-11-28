import { TerminalView, type TerminalPasteEvent, type TerminalViewRef } from 'expo-libghostty';
import { File } from 'expo-file-system';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter, type NativeStackNavigationProp } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Presence, type BannerAction } from '@/components/banner';
import { TrackpadScroll } from '@/components/trackpad-scroll';
import type { TrackpadTarget } from '@/lib/trackpad-gesture';
import { ConnectionScreen } from '@/components/connection-screen';
import { KeyRow, KEY_ROW_HEIGHT } from '@/components/key-row';
import { usePhysicalKeyboard } from '@/hooks/use-physical-keyboard';
import { useKeyboardFrame } from '@/hooks/use-keyboard-frame';
import { inputNoticeCopy, shownInputNotice } from '@/lib/input-notice-copy';
import { terminalClearance, type ScreenRect } from '@/lib/terminal-clearance';
import { EdgeDrawer, useEdgeSwitcher } from '@/components/edge-drawer';
import { ON_PANE } from '@/domain/destinations';
import { EdgeGrip } from '@/components/edge-grip';
import { LayoutMap } from '@/components/layout-map';
import { OptionsSheet } from '@/components/options-sheet';
import { ComposerPanel } from '@/composer/composer-panel';
import type { ComposerInputRef } from '@/composer/native-input';
import { stageFile } from '@/composer/staging';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import {
  TerminalHeader,
  type HeaderTitle,
  type OptionsItem,
} from '@/components/terminal-header';
import { ThemedText } from '@/components/themed-text';
import { TitleSheet } from '@/components/title-sheet';
import {
  type Appearance,
  type TerminalPalette,
} from '@/constants/app-theme';
import type { NamedKey } from '@/constants/row-keys';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { actionLabel, coverOf, type Cover, type CoverAction } from '@/domain/cover';
import { keyboardTarget } from '@/domain/keyboard';
import { useCopyLog } from '@/hooks/use-copy-log';
import { usePaneSwipe, type PaneSwipe } from '@/hooks/use-pane-swipe';
import { clampFontSize, fontSizeInForce } from '@/settings/settings';
import { useSettings } from '@/settings/settings-context';
import { useTitleSheet } from '@/hooks/use-title-sheet';
import { MENU_ITEM } from '@/topics/session-action';
import { fieldsParam } from '@/topics/topic-edit';
import { placeTabRoute } from '@/browser/place-tab-route';
import type { BrowserTab } from '@/browser/tabs';
import {
  topicSeedParam,
} from '@/topics/topic-detail';
import { useCoverAction, useGoHost } from '@/hooks/use-cover-action';
import { useRouteSession, type RouteSession } from '@/hooks/use-route-session';
import type { PlaceTab } from '@/storage/records';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { describeError } from '@/lib/describe-error';
import { directoryName } from '@/lib/paths';
import { coast, createVelocityTracker, isFlick } from '@/lib/inertia';
import { panAxis, swipeOf, type PanAxis } from '@/lib/pan-axis';
import { BACK_EDGE, startsAtBackEdge } from '@/navigation/back-swipe';
import { useBackSwipe } from '@/navigation/use-back-swipe';
import {
  anyArmed,
  commandChord,
  NO_MODIFIERS,
  typedKeys,
  type Modifier,
  type Modifiers,
} from '@/lib/modifier-keys';
import { NO_GRIP_ACTIONS, type GripActionRuns } from '@/lib/grip-actions';
import { optionRun } from '@/lib/options-table';
import { DEFAULT_QUICK_ACTIONS, quickActionLabel, type QuickAction, type QuickActionSlots } from '@/lib/quick-actions';
import { runQuickAction } from '@/keyboard/run-quick-action';
import { requestGoTo } from '@/keyboard/go-to-request';
import { performChord, useScreenKeyboardShortcuts, type KeyboardHandlers } from '@/keyboard/key-commands';
import { toShellInput, toTypedParts, withoutTerminalReplies } from '@/lib/terminal-input';
import type { Attach, Paste } from '@/tmux/attach';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { cellOf, paneBoxes, windowSlide, clippedRowHeight, type Extent, type PaneBox } from '@/tmux/pane-layout';
import type { PaneSurface, PaneView, SurfacePoint } from '@/tmux/pane-view';
import { paneTopologyFrames } from '@/tmux/pane-topology';
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
// The React Compiler skips this component, for its react-hooks suppression,
// so the refs it writes during render are not memoized. Until the Title Sheet
// moved to useTitleSheet, the linter's compiler stopped at a `finally` in it
// and checked nothing in this component; these rules are the ones it then
// found.
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization */
/** What the header says while a tmux verb runs from a tap. */
const SPLITTING = 'Splitting the Pane';
const ADDING_WINDOW = 'Adding a Window';

export default function TerminalScreen() {
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  /** The Session from an external link or a cold start's Last Place. */
  const routeSession = useLocalSearchParams<RouteSession>();
  const insets = useSafeAreaInsets();
  const { settings, update, terminal, ansi, appearance, palette: chrome, sheetPalette } = useSettings();

  const holder = useAttachHolder();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
  const hostId = attach?.hostId ?? routeSession.hostId;
  const opening = useRouteSession(routeSession, 'terminal', say);
  const { missing, lookup, forgetLookup } = opening;

  const goHost = useGoHost(hostId);

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
  const clearance = terminalClearance(rootBounds, keyboardFrame, insets.bottom);
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
  /**
   * The same, for a key to read and spend at once. What ghostty writes for a
   * pressed key comes back as input, and can come before the next render. It
   * must find nothing armed, or the modifiers would go with it a second time.
   */
  const armedRef = useRef<Modifiers>(NO_MODIFIERS);
  armedRef.current = physicalKeyboard ? NO_MODIFIERS : armed;
  useLayoutEffect(() => {
    if (physicalKeyboard) setArmed(NO_MODIFIERS);
    say(`physical keyboard ${physicalKeyboard ? 'connected' : 'disconnected'}`);
  }, [physicalKeyboard]);
  const [picker, setPicker] = useState<PickerState>({ open: false });
  const closePicker = useCallback(() => setPicker({ open: false }), []);
  /**
   * A Tab picked in the Title Sheet: its page in the Web View. The Attach
   * stays up. The page takes this screen's place, so Back from it goes to the
   * Host Screen, as Back from here does, and the Place keeps the page.
   */
  const showTab = useCallback((tab: BrowserTab) => {
    router.replace({ pathname: '/web-view', params: { url: tab.url, title: tab.title } });
  }, [router]);
  /** A Topic or Session opened from the Title Sheet whose Place has a Tab: its page, in this screen's place. */
  const moved = useCallback((tab: PlaceTab | null) => {
    if (tab) router.replace(placeTabRoute(tab));
  }, [router]);
  const chooser = useTitleSheet({ attach, state, hostId, onOpenTab: showTab, onMoved: moved, beforeOpen: closePicker,
    onReplacingStopped: forgetLookup, onScreen: ON_PANE });
  const { closeChooser, openTitleSheet, openSessionsOnly, topic, attachedSession, actOnAttachedSession } = chooser;
  const switcher = useEdgeSwitcher(chooser.drawer, chooser.openDrawer);
  /** The Grip's Fan is open under a held finger. */
  const [fanOpen, setFanOpen] = useState(false);
  /** The Options sheet, which the Grip's Options action opens: the ⋯ menu cannot be opened from code. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** The trial of the Edge Drawer as the way to a Pane: see Settings.hidePanesPicker. */
  const hidePanesPicker = settings.hidePanesPicker;
  useFocusEffect(useCallback(() => closePicker, [closePicker]));

  const fontSize = fontSizeInForce(settings.fontSize);

  const topology = state?.topology;
  const visibleGrid = state?.grid ?? null;
  const activePaneId = topology?.activePane?.id ?? '';
  /** Whether keys reach the active Pane. Every control that sends keys reads this. */
  const open = state?.typing.kind === 'open';
  const painted = state?.painted ?? NOTHING_PAINTED;
  /** Whether the active Pane's Surface may hold the keyboard: keys reach it and it shows something. */
  const canType = open && painted.has(activePaneId);
  /** The same, where the Surface's input callback can read it without rebuilding. */
  const typingOpen = useRef(false);
  typingOpen.current = open;

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
  // The cell a split is sized from, as the font gives it now.
  useEffect(() => {
    if (cellSize) attach?.cellReported(cellSize);
  }, [attach, cellSize]);

  /** The full height survives keyboard and Composer layout changes. */
  const windowHeight = Math.max(0, rootBounds.height - (physicalKeyboard ? 0 : KEY_ROW_HEIGHT) - clearance.resting);
  const [selectionArea, setSelectionArea] = useState<Extent | null>(null);
  const selecting = selectionArea !== null;
  // A handle of a Selection can sit at column 1, where the back swipe starts.
  useBackSwipe(selecting ? 'off' : 'edge');
  /** The mouse layer's long press is still down. See MouseLayer. */
  const [mousePressHeld, setMousePressHeld] = useState(false);
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
  // Unread on visit: the Terminal Screen in focus shows the Attach's Panes, as a visit on the Mac does.
  useFocusEffect(useCallback(() => attach?.terminalFocused(), [attach]));

  const sheetOpen = picker.open || chooser.sheet.isPresented || optionsOpen;
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
      if (!wasScrolled) {
        view.focusKeyboard();
        attach?.setKeyboard('up');
      }
    },
    [activeView, attach],
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
    [endSelection, activePaneId, activeWindowIndex, sessionName, open],
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
   * Each Pane's Surface, as the Pane view sees it. Kept here as well, because
   * the keyboard rule below must reach the Surface after a lost Connection
   * has released its view, and because a key is pressed into it.
   */
  const surfaces = useRef(new Map<string, ScreenSurface>());
  const keyboardIntent = state?.keyboard ?? 'down';
  /** The Edge Drawer and the Grip's Fan are input too: their open, and the finger that holds the Grip, own the touches. */
  const inputElsewhere = composerOpen || selecting || sheetOpen || chooser.drawer.open || fanOpen || !screenFocused;
  const target = keyboardTarget({
    intent: keyboardIntent,
    physicalKeyboard,
    activePaneId: activeSlot ? activePaneId : null,
    typingOpen: open,
    inputElsewhere,
  });
  const targetKind = target.kind;
  const targetPaneId = target.kind === 'pane' ? target.paneId : null;
  /**
   * The one place the system keyboard is moved. Only the active Pane's Surface
   * holds it: a Pane that takes it from another needs no blur first, because
   * a first responder gives way to the next. See keyboardTarget.
   */
  useEffect(() => {
    if (targetKind === 'elsewhere') return;
    if (targetPaneId !== null) {
      say('keyboard: focus');
      surfaces.current.get(targetPaneId)?.focus();
      return;
    }
    say('keyboard: blur');
    for (const surface of surfaces.current.values()) surface.blur();
  }, [targetKind, targetPaneId]);
  // A hardware keyboard that leaves while the active Pane holds the keyboard
  // leaves the system keyboard up on it: that is what the user now has.
  const heldForHardware = useRef(false);
  useLayoutEffect(() => {
    if (heldForHardware.current && !physicalKeyboard) attach?.setKeyboard('up');
    heldForHardware.current = physicalKeyboard && targetKind === 'pane';
  }, [attach, physicalKeyboard, targetKind]);
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
      const surface = ref === null ? null : surfaceFor(ref);
      if (surface) surfaces.current.set(paneId, surface);
      else surfaces.current.delete(paneId);
      attach?.surfaceForPane(paneId, surface, grid);
    },
    [attach],
  );

  const reportPaneGrid = useCallback(
    (paneId: string, grid: Grid) => {
      setPaneGrids((before) => {
        const known = before.get(paneId);
        return known?.cols === grid.cols && known.rows === grid.rows
          ? before : new Map(before).set(paneId, grid);
      });
      attach?.paneGridReported(paneId, grid);
    },
    [attach],
  );

  // A Pane Swipe brings the next Pane in once it is painted: before that its
  // Surface is invisible, and the swipe would slide in the bare background.
  const { panePainted } = swipe;
  useEffect(() => {
    if (activePaneId !== '' && painted.has(activePaneId)) panePainted(activePaneId);
  }, [painted, activePaneId, panePainted]);

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
   * Paste from the Surface's edit menu or from command-V on a hardware
   * keyboard. The Surface read the clipboard inside the system's own paste
   * action, so iOS asks nothing, and the text goes the same safe way in.
   */
  const pasteFromSurface = useCallback(
    (paneId: string, pasted: TerminalPasteEvent) => {
      if (!attach) return;
      const destination = () => {
        const live = attach.state();
        return holder.current() === attach && live.typing.kind === 'open' &&
          live.topology.activePane?.id === paneId ? attach : null;
      };
      void pasteInto(destination, async () => {
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
    [attach, holder],
  );

  const clearPane = useCallback(() => attach?.clearPane(), [attach]);

  /**
   * Keys from the Key Row or the system keyboard, for one Pane. The first
   * carries whatever is armed, and spends it.
   *
   * With command, a key can be a Keyboard Shortcut, decided as for a
   * hardware keyboard. Every other key is pressed into the Pane's Surface, as
   * a hardware keyboard presses it, so ghostty does for it what it does for a
   * hardware key. What ghostty writes comes back through handlePaneInput.
   */
  const pressKeys = useCallback(
    (paneId: string, keys: readonly string[]) => {
      // A key is for the live Pane, not for the still picture of it.
      endSelection();
      const held = armedRef.current;
      armedRef.current = NO_MODIFIERS;
      if (anyArmed(held)) setArmed(NO_MODIFIERS);
      keys.forEach((key, index) => {
        const modifiers = index === 0 ? held : NO_MODIFIERS;
        const chord = commandChord(key, modifiers);
        if (chord !== undefined && performChord(chord)) return;
        surfaces.current.get(paneId)?.pressKey(key, modifiers);
      });
    },
    [endSelection],
  );

  /**
   * Bytes typed into one Pane's Surface.
   *
   * Aimed at the Surface that sent them. Where they go is the Attach's to say:
   * a key from a Surface that no longer holds the keyboard, or one typed while
   * a split is being made, goes to the Pane in use.
   */
  const handlePaneInput = useCallback(
    (paneId: string, data: string) => {
      // The keyboard goes down when typing stops, but a hardware keyboard or a
      // key already on its way can still arrive. It has nowhere to go.
      if (!typingOpen.current) return;
      const view = attach?.view(paneId);
      if (!view) return;
      // `data` is base64. The sibling `text` field must not be used: a
      // multi-byte character split across reads is corrupted by text decoding.
      //
      // What comes out of the Surface is not quite what a shell expects — every
      // keystroke arrives wrapped as a bracketed paste. See toShellInput.
      const typed = toShellInput(withoutTerminalReplies(base64ToBytes(data)));
      if (typed.length === 0) return;

      // A key is for the live Pane, not for the still picture of it.
      endSelection();
      for (const part of toTypedParts(typed)) {
        if (part.kind === 'press') {
          view.press(part.press);
          continue;
        }
        // The system keyboard typed with a modifier armed. Its keys go back
        // into the Surface as key presses, the first with the modifier, so
        // they stay in the order they were typed.
        const keys = anyArmed(armedRef.current) ? typedKeys(part.bytes) : undefined;
        if (keys === undefined) view.type(part.bytes);
        else pressKeys(paneId, keys);
      }
    },
    [attach, endSelection, pressKeys],
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
    // The Surface has the keyboard or not, and the toggle says what the user now wants.
    void view?.toggleKeyboard().then((intent) => {
      if (intent !== null) attach?.setKeyboard(intent);
    });
  }, [activeView, activePaneId, attach, composerOpen, keyboardVisible]);

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

  /** The tmux verbs that run from a tap, newest last, so the header says what runs from the tap until tmux answers. */
  const [verbs, setVerbs] = useState<readonly { id: symbol; doing: string }[]>([]);
  /** Runs `verb` with the header saying `doing` until it ends. */
  const showVerb = useCallback(async (doing: string, verb: () => Promise<void>) => {
    const id = Symbol(doing);
    setVerbs((running) => [...running, { id, doing }]);
    try {
      await verb();
    } finally {
      setVerbs((running) => running.filter((each) => each.id !== id));
    }
  }, []);
  /** The Splits: the Panes sheet's bottom bar. */
  const runSheetAction = useCallback(
    (id: string) => {
      say(`sheet action ${id}`);
      if (!attach) return;
      void (async () => {
        try {
          if (id === 'split-right') await showVerb(SPLITTING, () => attach.split('right'));
          else if (id === 'split-down') await showVerb(SPLITTING, () => attach.split('down'));
          setPicker({ open: false });
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [attach, showPickerError, showVerb],
  );

  /** The Theme's chrome colours: the Key Row's labels and the Banners. */

  /**
   * Typed keys that did not reach their Pane after a break, for the user to
   * decide about or to read. The Composer covers the place of the card, so
   * the card waits until the Composer closes.
   */
  const inputNotice = state && attach && !composerOpen ? shownInputNotice(state.input, activePaneId) : null;
  /** The open Composer shows the held keys of its own Pane, which can hold its message. */
  const composerHeld = useMemo(() => {
    if (!composerOpen) return null;
    const held = state?.input.find((notice) => notice.paneId === activePaneId && notice.kind === 'held');
    return held?.kind === 'held' ? inputNoticeCopy(held, activePaneId) : null;
  }, [composerOpen, state?.input, activePaneId]);
  const inputCard = useMemo(() => {
    if (!inputNotice || !attach) return null;
    const { paneId } = inputNotice;
    const copy = inputNoticeCopy(inputNotice, activePaneId);
    const openComposer = () => {
      setArmed(NO_MODIFIERS);
      setComposerOpen(true);
    };
    const compose: BannerAction[] = copy.compose
      ? [{
          id: 'compose',
          label: copy.compose,
          prominent: false,
          onPress: () => {
            const moved = inputNotice.kind === 'discarded'
              ? attach.discardedInput(paneId, 'compose')
              : attach.heldInput(paneId, 'compose') && paneId === activePaneId;
            if (moved) openComposer();
          },
          testID: 'input-compose',
        }]
      : [];
    const actions: BannerAction[] =
      inputNotice.kind === 'discarded'
        ? [
            ...compose,
            { id: 'dismiss', label: 'Dismiss', onPress: () => attach.discardedInput(paneId, 'dismiss'), testID: 'input-dismiss' },
          ]
        : [
            { id: 'discard', label: 'Discard', prominent: false, onPress: () => attach.heldInput(paneId, 'discard'), testID: 'input-discard' },
            ...compose,
            { id: 'send', label: 'Send', disabled: !open, onPress: () => attach.heldInput(paneId, 'send'), testID: 'input-send' },
          ];
    return (
      <Banner
        title={copy.preview}
        code
        body={copy.reason}
        leading={{ symbol: inputNotice.kind === 'discarded' ? 'trash' : 'pause.circle' }}
        tone={inputNotice.kind === 'discarded' ? 'warning' : 'neutral'}
        actions={actions}
        appearance={appearance}
        palette={chrome}
        accessibilityLabel={copy.label}
        testID={inputNotice.kind === 'discarded' ? 'input-discarded' : 'input-held'}
      />
    );
  }, [inputNotice, attach, activePaneId, open, appearance, chrome]);

  /** One symbol of a pair key, into the active Pane with whatever is armed. */
  const pressSymbol = useCallback((symbol: string) => pressKeys(activePaneId, [symbol]), [activePaneId, pressKeys]);

  /** Escape, tab or an arrow from the Key Row, the same way. */
  const pressKey = useCallback((key: NamedKey) => pressSymbol(key.key), [pressSymbol]);

  /** A modifier tapped: on if it was off, and off if it was on. */
  const armModifier = useCallback((modifier: Modifier) => {
    setArmed((previous) => ({ ...previous, [modifier]: !previous[modifier] }));
  }, []);

  /** The header's lines. Until a Topic read lands, a Topic's Session reads as a Session. */
  const headerTitle = useMemo((): HeaderTitle | null => {
    if (!state) return null;
    const program = topology?.activePane?.command ?? null;
    const doing = verbs.at(-1)?.doing ?? (chooser.going === null ? undefined : `Going to ${chooser.going}`);
    const title: HeaderTitle = topic
      ? { kind: 'topic', topic: topic.label, program, session: state.sessionName }
      : { kind: 'session', session: state.sessionName, program };
    return doing === undefined ? title : { ...title, doing };
  }, [state, topology, topic, verbs, chooser.going]);


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
  const runVerb = useCallback((label: string, doing: string, verb: () => Promise<void>) => {
    void showVerb(doing, verb).catch((error: unknown) => Alert.alert(`Could not ${label}`, describeError(error)));
  }, [showVerb]);

  const paneActions = useMemo(() => attach ? ({
    'split-right': () => runVerb('split the Pane', SPLITTING, () => attach.split('right')),
    'split-down': () => runVerb('split the Pane', SPLITTING, () => attach.split('down')),
    'clear-pane': clearPane,
    'copy-pane': copyPaneText,
  }) : null, [attach, runVerb, clearPane, copyPaneText]);

  const shortcutHandlers = useMemo<KeyboardHandlers>(() => attach && paneActions ? {
    ...(hostId ? { 'go-to': () => { requestGoTo(hostId, { kind: 'terminal' }); goHost(); } } : {}),
    ...paneActions,
    'pane-left': () => attach.selectPaneToward('left'),
    'pane-down': () => attach.selectPaneToward('down'),
    'pane-up': () => attach.selectPaneToward('up'),
    'pane-right': () => attach.selectPaneToward('right'),
    // ⌘C is the system's Copy wherever a text has the keys.
    'copy-pane': inputElsewhere ? undefined : paneActions['copy-pane'],
  } : {}, [attach, hostId, goHost, paneActions, inputElsewhere]);
  useScreenKeyboardShortcuts(shortcutHandlers);

  const quickActions = useMemo(() => {
    const configured = settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
    const tiles = (slots: QuickActionSlots) => slots.map(id => {
      if (id === null) return null;
      const { chord, title } = quickActionLabel(id, settings.keyboardShortcuts);
      return { id, chord, label: title };
    });
    return { ctrl: tiles(configured.ctrl), cmd: tiles(configured.cmd) };
  }, [settings.quickActions, settings.keyboardShortcuts]);

  const pickQuickAction = (action: QuickAction) => {
    if (!attach || !paneActions || composerOpen || sheetOpen || !navigation.isFocused()) return;
    const hasTarget = () => {
      const live = attach.state();
      return holder.current() === attach && live.typing.kind === 'open' &&
        live.sessionName === sessionName && live.topology.activePane?.id === activePaneId;
    };
    if (!hasTarget()) return;
    const surface = surfaces.current.get(activePaneId);
    if (!surface) return;
    endSelection();
    armedRef.current = NO_MODIFIERS;
    setArmed(NO_MODIFIERS);
    runQuickAction(action, {
      control: key => {
        if (hasTarget()) attach.view(activePaneId).press({ key, ctrl: true, alt: false, shift: false });
      },
      paste: () => surface.pressKey('v', { ...NO_MODIFIERS, cmd: true }),
      shortcut: id => paneActions[id](),
    });
  };

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
      // Zoom and the Splits keep their own items in Options while the trial hides the picker.
      ...(hidePanesPicker ? [] : [action('panes', 'Panes', 'square.grid.2x2', openPanes, { disabled: !open })]),
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
      ...(attachedSession ? [{
        kind: 'menu' as const, id: 'session', label: 'Session', systemImage: 'terminal' as const,
        items: attachedSession.actions.map((each) => action(
          each,
          MENU_ITEM[each].label,
          MENU_ITEM[each].icon,
          () => actOnAttachedSession(attachedSession.session, each),
          { destructive: MENU_ITEM[each].destructive },
        )),
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
        () => runVerb('add a Window', ADDING_WINDOW, () => attach?.newWindow() ?? Promise.resolve()),
        { disabled: !open },
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
            () => runVerb('split the Pane', SPLITTING, () => attach?.split('right') ?? Promise.resolve()),
            { disabled: !open },
          ),
          action(
            'split-down',
            'Split ↓',
            'rectangle.split.1x2',
            () => runVerb('split the Pane', SPLITTING, () => attach?.split('down') ?? Promise.resolve()),
            { disabled: !open },
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
        if (hostId) router.push({ pathname: '/chooser-lists', params: { hostId } });
      }),
      action('copy-log', 'Copy log', 'doc.text', copyLog),
      action('disconnect', 'Disconnect', 'xmark.circle', disconnect, { destructive: true }),
    ];
  }, [
    topic,
    state?.topic,
    attachedSession,
    actOnAttachedSession,
    hostId,
    router,
    composerOpen,
    toggleComposer,
    openPanes,
    hidePanesPicker,
    toggleKeyboard,
    activePaneId,
    state?.zoomed,
    attach,
    open,
    runVerb,
    stepFontSize,
    copyPaneText,
    copyLog,
    disconnect,
    closeChooser,
  ]);

  /**
   * What each Grip action does on this screen. Most are an entry of the Options
   * table, so a lift in the Fan does what the same item of the ⋯ menu does and
   * is dimmed when that item is disabled.
   */
  const gripActions: GripActionRuns = {
    ...NO_GRIP_ACTIONS,
    'go-to': hostId ? () => { requestGoTo(hostId, { kind: 'terminal' }); goHost(); } : undefined,
    compose: optionRun(options, 'compose'),
    options: () => setOptionsOpen(true),
    keyboard: optionRun(options, 'keyboard'),
    'title-sheet': openTitleSheet,
    'host-screen': goHost,
    'split-right': optionRun(options, 'split-right'),
    'split-down': optionRun(options, 'split-down'),
    'new-window': optionRun(options, 'new-window'),
    'zoom-pane': optionRun(options, 'zoom'),
    paste: open && !composerOpen ? () => pickQuickAction('paste') : undefined,
    'copy-pane': optionRun(options, 'copy-pane'),
  };

  const place = {
    hostName: attach?.hostName ?? opening.hostName,
    session: state?.sessionName ?? opening.session,
  };
  const cover = coverOf({
    missing,
    lookup,
    attach: state ? { typing: state.typing, step: state.step, paintedOnce: state.paintedOnce } : null,
    place,
  });

  const runCoverAction = useCoverAction({ opening, attach, hostId, openSessionsOnly, say });

  return (
    <TerminalHeader
      title={headerTitle}
      terminal={terminal}
      chrome={cover.kind === 'connection-screen' ? chrome : null}
      onTitle={openTitleSheet}
      options={options}>
      <View
        ref={rootView}
        onLayout={() => rootView.current?.measureInWindow((x, y, width, height) => {
          setRootBounds({ x, y, width, height });
        })}
        style={[
          styles.container,
          { backgroundColor: terminal.background },
        ]}>
        {/* The Theme decides this, not the phone: white glyphs over Solarized's
            near-white terminal are a status bar nobody can read. */}
        <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />

        <View
          style={[styles.surfaceArea, { backgroundColor: terminal.background }]}
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
              known, and their resync paints them. Nobody sees it: no Pane is
              painted on it, and an empty Surface shows ghostty's own cursor. */}
          {slots.length === 0 ? (
            <View
              // In the Window's box rather than filling the container, so that the
              // grid it measures is the Window's whatever the keyboard is doing.
              style={[styles.paneBox, styles.unseen, { left: 0, top: -slide, ...windowArea }]}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <TerminalView
                style={styles.surface}
                fontSize={fontSize}
                ligatures={settings.ligatures}
                accessoryBar={false}
                shortcutBar={false}
                theme={{
                  background: terminal.background,
                  foreground: terminal.foreground,
                  cursorColor: terminal.cursor,
                  palette: ansi ? [...ansi] : undefined,
                }}
                onResize={(event) => {
                  say(`the ruler reported ${event.nativeEvent.cols}x${event.nativeEvent.rows}`);
                  reportWindowGrid(event);
                  reportCell({ width: event.nativeEvent.cellWidth, height: event.nativeEvent.cellHeight });
                }}
              />
            </View>
          ) : null}

          <TrackpadScroll
            style={StyleSheet.absoluteFill}
            enabled={canType && screenFocused && !composerOpen && !sheetOpen}
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
                painted={painted.has(slot.pane.id)}
                physicalKeyboard={physicalKeyboard}
                font={fontSize}
                ligatures={settings.ligatures}
                terminal={terminal}
                ansi={ansi}
                onRef={adoptPaneSurface}
                onPaneResize={reportPaneGrid}
                onWindowResize={slot.fillsWindow ? reportWindowGrid : undefined}
                onCell={reportCell}
                onInput={handlePaneInput}
                onScroll={handlePaneScroll}
                swipe={swipe}
                onSelect={(paneId) => attach?.selectPane(paneId)}
                selecting={selecting}
                onSelectionPress={beginSelection}
                onSelectionEnd={endSelection}
                onSelectionEdge={scrollSelection}
                onPaste={pasteFromSurface}
                onKeyboardTap={(focused) => attach?.setKeyboard(focused ? 'up' : 'down')}
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
                Layer's then, which is under this one. Not before the press
                that began it lifts: its finger is this layer's touch, and the
                selection follows it. */}
            {state?.mouseTracking && activeSlot && mouseGrid && (!selecting || mousePressHeld) ? (
              <MouseLayer
                box={activeSlot.box}
                grid={mouseGrid}
                cell={cellSize}
                onTap={handleTapCell}
                onLongPress={(press) => {
                  setMousePressHeld(true);
                  beginSelection(activePaneId, press);
                  // Held from here, so the rows that answer the press find a
                  // finger to follow even before it moves.
                  attach?.view(activePaneId).followSelectionPress(press, false);
                }}
                onPressMove={(point) => attach?.view(activePaneId).followSelectionPress(point, false)}
                onPressEnd={(point) => {
                  setMousePressHeld(false);
                  attach?.view(activePaneId).followSelectionPress(point, true);
                }}
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
                palette={terminal}
              />
              <ScrollBackIndicator
                position={state.scrolled}
                palette={terminal}
                appearance={appearance}
                onPress={jumpToLatest}
              />
            </>
          ) : null}

          {clippedRow > 0 ? (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: clippedRow, backgroundColor: terminal.background }}
            />
          ) : null}

          {/* Last, so it is over the mouse layer and a tap on it is the map's. */}
          {!hidePanesPicker && (state?.topology.panes.length ?? 0) > 1 ? (
            <LayoutMap
              panes={state?.topology.panes ?? []}
              appearance={appearance}
              palette={sheetPalette}
              onPress={openPanes}
            />
          ) : null}

          {/* Under the cover's dim, which takes its touches with the rest. Off
              while a Selection is open, as the back swipe is: a handle can be
              at the edge. */}
          <EdgeGrip
            enabled={open && !selecting && !sheetOpen}
            actions={gripActions}
            titles={composerOpen ? { compose: 'Close composer' } : undefined}
            onFanChange={setFanOpen}
            {...switcher.grip}
            swipe={{ swipe, width: activeSlot?.box.width ?? containerSize.width }}
          />

          {/* The last content, dimmed, and every touch with it: nothing on it
              can be typed into, scrolled or tapped until Typing opens. */}
          {cover.kind === 'content' ? (
            <View
              style={[StyleSheet.absoluteFill, styles.dimmed, { backgroundColor: terminal.background }]}
              testID="cover-dimmed"
              onStartShouldSetResponder={() => true}
            />
          ) : null}
          {cover.kind === 'content' && cover.notice.kind === 'card' ? (
            <View style={[StyleSheet.absoluteFill, styles.cardArea]} pointerEvents="box-none">
              <FailureCard
                failure={cover.notice.failure}
                appearance={appearance}
                palette={chrome}
                onAction={runCoverAction}
              />
            </View>
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

        <TitleSheet {...chooser.sheet} />

        <OptionsSheet isPresented={optionsOpen} items={options} onClose={() => setOptionsOpen(false)} />

        {composerOpen && attach && activePaneId ? (
          <ComposerPanel
            key={`${attach.hostId}:${activePaneId}`}
            composer={attach.composer}
            paneId={activePaneId}
            connected={open}
            palette={chrome}
            appearance={appearance}
            inputRef={composerInput}
            held={composerHeld}
            onHeld={(action) => {
              attach.heldInput(activePaneId, action);
            }}
          />
        ) : null}
        {!physicalKeyboard ? <KeyRow
          key={JSON.stringify([hostId, sessionName, activePaneId])}
          quickActions={quickActions}
          onQuickAction={pickQuickAction}
          armed={armed}
          onArm={armModifier}
          onKey={pressKey}
          onSymbol={pressSymbol}
          onPanes={hidePanesPicker ? undefined : openPanes}
          onKeyboard={toggleKeyboard}
          keyboardVisible={keyboardVisible}
          keysDisabled={!open || composerOpen || sheetOpen || !screenFocused}
          // One Pane is when you reach for Split, so never disabled while keys go through.
          panesDisabled={!open}
          below={clearance.bottom}
        /> : <View style={{ height: clearance.bottom }} pointerEvents="none" />}

        {inputCard && cover.kind !== 'connection-screen' ? (
          <View
            style={[styles.top, { bottom: (physicalKeyboard ? 0 : KEY_ROW_HEIGHT) + clearance.bottom + 8 }]}
            pointerEvents="box-none">
            {inputCard}
          </View>
        ) : null}

        {/* The native Header ends where this content area begins. */}
        <View style={[styles.top, { top: 0 }]} pointerEvents="box-none">
          <Presence shown={cover.kind === 'content' && cover.notice.kind === 'banner'}>
            {cover.kind === 'content' && cover.notice.kind === 'banner' ? (
              <Banner
                title={cover.notice.label}
                leading={{ busy: true }}
                tone="neutral"
                appearance={appearance}
                palette={chrome}
                accessibilityLabel={cover.notice.label}
              />
            ) : null}
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

        <EdgeDrawer {...switcher.drawer} />

        {cover.kind === 'connection-screen' ? (
          <ConnectionScreen
            cover={cover}
            place={missing === null && place.hostName !== '' ? place : null}
            palette={chrome}
            appearance={appearance}
            onAction={runCoverAction}
          />
        ) : null}
      </View>
    </TerminalHeader>
  );
}

/** A Pane's Surface as the screen has it: the Pane view's, with a key to press into it. */
interface ScreenSurface extends PaneSurface {
  /** Presses one key with these modifiers held, as a hardware keyboard does. */
  pressKey(key: string, modifiers: Modifiers): void;
}

/* eslint-enable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization */
/**
 * The `expo-libghostty` view, as the Pane view wants it.
 *
 * One of the seam's two adapters — the other is the recording fake in
 * `pane-view.test.ts` — and the only place in the app that knows the library
 * takes base64. Everything above deals in bytes, because a multi-byte
 * character split across two reads survives byte handling and does not survive
 * text decoding.
 */

function surfaceFor(ref: TerminalViewRef): ScreenSurface {
  return {
    write: (bytes) => void ref.write(bytesToBase64(bytes)),
    focus: () => void ref.focus(),
    blur: () => void ref.blur(),
    isFocused: () => ref.isFocused(),
    showSelection: (rows, press) => void ref.showSelection(rows.rows, rows.top, press),
    endSelection: () => void ref.endSelection(),
    followSelectionPress: (point, lifted) => void ref.followSelectionPress(point.x, point.y, lifted),
    pressKey: (key, modifiers) => void ref.pressKey(key, modifiers),
  };
}

/**
 * Pastes what `read` gives into the active Pane, and says so when it cannot.
 * An empty text pastes nothing. A staged image is let go afterwards.
 */
async function pasteInto(destination: () => Attach | null, read: () => Promise<Paste>): Promise<void> {
  try {
    const content = await read();
    if (content.kind === 'text') {
      if (content.text !== '') await destination()?.paste(content, confirmRunLines);
      return;
    }
    try {
      await destination()?.paste(content, confirmRunLines);
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
 *
 * Until its Pane is painted the Surface is laid out but not seen and not
 * touched: an empty Surface is ghostty's own cursor at 1;1, and a tap on it
 * would raise the keyboard over nothing.
 */
function PaneSurfaceView({
  slot,
  physicalKeyboard,
  painted,
  font,
  ligatures,
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
  selecting,
  onSelectionPress,
  onSelectionEnd,
  onSelectionEdge,
  onPaste,
  onKeyboardTap,
}: {
  slot: PaneSlot;
  physicalKeyboard: boolean;
  /** Whether the Attach has painted this Pane's Surface. */
  painted: boolean;
  font: number;
  ligatures: boolean;
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
  /** A Selection is open on the active Pane. */
  selecting: boolean;
  /** A long press on the Surface, which has no text until it is given some. */
  onSelectionPress: (paneId: string, press: SurfacePoint) => void;
  /** The Selection Layer closed its selection, or found no text to select. */
  onSelectionEnd: () => void;
  /** A handle of the Selection is held at the top or bottom edge. */
  onSelectionEdge: (paneId: string, grid: Grid, direction: 'up' | 'down') => void;
  onPaste: (paneId: string, pasted: TerminalPasteEvent) => void;
  /** A tap on the Surface raised the keyboard (true) or dismissed it (false). */
  onKeyboardTap: (focused: boolean) => void;
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
  /** How far from the screen's left edge it started. See startsAtBackEdge. */
  const fromEdge = useRef(0);
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
    <Animated.View
      style={[styles.paneBox, slot.box, moved, painted ? null : styles.unseen]}
      pointerEvents={painted ? 'auto' : 'none'}
      accessibilityElementsHidden={!painted}
      importantForAccessibility={painted ? 'auto' : 'no-hide-descendants'}>
      <TerminalView
        ref={register}
        style={styles.surface}
        fontSize={font}
        ligatures={ligatures}
        // The library's own bar of ctrl/esc/tab/arrows above the keyboard,
        // and the iPad's undo, redo and Paste bar, both turned off by a local
        // patch. The Key Row stands in their place; see ADR 0003.
        accessoryBar={false}
        shortcutBar={physicalKeyboard}
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
        // A drag right from the edge band is the back swipe's, not a Pane Swipe.
        backEdge={BACK_EDGE}
        // With no other Pane to go to, a sideways drag is a scroll, and does
        // not tick for a swipe that cannot happen.
        swipes={swipe.swipes}
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
        onPaste={({ nativeEvent }) => onPaste(slot.pane.id, nativeEvent)}
        onKeyboardTap={({ nativeEvent }) => onKeyboardTap(nativeEvent.focused)}
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
          // A Selection handle at the seam reaches over this Pane, and a
          // short drag of it read here as a tap that changed Pane.
          pointerEvents={selecting ? 'none' : 'auto'}
          accessibilityRole="button"
          accessibilityLabel={`Pane ${slot.pane.index}`}
          onStartShouldSetResponder={() => true}
          onResponderGrant={({ nativeEvent }: GestureResponderEvent) => {
            from.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
            fromEdge.current = nativeEvent.pageX;
            sideways.current.clear();
            sideways.current.add(nativeEvent.locationX, Date.now());
          }}
          onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
            const dx = nativeEvent.locationX - from.current.x;
            const dy = nativeEvent.locationY - from.current.y;
            sideways.current.add(nativeEvent.locationX, Date.now());
            if (
              Math.hypot(dx, dy) > TAP_SLOP &&
              panAxis(dx, dy) === 'horizontal' &&
              !startsAtBackEdge(fromEdge.current, dx)
            ) {
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
              panAxis(dx, dy) === 'horizontal' && !startsAtBackEdge(fromEdge.current, dx)
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

/** How long a finger stays still to be a long press: the Selection Layer's own 0.35 s. */
const LONG_PRESS_MS = 350;

/** How far a finger held for a long press may drift: the Selection Layer's `allowableMovement`. */
const LONG_PRESS_SLOP = 20;

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
  onPressMove,
  onPressEnd,
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
  /** That finger moved on without lifting: the Selection grows with it. */
  onPressMove: (point: SurfacePoint) => void;
  /** That finger lifted, or the touch was taken away. */
  onPressEnd: (point: SurfacePoint) => void;
  onScroll: (lines: number) => void;
  swipe: PaneSwipe;
}) {
  const size = useRef({ width: 0, height: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const previous = useRef(0);
  /**
   * What the drag is for, or null while the touch could still be a tap. A
   * drag right from the edge band is the back swipe's, and this layer lets it
   * go by.
   */
  const axis = useRef<PanAxis | 'back' | null>(null);
  /** How far from the screen's left edge the finger landed. */
  const originEdge = useRef(0);
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
  /** A long press is down: its release is not a tap, and it ends once. */
  const held = useRef(false);
  /** Where that long press's finger last was. */
  const lastPoint = useRef<SurfacePoint>({ x: 0, y: 0 });
  // Gone with the press still down, the release never comes: end it here.
  const endHeldPress = useEffectEvent(() => {
    if (held.current) onPressEnd(lastPoint.current);
  });
  useEffect(() => () => endHeldPress(), []);
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
        originEdge.current = nativeEvent.pageX;
        previous.current = nativeEvent.locationY;
        axis.current = null;
        carried.current = 0;
        track.current.clear();
        movedAt.current = Date.now();
        track.current.add(nativeEvent.locationY, movedAt.current);
        // The application takes every touch here, so the long press that
        // the Surface would see is timed here. It starts where the finger is
        // when it fires, as the Surface's does, not where it landed.
        lastPoint.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
        held.current = false;
        stopHolding();
        holding.current = setTimeout(() => {
          holding.current = null;
          held.current = true;
          onLongPress(lastPoint.current);
        }, LONG_PRESS_MS);
      }}
      onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
        if (axis.current === null) {
          lastPoint.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
          const dx = nativeEvent.locationX - origin.current.x;
          const dy = nativeEvent.locationY - origin.current.y;
          // A drag starts only past the long press's slop, as on the
          // Surface: a finger held to select drifts.
          if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) {
            const way = panAxis(dx, dy);
            if (way !== 'horizontal') {
              axis.current = way;
            } else if (startsAtBackEdge(originEdge.current, dx)) {
              axis.current = 'back';
            } else {
              // With no other Pane to go to, a sideways drag is the wheel, as
              // on the Surface.
              axis.current = swipe.swipes ? 'horizontal' : 'vertical';
            }
          }
          if (axis.current !== null) stopHolding();
          if (axis.current === 'horizontal') {
            swipeFrom.current = nativeEvent.locationX;
            sideways.current.clear();
          }
        }
        if (held.current) {
          lastPoint.current = { x: nativeEvent.locationX, y: nativeEvent.locationY };
          onPressMove(lastPoint.current);
          return;
        }
        // Still a press: the program gets no wheel yet. The drift is spent
        // once the drag turns out to be a scroll.
        if (axis.current === null || axis.current === 'back') return;
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

        spend(nativeEvent.locationY - previous.current);
        previous.current = nativeEvent.locationY;
      }}
      onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
        const { width, height } = size.current;
        stopHolding();
        if (held.current) {
          held.current = false;
          onPressEnd({ x: nativeEvent.locationX, y: nativeEvent.locationY });
          return;
        }
        if (axis.current === 'back') return;
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
        // A finger that drifted inside the press's slop and lifted early is
        // neither a drag nor a tap.
        const dx = nativeEvent.locationX - origin.current.x;
        const dy = nativeEvent.locationY - origin.current.y;
        if (Math.hypot(dx, dy) > TAP_SLOP) return;
        onTap(
          cellOf(nativeEvent.locationX, cell?.width, width, grid.cols),
          cellOf(nativeEvent.locationY, cell?.height, height, grid.rows),
        );
      }}
      onResponderTerminate={() => {
        stopCoasting();
        stopHolding();
        if (held.current) {
          held.current = false;
          onPressEnd(lastPoint.current);
        }
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
 * Why the Attach stopped, over its last content: a card, because a Banner has
 * no room for three buttons. Its first action is the one it asks for.
 */
function FailureCard({
  failure,
  appearance,
  palette,
  onAction,
}: {
  failure: Extract<Extract<Cover, { kind: 'content' }>['notice'], { kind: 'card' }>['failure'];
  appearance: 'light' | 'dark';
  palette: Appearance;
  onAction: (action: CoverAction) => void;
}) {
  return (
    <Banner
      title={failure.title}
      body={failure.reason ?? undefined}
      leading={{
        symbol: failure.stop === 'transport-lost'
          ? 'wifi.slash'
          : failure.stop === 'key-changed'
            ? 'exclamationmark.shield.fill'
            : 'exclamationmark.triangle.fill',
      }}
      tone="warning"
      actions={failure.actions.map((action, index) => ({
        id: action,
        label: actionLabel(action),
        onPress: () => onAction(action),
        prominent: index === 0 ? undefined : false,
        testID: action,
      }))}
      appearance={appearance}
      palette={palette}
      accessibilityLabel={failure.title}
      testID="cover-card"
    />
  );
}

const PANE_ACTIONS: SheetAction[] = [
  { id: 'split-right', label: 'Split →' },
  { id: 'split-down', label: 'Split ↓' },
];

const NOTHING_PAINTED: ReadonlySet<string> = new Set();

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
  /** Laid out and measuring, but not seen, not touched and not read out. */
  unseen: {
    opacity: 0,
  },
  /** The last content at about 40%: the terminal's own background over it. */
  dimmed: {
    opacity: 0.6,
  },
  cardArea: {
    justifyContent: 'center',
    paddingHorizontal: 16,
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
