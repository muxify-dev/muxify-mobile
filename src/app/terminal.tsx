import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock, type DockAction } from '@/components/dock';
import { KeyBar } from '@/components/key-bar';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { paletteFor, type TerminalPalette } from '@/constants/app-theme';
import { barKeyName, BAR_KEYS, type BarKey } from '@/constants/bar-keys';
import { useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
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
import { paneBoxes, type PaneBox } from '@/tmux/pane-layout';
import type { PaneSurface } from '@/tmux/pane-view';
import { paneTopologyFrames } from '@/tmux/pane-topology';
import { trimPreview, windowPreviewTarget } from '@/tmux/preview';
import type { Grid, Pane } from '@/tmux/tmux-client';

/** What the Surface uses when the user has not picked a size. */
const DEFAULT_FONT_SIZE = 13;

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
  const { hostId, session: sessionParam } = useLocalSearchParams<{
    hostId?: string;
    session?: string;
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

  /**
   * Asks the root for the Session this route names, if it is not already up.
   *
   * The only life-cycle act left in this file, and it is a request rather than
   * a start: the holder decides whether anything happens, and tapping the row
   * of a Session that is already attached happens to mean nothing at all.
   */
  useEffect(() => {
    if (!hostId || !sessionParam) {
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
        setMissing('This Host is no longer saved.');
        return;
      }
      setMissing(null);
      await holder.open({ host, sessionName: sessionParam, zoomed: settings.zoomMultipaneWindows });
    })();
    return () => {
      left = true;
    };
    // The Zoom preference is what the Session is *opened* with; changing it in
    // Settings must not reopen a Session that is already up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holder, hostId, sessionParam]);

  /** The Surface area's size in points, which every Pane is placed inside. */
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  /** Scroll distance not yet worth a notch of the wheel. */
  const carriedLines = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
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
  /** Dismissed by the user; the Attach still knows the key changed. */
  const [keyWarningSeen, setKeyWarningSeen] = useState(false);

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
   * Which Panes are on screen, and where.
   *
   * Zoomed — or with nothing to split — that is one Surface filling the
   * container, which is the shape this app has had all along. Otherwise it is
   * every Pane at the rectangle the Layout gives it, on one cell metric. See
   * paneBoxes, and ADR 0006 for why this is possible at all.
   */
  const slots = useMemo((): PaneSlot[] => {
    const panes = topology?.panes ?? [];
    const active = topology?.activePane;
    if (panes.length === 0 || !active) return [];

    // tmux's zoom, not Muxify's preference for it. The preference says what a
    // Session should arrive as and what the switch asks for; what is on screen
    // has to follow the Window, or unzooming from the laptop would leave this
    // showing one Pane stretched across a split.
    if ((topology?.activeWindow?.zoomed ?? true) || panes.length === 1) {
      return [
        {
          pane: active,
          box: { left: 0, top: 0, width: containerSize.width, height: containerSize.height },
          rows: visibleGrid?.rows ?? active.height,
          fillsWindow: true,
        },
      ];
    }

    const boxes = paneBoxes(panes, containerSize);
    return panes.flatMap((pane) => {
      const box = boxes.get(pane.id);
      return box ? [{ pane, box, rows: pane.height, fillsWindow: false }] : [];
    });
  }, [topology, containerSize, visibleGrid]);

  /** Whether anything on screen spans the Window, which sizing needs to know. */
  const spanning = slots.length === 0 || slots.some((slot) => slot.fillsWindow);
  useEffect(() => {
    attach?.spanningSurface(spanning);
  }, [attach, spanning]);

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
   * A Surface for one Pane, arriving or going.
   *
   * The whole of what the screen does about painting. Which Surface belongs to
   * which Pane, whether both halves have arrived, when the library will accept
   * a write and what the cursor should do are all the Pane view's, which is
   * where they can be tested.
   */
  const adoptPaneSurface = useCallback(
    (paneId: string, ref: TerminalViewRef | null) => {
      attach?.surfaceForPane(paneId, ref === null ? null : surfaceFor(ref));
    },
    [attach],
  );

  const reportPaneGrid = useCallback(
    (paneId: string, grid: Grid) => attach?.paneGridReported(paneId, grid),
    [attach],
  );

  /**
   * A Surface that fills the Window reporting its grid.
   *
   * Only the single-Pane and zoomed cases go through here, and that is the
   * point: its grid *is* the Window's. A Pane in a split reports only its own
   * share, which would size the Window to a fraction of itself.
   */
  const reportWindowGrid = useCallback(
    ({ nativeEvent }: { nativeEvent: Grid }) => {
      attach?.windowGridReported(
        { cols: nativeEvent.cols, rows: nativeEvent.rows },
        containerSize,
      );
    },
    [attach, containerSize],
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
    void activeView()?.toggleKeyboard();
  }, [activeView]);

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
   * Theme and unreadable in another — Latte's terminal is nearly white.
   */
  const dimText = useMemo(() => ({ color: opened.terminal.dim }), [opened.terminal.dim]);

  /** The Theme's chrome colours, which the Key Bar draws its own labels in. */
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

  const dockGroups: DockAction[][] = useMemo(() => {
    // Two groups here and the Key Bar before them, because there are three
    // kinds of thing: the keys the phone's keyboard does not have, the things
    // the Session is made of, and the way out. One long row said none of that.
    return [
      [
        {
          id: 'sessions',
          label: 'Sessions',
          systemImage: 'square.on.square',
          onPress: () => openPicker('sessions'),
          disabled: !connected,
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
        },
        {
          id: 'panes',
          label: 'Panes',
          systemImage: 'rectangle.split.2x1',
          // Same: one Pane is when you reach for Split.
          disabled: !connected,
          onPress: () => openPicker('panes'),
        },
      ],
      [
        {
          id: 'home',
          label: 'Home',
          systemImage: 'house',
          // All the way to the Hosts list, not back a step: Home means home,
          // and a step back is the Session list of the Host just left. The
          // Session stays attached — this is navigation and nothing else.
          onPress: () => router.dismissTo('/'),
        },
        {
          id: 'keyboard',
          label: 'Keyboard',
          systemImage: keyboardVisible ? 'keyboard.chevron.compact.down' : 'keyboard',
          onPress: toggleKeyboard,
        },
      ],
    ];
  }, [router, toggleKeyboard, keyboardVisible, openPicker, connected]);

  useEffect(() => {
    // Only so the Dock can show which way its keyboard button points. The
    // action itself goes to the Surface that has focus, which this listener
    // cannot see — see toggleKeyboard.
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const status = statusOf(state, missing);
  const keyWarning = state?.keyChanged === true && attach ? attach.hostName : null;

  return (
    // The ground the Surface sits on follows the Theme, or the safe-area strip
    // above it shows as a band of a different dark.
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: opened.terminal.background },
      ]}>
      {/* The Theme decides this, not the phone: white glyphs over Latte's
          near-white terminal are a status bar nobody can read. */}
      <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />

      <View
        style={[styles.surfaceArea, { backgroundColor: opened.terminal.background }]}
        onLayout={({ nativeEvent }) => {
          const size = { width: nativeEvent.layout.width, height: nativeEvent.layout.height };
          setContainerSize(size);
          attach?.containerLaidOut(size);
        }}>
        {/* Before there is a Topology there are no Panes to place, and nothing
            but a Surface can measure a cell — so one stands in as the ruler.
            That is the sizing module's decision, not this screen's; see its
            docblock. It is replaced by the real Panes the moment they are
            known, and their resync paints them. */}
        {slots.length === 0 ? (
          <TerminalView
            style={styles.surface}
            fontSize={opened.font ?? DEFAULT_FONT_SIZE}
            accessoryBar={false}
            theme={{
              background: opened.terminal.background,
              foreground: opened.terminal.foreground,
              cursorColor: opened.terminal.cursor,
              palette: opened.ansi ? [...opened.ansi] : undefined,
            }}
            onResize={reportWindowGrid}
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
            onInput={handlePaneInput}
            onScroll={handlePaneScroll}
            onSelect={(paneId) => attach?.selectPane(paneId)}
          />
        ))}

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

        {state?.mouseTracking && activeSlot && mouseGrid ? (
          <MouseLayer
            box={activeSlot.box}
            grid={mouseGrid}
            onTap={handleTapCell}
            onScroll={(lines) => handleScrollLines(lines, mouseGrid)}
          />
        ) : null}
      </View>

      <PickerSheet
        title={picker.open ? PICKER_TITLES[picker.kind] : ''}
        isPresented={picker.open}
        onDismiss={() => setPicker({ open: false })}
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

      {keyWarning && !keyWarningSeen ? (
        <HostKeyWarning
          hostName={keyWarning}
          onAccept={() => {
            setKeyWarningSeen(true);
            const accepted = state?.fingerprint;
            void (async () => {
              if (hostId && accepted) {
                await deviceHostStore().rememberFingerprint(hostId, accepted);
              }
            })();
          }}
          onDismiss={() => setKeyWarningSeen(true)}
        />
      ) : null}

      <Dock
        groups={dockGroups}
        leading={
          <KeyBar
            keys={BAR_KEYS}
            armed={armed}
            onPress={pressBarKey}
            onArm={armModifier}
            disabled={!connected}
            palette={chrome}
          />
        }
      />

      {/* Below the status bar, not behind it: the container's padding does not
          push an absolutely positioned child down, so the grid ended up
          underneath the battery where nobody could read it. */}
      <View style={[styles.overlay, { top: insets.top + 8 }]} pointerEvents="none">
        {/* Always rendered, so its value can be asserted rather than its
            absence. `surface-grid` appears only once the Surface has reported a
            grid, so its presence is the signal that layout and `onResize`
            completed; the value is device-specific, so select on the id. */}
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
        {state?.trouble ? (
          <ThemedText type="code" style={styles.troubleText} testID="pane-trouble">
            {state.trouble}
          </ThemedText>
        ) : null}
      </View>

      <StatusBanner
        status={status}
        palette={opened.terminal}
        onReconnect={attach ? () => attach.reconnect() : undefined}
      />
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
};

function statusOf(state: AttachState | null, missing: string | null): Status {
  if (missing) return { label: `Failed: ${missing}`, busy: false, offerReconnect: false, quiet: false };
  // Nothing attached yet, which from here is indistinguishable from an Attach
  // that has not answered — and is the same word either way.
  if (!state) return { label: 'Connecting', busy: true, offerReconnect: false, quiet: false };
  return statusForPhase(state.phase);
}

function statusForPhase(phase: AttachPhase): Status {
  const label = phaseLabel(phase);
  switch (phase.kind) {
    case 'connected':
      return { label, busy: false, offerReconnect: false, quiet: true };
    case 'connecting':
    case 'restoring':
    case 'reconnecting':
      return { label, busy: true, offerReconnect: false, quiet: false };
    case 'disconnected':
      return {
        label,
        detail: phase.reason.detail,
        busy: false,
        // Offered for a lost transport and nothing else: a wrong password and
        // a Session that has ended would both fail again in exactly the same
        // way, and a button that cannot work is worse than none.
        offerReconnect: retryCouldWork(phase.reason),
        quiet: false,
      };
    case 'closed':
      return { label, busy: false, offerReconnect: false, quiet: false };
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
  onInput,
  onScroll,
  onSelect,
}: {
  slot: PaneSlot;
  font: number;
  terminal: TerminalPalette;
  ansi: readonly string[] | undefined;
  onRef: (paneId: string, ref: TerminalViewRef | null) => void;
  onPaneResize: (paneId: string, grid: Grid) => void;
  onWindowResize?: (event: { nativeEvent: Grid }) => void;
  onInput: (paneId: string, data: string) => void;
  onScroll: (paneId: string, grid: Grid, height: number, points: number) => void;
  onSelect: (paneId: string) => void;
}) {
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
   */
  const register = useCallback(
    (ref: TerminalViewRef | null) => onRef(paneId, ref),
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
          own.current = { cols: nativeEvent.cols, rows: nativeEvent.rows };
          onWindowResize?.({ nativeEvent });
          onPaneResize(slot.pane.id, own.current);
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
  onTap,
  onScroll,
}: {
  box: PaneBox;
  grid: Grid;
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
      carried.current += points * (grid.rows / height) * SCROLL_SPEED;
      const lines = Math.trunc(carried.current);
      if (lines === 0) return;
      carried.current -= lines;
      onScroll(lines);
    },
    [grid.rows, onScroll],
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
          cellOf(nativeEvent.locationX, width, grid.cols),
          cellOf(nativeEvent.locationY, height, grid.rows),
        );
      }}
      onResponderTerminate={() => stopCoasting()}
    />
  );
}

/**
 * Which cell a point lands in, 1-based as SGR counts them.
 *
 * Clamped to the grid: the Surface is rarely an exact number of cells tall, so
 * a tap in the leftover strip at the edge belongs to the last cell rather than
 * to one that is not there.
 */
function cellOf(point: number, extent: number, cells: number): number {
  return Math.min(cells, Math.max(1, Math.floor((point / extent) * cells) + 1));
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
      // Inverted against the Theme rather than painted a fixed light: the pill
      // has to read over whatever the Session is painting behind it, and a
      // light pill with light text is what a fixed one gave on Latte.
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
 * The loud banner, shown only while something needs the user's attention.
 *
 * It carries the Reconnect action, and only where trying again could work: a
 * lost transport, and nothing else. The quiet always-present indicator above
 * carries the same label for assertions.
 */
function StatusBanner({
  status,
  palette,
  onReconnect,
}: {
  status: Status;
  palette: TerminalPalette;
  onReconnect?: () => void;
}) {
  if (status.quiet) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: palette.black, borderColor: palette.grey }]}
      accessibilityLabel={status.label}>
      {status.busy ? <ActivityIndicator size="small" color={palette.foreground} /> : null}
      <ThemedText type="small" style={[styles.bannerText, { color: palette.foreground }]}>
        {status.detail ? `${status.label}: ${status.detail}` : status.label}
      </ThemedText>
      {status.offerReconnect && onReconnect ? (
        <Pressable onPress={onReconnect} accessibilityRole="button" accessibilityLabel="Reconnect">
          <ThemedText type="smallBold" style={{ color: palette.foreground }} testID="reconnect">
            Reconnect
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
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
  onAccept,
  onDismiss,
}: {
  hostName: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.keyWarning} accessibilityLabel={`Host key changed for ${hostName}`}>
      <ThemedText type="smallBold" style={styles.keyWarningTitle}>
        {`${hostName} presented a different host key`}
      </ThemedText>
      <ThemedText type="small" style={styles.keyWarningBody}>
        It may have been rebuilt, or something may be intercepting the connection.
      </ThemedText>
      <View style={styles.keyWarningActions}>
        <Pressable onPress={onAccept} accessibilityRole="button" accessibilityLabel="Accept new key">
          <ThemedText type="smallBold" style={styles.keyWarningAccept}>
            Accept new key
          </ThemedText>
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Keep warning">
          <ThemedText type="small" style={styles.keyWarningBody}>
            Not now
          </ThemedText>
        </Pressable>
      </View>
    </View>
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
  overlay: {
    position: 'absolute',
    right: 12,
    alignItems: 'flex-end',
    gap: 2,
  },
  troubleText: {
    // Loud enough to notice over whatever the Session is painting, quiet
    // enough not to be a banner: the Connection is fine, one command was not.
    color: '#ffb4b4',
    maxWidth: 260,
    textAlign: 'right',
  },
  keyWarning: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#5b1d1d',
  },
  keyWarningTitle: {
    color: '#ffd9d9',
  },
  keyWarningBody: {
    color: '#f3c7c7',
  },
  keyWarningActions: {
    flexDirection: 'row',
    gap: 18,
    paddingTop: 6,
  },
  keyWarningAccept: {
    color: '#ffffff',
  },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    flexShrink: 1,
  },
});
