import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Presence } from '@/components/banner';
import { ReconnectScreen } from '@/components/reconnect-screen';
import { Dock, type DockCapsule } from '@/components/dock';
import { KeyBar } from '@/components/key-bar';
import { ComposerPanel } from '@/composer/composer-panel';
import type { ComposerInputRef } from '@/composer/native-input';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { paletteFor, type Appearance, type TerminalPalette } from '@/constants/app-theme';
import { barKeyName, BAR_KEYS, type BarKey } from '@/constants/bar-keys';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';
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
import { applyModifiers, NO_MODIFIERS, type Modifiers } from '@/lib/modifier-keys';
import { toShellInput } from '@/lib/terminal-input';
import type { AttachPhase, AttachState } from '@/tmux/attach';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { phaseLabel } from '@/tmux/attach-labels';
import { retryCouldWork } from '@/tmux/disconnect-reason';
import { cellOf, paneBoxes, windowSlide, type Extent, type PaneBox } from '@/tmux/pane-layout';
import type { PaneSurface } from '@/tmux/pane-view';
import { paneTopologyFrames } from '@/tmux/pane-topology';
import { trimPreview, windowPreviewTarget } from '@/tmux/preview';
import type { Grid, Pane } from '@/tmux/tmux-client';

/** What the Surface uses when the user has not picked a size. */
const DEFAULT_FONT_SIZE = 13;

/**
 * The screen's own voice in the Log.
 *
 * What it says is what the Attach cannot know: which Surfaces are on screen
 * and where, what the Dock was asked for and whether there was a Pane to ask
 * it of, when the keyboard moved. A Pane that went blank is described from
 * both sides — the Attach's line says what it was told, and this one says
 * what was drawn.
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
};

/** What a picker is picking. One sheet serves all three. */
type PickerKind = 'sessions' | 'windows' | 'panes';

/** The sheet: closed, or open and showing whatever it has so far. */
type PickerState =
  | { open: false }
  | {
      open: true;
      kind: PickerKind;
      loading: boolean;
      cards: PreviewCard[];
      error?: string;
    };

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
  const {
    hostId,
    session: sessionParam,
    topicId,
    reconnect,
  } = useLocalSearchParams<{
    hostId?: string;
    session?: string;
    /** The Topic Screen the Session was opened from, for the Last Place. */
    topicId?: string;
    /** Set by a cold start that reopens the Last Place: look first, then attach. */
    reconnect?: string;
  }>();
  // The screen draws its own chrome: no navigation header, so the Surface
  // background runs to the top of the display and only the inset keeps text
  // clear of the status bar. Going Home is the Dock's job, not a back button's.
  const insets = useSafeAreaInsets();
  const { settings, terminal, ansi, appearance } = useSettings();

  const holder = useAttachHolder();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
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

  // Home is the Host Screen of the Host this Session is on, where the next
  // Session is a tap away; Back from there is the Hosts list. With no Host in
  // the route there is no Host Screen to go to. The Session stays attached —
  // this is navigation and nothing else.
  const goHome = useCallback(
    () =>
      hostId
        ? router.dismissTo({ pathname: '/hosts/[id]', params: { id: hostId } })
        : router.dismissTo('/'),
    [router, hostId],
  );

  /**
   * Asks the root for the Session this route names, if it is not already up.
   *
   * The only life-cycle act left in this file, and it is a request rather than
   * a start: the holder decides whether anything happens, and tapping the row
   * of a Session that is already attached happens to mean nothing at all.
   */
  useEffect(() => {
    say(`opened for ${hostId ?? '?'}:${sessionParam ?? '?'}`);
    if (!hostId || !sessionParam) {
      say('no Host or Session in the route');
      setMissing('No Host was chosen.');
      return;
    }
    let left = false;
    void (async () => {
      const store = deviceHostStore();
      const records = await store.load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (left) return;
      if (!host) {
        say('the Host in the route is no longer saved');
        setMissing('This Host is no longer saved.');
        return;
      }
      setMissing(null);
      const request = {
        host,
        sessionName: sessionParam,
        topicId: topicId ?? null,
        zoomed: settings.zoomMultipaneWindows,
      };
      if (!reconnect) {
        await holder.open(request);
        return;
      }
      setReconnectHost(host.displayName);
      await reconnectToSession({
        session: sessionParam,
        visit: sessionVisit(host),
        attach: async () => {
          if (left) return;
          const opened = await holder.open(request);
          // Try again after a failed Attach: the holder hands back the same
          // Attach, still disconnected, so it is asked for another go.
          if (opened.state().phase.kind === 'disconnected') opened.reconnect();
        },
        progress: (next) => {
          if (!left) setLookup(next);
        },
      });
    })();
    return () => {
      left = true;
      say('left');
    };
    // The Zoom preference is what the Session is *opened* with; changing it in
    // Settings must not reopen a Session that is already up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holder, hostId, sessionParam, reconnectAttempt]);

  /** The Surface area's size in points, which every Pane is placed inside. */
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  /** Scroll distance not yet worth a notch of the wheel. */
  const carriedLines = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const composerInput = useRef<ComposerInputRef | null>(null);
  const composerUp = useRef(false);
  composerUp.current = composerOpen;
  /**
   * The same, readable from a layout callback. The container is measured in
   * one and whether to believe the measurement depends on the other, and a
   * state value read inside `onLayout` is the one from the render that
   * attached the callback.
   */
  const keyboardUp = useRef(false);
  /**
   * The sticky modifiers the Key Bar is holding down.
   *
   * A phone keyboard cannot hold a key while another is pressed, so ctrl is
   * armed by a tap and spent on whatever comes next — from the bar or from the
   * system keyboard. See modifier-keys.
   */
  const [armed, setArmed] = useState<Modifiers>(NO_MODIFIERS);
  /** The same, where the Surface's input callback can read it without rebuilding. */
  const armedRef = useRef<Modifiers>(NO_MODIFIERS);
  armedRef.current = armed;
  const [picker, setPicker] = useState<PickerState>({ open: false });

  /**
   * The Theme and font size this Session was opened with.
   *
   * Frozen on arrival rather than followed: changing the font under a live
   * Surface would reflow the grid, which means a resize, which means tmux
   * redrawing mid-session. Settings apply from the next Attach, a step away.
   */
  const [opened] = useState(() => ({ font: settings.fontSize, terminal, ansi }));

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

  /**
   * The Window's height in points: the container's, measured with the keyboard
   * down and kept while it is up.
   *
   * The keyboard does not resize the Window — see ADR 0008. It used to: the
   * Dock lifts, the container shrinks, the Surface reports a smaller grid and
   * the Host is told to reflow the Window to it, and back again on the way
   * down. Every keyboard toggle was a remote resize, and a resize is where a
   * terminal's text moves — up into the Scrollback on the way down, and back
   * only as far as the Scrollback reaches on the way up, which after a `clear`
   * is not at all. So the Window keeps this height whatever the keyboard does,
   * the container clips it, and what the keyboard covers is slid out of the way
   * instead; see windowSlide.
   *
   * Not recorded while the keyboard is up, because that measurement is of the
   * strip above the keys and not of the Window. A rotation with the keyboard
   * up is therefore a frame or two of the wrong height, corrected when it goes
   * down; it is the one moment that gets nothing better here.
   */
  const [windowHeight, setWindowHeight] = useState(0);
  const windowArea = useMemo(
    (): Extent => ({ width: containerSize.width, height: windowHeight || containerSize.height }),
    [containerSize, windowHeight],
  );

  /**
   * How far up the Window is slid so the row being typed on clears the keys.
   *
   * The cursor is the active Pane's, and a Pane in a split does not start at
   * the Window's top — so its row is offset by where the Layout puts it. A
   * zoomed Pane is drawn at the top whatever the Layout says its place is,
   * because the Layout describes the arrangement zoom is hiding.
   */
  const spansWindow =
    (topology?.activeWindow?.zoomed ?? true) || (topology?.panes.length ?? 0) <= 1;
  const cursorRow =
    state?.cursorRow == null
      ? null
      : state.cursorRow + (spansWindow ? 0 : (topology?.activePane?.top ?? 0));
  const slide = windowSlide(containerSize.height, windowArea.height, cellSize, cursorRow);

  // Told from here rather than from the layout event, because the Window's
  // area is not the container's: it is what the Panes are laid out in, and it
  // is what a Client's size is worked out from.
  useEffect(() => {
    if (windowArea.width > 0 && windowArea.height > 0) attach?.containerLaidOut(windowArea);
  }, [attach, windowArea]);

  /**
   * Which Panes are on screen, and where.
   *
   * Zoomed — or with nothing to split — that is one Surface filling the
   * Window's area, which is the shape this app has had all along. Otherwise it
   * is every Pane at the rectangle the Layout gives it, on one cell metric. See
   * paneBoxes, and ADR 0006 for why this is possible at all. All of them sit
   * `slide` points higher than the area they are laid out in, which is how the
   * keyboard is kept off the row being typed on.
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
      return [
        {
          pane: active,
          box: { left: 0, top: -slide, width: windowArea.width, height: windowArea.height },
          rows: visibleGrid?.rows ?? active.height,
          fillsWindow: true,
        },
      ];
    }

    const boxes = paneBoxes(panes, windowArea);
    return panes.flatMap((pane) => {
      const box = boxes.get(pane.id);
      if (!box) return [];
      const placed = { ...box, top: box.top - slide };
      return [{ pane, box: placed, rows: pane.height, fillsWindow: false }];
    });
  }, [topology, spansWindow, windowArea, slide, visibleGrid]);

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
  const sheetOpen = picker.open;
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

  /** The Pane the mouse layer belongs to, and only its rectangle. */
  const activeSlot = slots.find((slot) => slot.pane.id === activePaneId);
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

  const reportPaneGrid = useCallback(
    (paneId: string, grid: Grid) => attach?.paneGridReported(paneId, grid),
    [attach],
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
      const typed = toShellInput(base64ToBytes(data));

      // Whatever the Key Bar is holding down applies to the first key of this
      // and nothing after it, so ctrl and then `r` is one `C-r` with the rest
      // of a fast typist's burst behind it as ordinary input.
      const { key, rest } = applyModifiers(typed, armedRef.current);
      if (key !== undefined) {
        view.press(key);
        setArmed(NO_MODIFIERS);
      }
      if (rest.length > 0) view.type(rest);
    },
    [attach],
  );

  /**
   * Shows or hides the system keyboard, on the Surface that actually has it.
   *
   * The question goes to the Surface rather than to a global listener: React
   * Native's registry never heard of this view, so `Keyboard.dismiss()` was a
   * no-op and there was no way at all to raise the keyboard again. The
   * listener below only decides which way the Dock's button points.
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

  /**
   * What a picker would show, from the model that is already right.
   *
   * No round trip for the rows: tmux has been pushing changes all along, so a
   * Windows or Panes sheet opens on a Topology that is current, and a Sessions
   * sheet on a list kept by `%sessions-changed`. Previews are the exception —
   * a picture of a Pane is only worth anything if it is of now — and they fill
   * in behind an already-open sheet.
   */
  const cardsFor = useCallback(
    (kind: PickerKind): PreviewCard[] => {
      if (!state) return [];
      if (kind === 'sessions') {
        return (state.sessions ?? []).map((session) => ({
          id: session.name,
          title: session.name,
          // The name, even though `title` already holds it. A preview card
          // draws its badge and its detail and nothing else — `title` is what
          // the card is announced as, not what it is labelled with — so a
          // Session, which has no badge, would be identified by nothing at all
          // without this.
          detail: `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
          current: session.name === state.sessionName,
          preview: previewOf(state.previews, `${session.name}:`),
        }));
      }

      if (kind === 'windows') {
        return state.topology.windows.map((window) => ({
          id: String(window.index),
          title: window.name,
          detail: `${window.command} · ${window.paneCount} ${plural(window.paneCount, 'pane')}`,
          current: window.active,
          badge: String(window.index),
          preview: previewOf(state.previews, windowPreviewTarget(state.sessionName, window.index)),
        }));
      }

      // No capture here: the Panes are all on screen behind this sheet already,
      // so the question is which one you mean, not what is in it. Where it
      // sits, what directory it is in and what it is running are what tell two
      // Panes apart; a tile of six-point terminal text does not.
      const frames = paneTopologyFrames(state.topology.panes);
      return state.topology.panes.map((pane) => ({
        id: String(pane.index),
        title: directoryName(pane.path) || `Pane ${pane.index}`,
        detail: pane.command,
        current: pane.active,
        frame: frames.get(pane.index),
        preview: [],
      }));
    },
    [state],
  );

  /**
   * Corrects an already-open sheet behind itself.
   *
   * Two things a notification cannot carry. **Previews** are screen content,
   * and a picture of a Pane is worth nothing unless it is of now. And **what a
   * Pane is running** — `#{pane_current_command}`, `#{pane_current_path}` —
   * changes with no notification at all: nothing is pushed when a shell starts
   * `vim`, so the Windows sheet's detail line and the Panes sheet's title would
   * otherwise freeze at the last time the Topology changed shape.
   *
   * It is why the rows are drawn from the model *first*. The sheet is never
   * waiting on this — it opens filled and corrects itself a round trip later.
   */
  const refreshBehindSheet = useCallback(
    (kind: PickerKind) => {
      if (!attach || !state) return;
      if (kind !== 'sessions') attach.refreshTopology();
      if (kind === 'panes') return;
      attach.capturePreviews(
        kind === 'sessions'
          ? (state.sessions ?? []).map((session) => `${session.name}:`)
          : state.topology.windows.map((window) =>
              windowPreviewTarget(state.sessionName, window.index),
            ),
      );
    },
    [attach, state],
  );

  /**
   * Opens a picker on a model that is already right.
   *
   * There is nothing to wait for and nothing to warm: the rows come from the
   * Topology tmux has been pushing, so the sheet is drawn filled. What the Host
   * is asked for — previews, and what each Pane is running — lands behind it
   * and corrects the sheet in place. See refreshBehindSheet.
   */
  const openPicker = useCallback(
    (kind: PickerKind) => {
      say(`${kind} sheet opened`);
      setPicker({
        open: true,
        kind,
        // Only a Session list that has never been read has nothing to draw.
        loading: kind === 'sessions' && (state?.sessions ?? null) === null,
        cards: cardsFor(kind),
      });
      refreshBehindSheet(kind);
    },
    [cardsFor, refreshBehindSheet, state],
  );

  // The sheet follows the model while it is open, so a Window split from the
  // laptop appears in it without it being closed and opened again.
  const openKind = picker.open ? picker.kind : null;
  useEffect(() => {
    if (openKind === null) return;
    const cards = cardsFor(openKind);
    setPicker((previous) => (previous.open ? { ...previous, loading: false, cards } : previous));
  }, [cardsFor, openKind]);

  /**
   * Leaves the sheet up, saying why. Closing it on a failure would leave the
   * user looking at the Session they tried to leave with no idea what happened.
   */
  const showPickerError = useCallback((error: unknown) => {
    setPicker((previous) => (previous.open ? { ...previous, error: describeError(error) } : previous));
  }, []);

  /**
   * Acts on a picked row.
   *
   * The sheet closes on success and stays up on failure; see showPickerError.
   * What each verb *does* afterwards — re-apply Zoom, re-read the Topology,
   * re-size, stamp the Recent Session — is the Attach's, so none of it is here.
   */
  const select = useCallback(
    (kind: PickerKind, id: string) => {
      say(`picked ${kind} ${id}`);
      if (!attach || !state) return;
      void (async () => {
        try {
          if (kind === 'sessions') {
            if (id === state.sessionName) {
              setPicker({ open: false });
              return;
            }
            await attach.switchSession(id);
          } else if (kind === 'windows') {
            await attach.selectWindow(Number(id));
          } else {
            const pane = state.topology.panes.find((each) => each.index === Number(id));
            if (!pane) return;
            attach.selectPane(pane.id);
          }
          setPicker({ open: false });
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [attach, state, showPickerError],
  );

  /** Zoom, split and new-Window: the sheet's bottom bar. */
  const runSheetAction = useCallback(
    (id: string) => {
      say(`sheet action ${id}`);
      if (!attach) return;
      void (async () => {
        try {
          if (id === 'new-window') await attach.newWindow();
          else if (id === 'split-right') await attach.split('right');
          else if (id === 'split-down') await attach.split('down');
          setPicker({ open: false });
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [attach, showPickerError],
  );

  /**
   * The quiet overlay text, in the Theme's own dim tone.
   *
   * It sits directly on the Surface, so a fixed colour is right for exactly one
   * Theme and unreadable in another — Solarized's terminal is nearly white.
   */
  const dimText = useMemo(() => ({ color: opened.terminal.dim }), [opened.terminal.dim]);

  /** The Theme's chrome colours: the Key Bar's labels, and the Dock's badges. */
  const chrome = useMemo(() => paletteFor(settings.theme), [settings.theme]);

  /**
   * A key from the Key Bar, into the Pane that has the keyboard.
   *
   * Carries whatever is armed with it, so ctrl and then the left arrow is
   * `C-Left` — one key, named, for tmux to encode. The modifiers are spent
   * either way: a key that cannot take them still clears them, or ctrl tapped
   * by mistake would stay on until something happened to use it.
   */
  const pressBarKey = useCallback(
    (key: BarKey) => {
      activeView()?.press(barKeyName(key, armed));
      setArmed(NO_MODIFIERS);
    },
    [activeView, armed],
  );

  /** ctrl or alt tapped: on if it was off, and off if it was on. */
  const armModifier = useCallback((modifier: 'ctrl' | 'alt') => {
    setArmed((previous) => ({ ...previous, [modifier]: !previous[modifier] }));
  }, []);

  /**
   * The Dock's capsules, left to right.
   *
   * Three, because there are three kinds of thing: the things the Session is
   * made of, the keys the phone's keyboard does not have, and the way out. One
   * long row said none of that.
   *
   * The pickers lead because they are what a hand reaches for most; the Key
   * Bar takes the middle because it is the one that grows into whatever width
   * is left; and Home sits at the far end from the arrows, because a Home
   * pressed by a thumb aiming for an arrow is a Session left by accident.
   */
  const dockCapsules: DockCapsule[] = useMemo(() => {
    return [
      {
        id: 'topology',
        actions: [
          {
            id: 'sessions',
            label: 'Sessions',
            systemImage: 'square.on.square',
            onPress: () => openPicker('sessions'),
            disabled: !connected,
            // What is behind the button, not what is in front of it: the Host's
            // Sessions, this one included. Read once on connecting and kept up
            // to date by `%sessions-changed`, so it is current without the
            // sheet ever having been opened.
            count: state?.sessions?.length ?? 0,
          },
          {
            id: 'windows',
            label: 'Windows',
            systemImage: 'macwindow',
            // Never disabled while connected: the sheet is not only a picker,
            // it is the only way to make a Window, and a Session with one Window
            // is exactly when that is wanted.
            disabled: !connected,
            onPress: () => openPicker('windows'),
            count: topology?.windows.length ?? 0,
          },
          {
            id: 'panes',
            label: 'Panes',
            systemImage: 'rectangle.split.2x1',
            // Same: one Pane is when you reach for Split.
            disabled: !connected,
            onPress: () => openPicker('panes'),
            // The Panes of the Window on screen, which is what the sheet shows
            // — not every Pane in the Session.
            count: topology?.panes.length ?? 0,
          },
        ],
      },
      {
        id: 'keys',
        content: (
          <KeyBar
            keys={BAR_KEYS}
            armed={armed}
            onPress={pressBarKey}
            onArm={armModifier}
            disabled={!connected || composerOpen}
            palette={chrome}
          />
        ),
      },
      {
        id: 'exit',
        actions: [
          {
            id: 'home',
            label: 'Home',
            systemImage: 'house',
            onPress: goHome,
          },
          {
            id: 'compose',
            label: composerOpen ? 'Close composer' : 'Compose',
            systemImage: 'square.and.pencil',
            // Lit in the accent while the Composer is up, the way the Key Bar
            // shows a held modifier, rather than swapping to a filled disc that
            // sat in the row like a different kind of button.
            active: composerOpen,
            onPress: toggleComposer,
            disabled: !activePaneId,
          },
          {
            id: 'keyboard',
            label: 'Keyboard',
            systemImage: keyboardVisible ? 'keyboard.chevron.compact.down' : 'keyboard',
            onPress: toggleKeyboard,
          },
        ],
      },
    ];
  }, [
    router,
    toggleKeyboard,
    toggleComposer,
    composerOpen,
    activePaneId,
    keyboardVisible,
    openPicker,
    connected,
    state?.sessions,
    topology,
    armed,
    pressBarKey,
    armModifier,
    chrome,
  ]);

  useEffect(() => {
    // For the Dock, so it can show which way its keyboard button points, and
    // for the Window's height, which is only measured while the keyboard is
    // down. `Will` rather than `Did`: the Dock lifts on `keyboardWillChangeFrame`
    // and the container is laid out again in the same pass, so a flag set on
    // `keyboardDidShow` would arrive after the measurement it is meant to veto.
    // The action itself goes to the Surface that has focus, which no listener
    // can see — see toggleKeyboard.
    const shown = Keyboard.addListener('keyboardWillShow', () => {
      say('keyboard will show');
      keyboardUp.current = true;
      setKeyboardVisible(true);
    });
    const hidden = Keyboard.addListener('keyboardWillHide', () => {
      say('keyboard will hide');
      keyboardUp.current = false;
      setKeyboardVisible(false);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

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
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: opened.terminal.background },
      ]}>
      {/* The Theme decides this, not the phone: white glyphs over Solarized's
          near-white terminal are a status bar nobody can read. */}
      <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />

      <View
        style={[styles.surfaceArea, { backgroundColor: opened.terminal.background }]}
        onLayout={({ nativeEvent }) => {
          const size = { width: nativeEvent.layout.width, height: nativeEvent.layout.height };
          say(
            `container ${Math.round(size.width)}x${Math.round(size.height)}` +
              (keyboardUp.current ? ', keyboard up' : ''),
          );
          setContainerSize(size);
          // The Window's height is the container's with the keyboard down, and
          // only then; see windowHeight.
          if (!keyboardUp.current && !composerUp.current) setWindowHeight(size.height);
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
            fontSize={opened.font ?? DEFAULT_FONT_SIZE}
            accessoryBar={false}
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

        {slots.map((slot) => (
          <PaneSurfaceView
            key={slot.pane.id}
            slot={slot}
            font={opened.font ?? DEFAULT_FONT_SIZE}
            terminal={opened.terminal}
            ansi={opened.ansi}
            onRef={adoptPaneSurface}
            onPaneResize={reportPaneGrid}
            onWindowResize={slot.fillsWindow ? reportWindowGrid : undefined}
            onCell={reportCell}
            onInput={handlePaneInput}
            onScroll={handlePaneScroll}
            onSelect={(paneId) => attach?.selectPane(paneId)}
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
        {state?.mouseTracking && activeSlot && mouseGrid ? (
          <MouseLayer
            box={activeSlot.box}
            grid={mouseGrid}
            cell={cellSize}
            onTap={handleTapCell}
            onScroll={(lines) => handleScrollLines(lines, mouseGrid)}
          />
        ) : null}

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
              onPress={jumpToLatest}
            />
          </>
        ) : null}
      </View>

      <PickerSheet
        title={picker.open ? PICKER_TITLES[picker.kind] : ''}
        isPresented={picker.open}
        onDismiss={() => {
          say('sheet dismissed');
          setPicker({ open: false });
        }}
        loading={picker.open && picker.loading}
        error={picker.open ? picker.error : undefined}
        emptyMessage={picker.open ? PICKER_EMPTY[picker.kind] : ''}
        cards={picker.open ? picker.cards : []}
        layout={picker.open ? PICKER_LAYOUTS[picker.kind] : 'list'}
        onSelect={(id) => {
          if (picker.open) select(picker.kind, id);
        }}
        actions={picker.open ? PICKER_ACTIONS[picker.kind] : undefined}
        onAction={runSheetAction}
        zoom={
          // Offered whatever the Pane count. With one Pane there is nothing to
          // zoom out of yet, but the switch is the setting rather than the act
          // — it says what the next split should do, and a switch that appears
          // only once you have split is one you have to find twice.
          picker.open && picker.kind === 'panes' && state
            ? { on: state.zoomed, onChange: (on: boolean) => attach?.setZoom(on) }
            : undefined
        }
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
      <Dock capsules={dockCapsules} palette={chrome} />

      {/* Everything the screen has to say sits under the status bar, the way iOS
          delivers a notification: the Banners first, then the quiet overlay
          lines beneath them. Below the bar, not behind it: the container's
          padding does not push an absolutely positioned child down, so the grid
          used to end up underneath the battery. */}
      <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
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
          {/* The Status Lines. With the setting on, `connection-status` is
              always rendered, so its value can be asserted rather than its
              absence. `surface-grid` appears only once the Surface has reported
              a grid, so its presence is the signal that layout and `onResize`
              completed; the value is device-specific, so select on the id. */}
          {settings.showStatusLines ? (
            <>
              <ThemedText type="code" style={dimText} testID="connection-status">
                {status.label}
              </ThemedText>
              {visibleGrid ? (
                <ThemedText type="code" style={dimText} testID="surface-grid">
                  {visibleGrid.cols}x{visibleGrid.rows}
                </ThemedText>
              ) : null}
              {state?.sessionName ? (
                <ThemedText type="code" style={dimText} testID="attached-session">
                  {state.sessionName}
                </ThemedText>
              ) : null}
            </>
          ) : null}
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
          session={sessionParam ?? ''}
          progress={reconnecting}
          palette={chrome}
          onTryAgain={tryReconnectAgain}
          onGoHome={goHome}
        />
      ) : null}
      {/* The reconnect stops at a changed key, so its warning sits above it. */}
      {reconnectShown ? (
        <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
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
  };
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
  onSelect,
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
  onSelect: (paneId: string) => void;
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

  return (
    <View style={[styles.paneBox, slot.box]}>
      <TerminalView
        ref={register}
        style={styles.surface}
        fontSize={font}
        // The library's own bar of ctrl/esc/tab/arrows above the keyboard,
        // turned off by a local patch. It was the reason ADR 0003 ruled out
        // a modifier group in the Dock, so that decision is now open again —
        // with the bar gone there are no modifier keys at all.
        accessoryBar={false}
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
        // exist here. Needs the local patch.
        ownsScrollGesture
        onScroll={({ nativeEvent }) =>
          onScroll(slot.pane.id, own.current, slot.box.height, nativeEvent.points)
        }
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
          }}
          // A tap, not a drag. Without the slop a finger that started on the
          // other Pane on its way somewhere moved the keyboard with it.
          onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
            const start = from.current;
            const travelled = Math.hypot(
              nativeEvent.locationX - start.x,
              nativeEvent.locationY - start.y,
            );
            if (travelled <= TAP_SLOP) onSelect(slot.pane.id);
          }}
        />
      ) : null}
    </View>
  );
}

/** How far a finger may travel and still be a tap rather than a drag, in points. */
const TAP_SLOP = 10;

/** What the Jump to latest pill claims beyond its own edges, to reach 44pt. */
const PILL_SLOP = { top: 8, bottom: 8, left: 12, right: 12 };

/**
 * The finger, while an application in the Pane is listening for the mouse.
 *
 * It covers the Surface and takes every touch: a tap becomes a click at the
 * cell underneath, and a drag becomes wheel notches — which is what the
 * application would get from any terminal, and what makes Claude Code's "Jump
 * to bottom", vim's status line or a file in a picker tappable at all.
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
 * raised from the Dock — which is what that button is for. The moment nothing
 * is listening this layer is gone and the Surface behaves exactly as it did.
 */
function MouseLayer({
  box,
  grid,
  cell,
  onTap,
  onScroll,
}: {
  box: PaneBox;
  grid: Grid;
  /** How big a cell is, or null before a Surface has said. See cellOf. */
  cell: Extent | null;
  onTap: (column: number, row: number) => void;
  onScroll: (lines: number) => void;
}) {
  const size = useRef({ width: 0, height: 0 });
  const origin = useRef(0);
  const previous = useRef(0);
  const dragged = useRef(false);
  /** Fractions of a line a slow drag has not yet spent. */
  const carried = useRef(0);
  /** Where the finger has been lately, which is what a flick is worth. */
  const track = useRef(createVelocityTracker());
  /** When it last moved, so a finger that stopped before lifting throws nothing. */
  const movedAt = useRef(0);
  /** The frame loop a flick is coasting on, so a new touch can stop it. */
  const coasting = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

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
        origin.current = nativeEvent.locationY;
        previous.current = nativeEvent.locationY;
        dragged.current = false;
        carried.current = 0;
        track.current.clear();
        movedAt.current = Date.now();
        track.current.add(nativeEvent.locationY, movedAt.current);
      }}
      onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
        const travelled = nativeEvent.locationY - previous.current;
        previous.current = nativeEvent.locationY;
        if (Math.abs(nativeEvent.locationY - origin.current) > TAP_SLOP) dragged.current = true;

        // The last moment of the drag rather than the whole of it: what a
        // flick is worth is how fast the finger was going when it left, not
        // how fast it went on the way there.
        movedAt.current = Date.now();
        track.current.add(nativeEvent.locationY, movedAt.current);

        spend(travelled);
      }}
      onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
        const { width, height } = size.current;
        if (dragged.current) {
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
      onResponderTerminate={() => stopCoasting()}
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
  onPress,
}: {
  position: { back: number; scrollbackLines: number };
  palette: TerminalPalette;
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
      // points. iOS asks for forty-four, and a thumb reaching past the Dock
      // for it is not aiming carefully. The slop costs nothing: there is
      // nothing else down there to press.
      hitSlop={PILL_SLOP}
      // Inverted against the Theme rather than painted a fixed light: the pill
      // has to read over whatever the Session is painting behind it, and a
      // light pill with light text is what a fixed one gave on Solarized.
      style={[styles.scrollPill, { backgroundColor: palette.foreground }]}
      testID="scroll-position">
      <ThemedText type="code" style={[styles.scrollPillText, { color: palette.background }]}>
        {atOldest ? `oldest of ${position.scrollbackLines} lines` : `${position.back} lines back`}
      </ThemedText>
      <ThemedText type="code" style={[styles.scrollPillAction, { color: palette.background }]}>
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

const PICKER_TITLES: Record<PickerKind, string> = {
  sessions: 'Sessions',
  windows: 'Windows',
  panes: 'Panes',
};

const PICKER_EMPTY: Record<PickerKind, string> = {
  sessions: 'No Sessions on this Host',
  windows: 'No Windows in this Session',
  panes: 'No Panes in this Window',
};

const PICKER_LAYOUTS: Record<PickerKind, 'grid' | 'panes' | 'list'> = {
  sessions: 'list',
  windows: 'grid',
  panes: 'panes',
};

const PICKER_ACTIONS: Record<PickerKind, SheetAction[]> = {
  sessions: [],
  windows: [{ id: 'new-window', label: 'New Window', systemImage: 'plus' }],
  panes: [
    { id: 'split-right', label: 'Split →' },
    { id: 'split-down', label: 'Split ↓' },
  ],
};

/** How many captured lines a preview box can show before it is just noise. */
const PREVIEW_LINES = 14;
const PREVIEW_COLUMNS = 46;

function previewOf(previews: Map<string, string[]>, target: string): string[] {
  return trimPreview(previews.get(target) ?? [], PREVIEW_LINES, PREVIEW_COLUMNS);
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
    // is past either edge is clipped rather than drawn under the glass Dock.
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
    // Inset from the sides as far as the Dock is from the bottom.
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
