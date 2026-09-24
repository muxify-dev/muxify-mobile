import type { SshConnection } from '@osuki-dev/react-native-ssh';
import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock, type DockAction } from '@/components/dock';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import type { TerminalPalette } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import { connectToHost, describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { directoryName } from '@/lib/paths';
import { LINES_PER_NOTCH } from '@/lib/mouse-wheel';
import { settle } from '@/lib/settle';
import { toShellInput } from '@/lib/terminal-input';
import { createResizeScheduler } from '@/tmux/resize-scheduler';
import { openControlConnection, type ControlConnection } from '@/tmux/control-connection';
import { createPaneView, type PaneView, type ScrollPosition } from '@/tmux/pane-view';
import { paneTopologyFrames } from '@/tmux/pane-topology';
import { trimPreview, windowPreviewTarget } from '@/tmux/preview';
import {
  createTopologyStore,
  EMPTY_TOPOLOGY,
  type Topology,
  type TopologyStore,
} from '@/tmux/topology';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient, type Grid, type Session } from '@/tmux/tmux-client';

/** What the Surface uses when the user has not picked a size. */
const DEFAULT_FONT_SIZE = 13;

/**
 * How long to let the Surface's grid stop moving before the Client is sized
 * from it. Short enough to disappear inside the Connection it follows, long
 * enough to outlast a SwiftUI measure pass.
 */
const GRID_SETTLE_MS = 80;
const GRID_SETTLE_TRIES = 12;

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

type Status =
  | { phase: 'waiting-for-layout' }
  | { phase: 'connecting' }
  | { phase: 'connected'; fingerprint: string }
  | { phase: 'closed'; reason: string }
  | { phase: 'failed'; message: string };

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
  const surface = useRef<TerminalViewRef>(null);
  const connection = useRef<SshConnection | null>(null);
  /** The one channel: commands and Pane output, no PTY. */
  const control = useRef<ControlConnection | null>(null);
  const tmux = useRef<TmuxClient | null>(null);
  /** What the Surface is showing: the resync, the stream and the scrolling. */
  const view = useRef<PaneView | null>(null);
  const sessionName = useRef<string>('');
  const grid = useRef<Grid | null>(null);
  /** The Surface's size in points, paired with the grid it produced. */
  const surfaceHeight = useRef(0);
  const surfaceWidth = useRef(0);
  const hasStarted = useRef(false);
  const disposed = useRef(false);
  /** Scroll distance not yet worth a notch of the wheel. */
  const carriedLines = useRef(0);

  const [status, setStatus] = useState<Status>({ phase: 'waiting-for-layout' });
  const [visibleGrid, setVisibleGrid] = useState<Grid | null>(null);
  /** How far back the Pane is being viewed, or null at the live bottom. */
  const [scrolled, setScrolled] = useState<ScrollPosition | null>(null);
  /**
   * The last thing that went wrong with the Pane itself, shown quietly.
   *
   * Not a Status: a Connection that is up and a Pane that refused one command
   * are different things, and killing the screen for a `send-keys` into a Pane
   * that has just gone would be worse than saying so. Cleared by the next
   * repaint that works.
   */
  const [paneTrouble, setPaneTrouble] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  /**
   * Whether the application in the Pane is listening for the mouse.
   *
   * It decides what a tap is for. When nothing is listening a tap belongs to
   * the keyboard, which is what the Surface does with it on its own; when
   * something is, the tap has to be taken off the Surface before it raises the
   * keyboard, and sent on as a click instead.
   */
  const [mouseTracking, setMouseTracking] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ open: false });

  /**
   * The Session's Windows and Panes, kept by what tmux pushes rather than read
   * when a sheet opens. See createTopologyStore.
   */
  const store = useRef<TopologyStore | null>(null);
  const [topology, setTopology] = useState<Topology>(EMPTY_TOPOLOGY);
  /**
   * The Host's Sessions, as of the last `%sessions-changed`. A picker's list is
   * never a round trip; only its previews are.
   */
  const [sessions, setSessions] = useState<Session[] | null>(null);
  /** Previews by capture target, filled in behind an already-open sheet. */
  const [previews, setPreviews] = useState<Map<string, string[]>>(new Map());

  /**
   * Whether the attached Pane fills the Window on its own.
   *
   * On by default: a phone is too narrow to read two Panes side by side, so a
   * split Session arrives zoomed and the splits are something you step into
   * rather than squint at. Turning it off shows the real layout.
   */
  const [zoomed, setZoomed] = useState(settings.zoomMultipaneWindows);
  /**
   * The Theme and font size this Session was opened with.
   *
   * Frozen on arrival rather than followed: changing the font under a live
   * Surface would reflow the grid, which means a resize, which means tmux
   * redrawing mid-session. Settings apply from the next Attach, a step away.
   */
  const [opened] = useState(() => ({ font: settings.fontSize, terminal, ansi }));
  /** Rendered in the Dock, so the attached Session survives a switch. */
  const [attachedSession, setAttachedSession] = useState('');
  /** Set when the Host's key is not the one last seen. Never blocks. */
  const [keyWarning, setKeyWarning] = useState<{ hostName: string; fingerprint: string } | null>(
    null,
  );

  /**
   * Owns every remote resize, so a keyboard animation cannot flood the Host.
   *
   * One size, one command, and no Session option. `refresh-client -C` is how a
   * control client says how big it is; under tmux's default `window-size
   * latest` the Window follows it while it is the latest to have asked, and
   * reverts when the Client goes. There is nothing to restore and no tty to
   * wait for — the Control Connection *is* the Client. See ADR 0006.
   */
  const remoteSize = useMemo(
    () =>
      createResizeScheduler(async (next) => {
        const client = tmux.current;
        // Thrown, not shrugged off: the scheduler must not record a size it
        // never sent, or it will skip the next request for the same one.
        if (!client) throw new Error('no Client to resize');
        await client.resizeClient(next);
      }),
    [],
  );

  /** Reads the Topology from the Host and publishes it to the screen. */
  const refreshTopology = useCallback(async (): Promise<Topology> => {
    const model = store.current;
    if (!model) return EMPTY_TOPOLOGY;
    return model.refresh(sessionName.current);
  }, []);

  /**
   * Points the Surface at whichever Pane tmux says is active.
   *
   * A resync rather than a redraw: there is no composited Window to repaint
   * any more, so moving to another Pane means reading what is on that Pane and
   * painting it. Does nothing when the Surface is already showing it, which is
   * what keeps a Topology read from costing a capture it does not need.
   */
  const showActivePane = useCallback(async (): Promise<void> => {
    const pane = store.current?.current().activePane;
    if (!pane || !view.current || view.current.paneId() === pane.id) return;
    await view.current.show(pane.id, grid.current?.rows ?? 24);
  }, []);

  /**
   * One finger on the Surface, moving the Pane through its Scrollback.
   *
   * The gesture is the library's own — the same pan and the same momentum it
   * would otherwise spend on ghostty's scrollback, which a Surface painted from
   * a capture does not have. Points become lines here because only this side
   * knows both the grid and the height it was laid out at.
   *
   * The fraction of a line left over is carried between frames rather than
   * dropped, so a slow drag moves at the speed of the finger instead of
   * stalling until a whole line has accumulated.
   */
  const handleScroll = useCallback(
    ({ nativeEvent }: { nativeEvent: { points: number } }) => {
      const size = grid.current;
      const height = surfaceHeight.current;
      if (!view.current || !size || size.rows <= 0 || height <= 0) return;

      // A finger moving down pulls older output into view.
      carriedLines.current += nativeEvent.points * (size.rows / height);
      const notches = Math.trunc(carriedLines.current / LINES_PER_NOTCH);
      if (notches === 0) return;
      carriedLines.current -= notches * LINES_PER_NOTCH;

      view.current.scroll(notches, size);
    },
    [],
  );

  /**
   * A tap at one cell, while an application is listening for the mouse.
   *
   * See MouseLayer for why this does not go through the Surface's own gesture.
   */
  const handleTapCell = useCallback((column: number, row: number) => {
    view.current?.click(column, row);
  }, []);

  /** A drag, already counted in wheel notches by whoever owned the finger. */
  const handleNotches = useCallback((notches: number) => {
    const size = grid.current;
    if (size) view.current?.scroll(notches, size);
  }, []);

  /** Puts the Pane back at the live bottom, and the indicator away with it. */
  const jumpToLatest = useCallback(() => {
    carriedLines.current = 0;
    view.current?.jumpToLatest();
  }, []);

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
      if (kind === 'sessions') {
        return (sessions ?? []).map((session) => ({
          id: session.name,
          title: session.name,
          // The name, even though `title` already holds it. A preview card
          // draws its badge and its detail and nothing else — `title` is what
          // the card is announced as, not what it is labelled with — so a
          // Session, which has no badge, would be identified by nothing at all
          // without this.
          detail: `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
          current: session.name === sessionName.current,
          preview: previewOf(previews, `${session.name}:`),
        }));
      }

      if (kind === 'windows') {
        const session = sessionName.current;
        return topology.windows.map((window) => ({
          id: String(window.index),
          title: window.name,
          detail: `${window.command} · ${window.paneCount} ${plural(window.paneCount, 'pane')}`,
          current: window.active,
          badge: String(window.index),
          preview: previewOf(previews, windowPreviewTarget(session, window.index)),
        }));
      }

      // No capture here: the Panes are all on screen behind this sheet already,
      // so the question is which one you mean, not what is in it. Where it
      // sits, what directory it is in and what it is running are what tell two
      // Panes apart; a tile of six-point terminal text does not.
      const frames = paneTopologyFrames(topology.panes);
      return topology.panes.map((pane) => ({
        id: String(pane.index),
        title: directoryName(pane.path) || `Pane ${pane.index}`,
        detail: pane.command,
        current: pane.active,
        frame: frames.get(pane.index),
        preview: [],
      }));
    },
    [sessions, topology, previews],
  );

  /**
   * Corrects an already-open sheet behind itself.
   *
   * Two things a notification cannot carry. **Previews** are screen content,
   * and a picture of a Pane is worth nothing unless it is of now. And **what a
   * Pane is running** — `#{pane_current_command}`, `#{pane_current_path}` —
   * changes with no notification at all: nothing is pushed when a shell starts
   * `vim`, so the Windows sheet's detail line and the Panes sheet's title would
   * otherwise freeze at the last time the Topology changed shape. The polled
   * design re-read on output for exactly this reason; this is where that went.
   *
   * It is why the rows are drawn from the model *first*. The sheet is never
   * waiting on this — it opens filled and corrects itself a round trip later.
   */
  const refreshBehindSheet = useCallback(
    (kind: PickerKind) => {
      const client = tmux.current;
      if (!client) return;

      if (kind !== 'sessions') void refreshTopology();

      if (kind === 'panes') return;
      const targets =
        kind === 'sessions'
          ? (sessions ?? []).map((session) => `${session.name}:`)
          : topology.windows.map((window) =>
              windowPreviewTarget(sessionName.current, window.index),
            );
      if (targets.length === 0) return;
      void (async () => {
        const fresh = await client.capturePanes(targets);
        if (disposed.current || fresh.size === 0) return;
        setPreviews((previous) => new Map([...previous, ...fresh]));
      })();
    },
    [refreshTopology, sessions, topology.windows],
  );

  /** Re-reads the Host's Session list, which no notification describes. */
  const refreshSessions = useCallback(() => {
    const client = tmux.current;
    if (!client) return;
    void (async () => {
      try {
        const listed = await client.listSessions();
        if (!disposed.current) setSessions(listed);
      } catch {
        // A Session list that will not read is a picker with nothing new in
        // it, not a Connection worth taking down.
      }
    })();
  }, []);

  const start = useCallback(
    async (initial: Grid) => {
      if (!hostId || !sessionParam) {
        setStatus({ phase: 'failed', message: 'No Host was chosen.' });
        return;
      }

      const hostStore = deviceHostStore();
      const records = await hostStore.load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        setStatus({ phase: 'failed', message: 'This Host is no longer saved.' });
        return;
      }

      setStatus({ phase: 'connecting' });

      try {
        const { connection: conn, fingerprint, verdict } = await connectToHost(host, hostStore);

        if (disposed.current) {
          await conn.disconnect();
          return;
        }
        connection.current = conn;

        // Trust on first use: remember the key the first time, and say so
        // loudly when it changes. The Connection is not blocked either way —
        // someone who has just rebuilt a machine still has to reach it.
        if (verdict.kind === 'first-sight') {
          await hostStore.rememberFingerprint(host.id, fingerprint);
        } else if (verdict.kind === 'changed') {
          setKeyWarning({ hostName: host.displayName, fingerprint });
        }

        // Size from a grid that has stopped moving, not merely the latest.
        // The Surface reports one while the Dock's glass is still being
        // measured — every group is a `Host matchContents`, which takes its
        // size only after SwiftUI has laid out — and a smaller one once the
        // Dock has taken its height. Sizing the Client from the first value
        // would leave tmux drawing a taller Window than the Surface has.
        const current = await settle(() => grid.current, initial, {
          same: (a, b) => a.cols === b.cols && a.rows === b.rows,
          everyMs: GRID_SETTLE_MS,
          tries: GRID_SETTLE_TRIES,
        });

        sessionName.current = sessionParam;

        // This is Attach: one channel, no PTY, and no Session option touched.
        const opening = await openControlConnection(
          sshTmuxTransport(conn),
          { sessionName: sessionParam, tmuxExecutablePath: host.tmuxExecutablePath },
          {
            onOutput: (pane, bytes) => view.current?.receive(pane, bytes),
            onNotification: (event) => {
              const model = store.current;
              if (!model) return;
              if (event.kind === 'session-changed') {
                sessionName.current = event.name;
                setAttachedSession(event.name);
              }
              if (event.kind === 'sessions-changed') refreshSessions();
              const applied = model.apply(event);
              if (applied === 'stale') void refreshTopology();
            },
            onClosed: (reason) => {
              if (!disposed.current) setStatus({ phase: 'closed', reason });
            },
          },
        );

        if (disposed.current) {
          await opening.close();
          await conn.disconnect();
          return;
        }

        control.current = opening;
        const client = new TmuxClient(opening);
        tmux.current = client;

        view.current = createPaneView(client, {
          write: (bytes) => {
            surface.current?.write(bytesToBase64(bytes));
            if (!disposed.current) setPaneTrouble(null);
          },
          onScroll: (position) => {
            if (!disposed.current) setScrolled(position);
          },
          onMouseTracking: (wanted) => {
            if (!disposed.current) setMouseTracking(wanted);
          },
          // Without this a refused command — typing into a Pane that has just
          // been killed, most likely — would vanish, and the Surface would sit
          // there looking connected and ignoring the keyboard.
          onError: (error) => {
            if (!disposed.current) setPaneTrouble(describe(error));
          },
        });

        const model = createTopologyStore(client);
        store.current = model;
        model.subscribe((next) => {
          if (disposed.current) return;
          setTopology(next);
          // tmux moved the active Pane — a split, a Window switch, somebody
          // else's `select-pane` on the laptop. The Surface follows it from
          // here, so nothing that changes the Topology has to remember to.
          void showActivePane();
        });

        setAttachedSession(sessionParam);
        setStatus({ phase: 'connected', fingerprint });

        // Stamped on a Session that actually opened, not on one that was only
        // tapped: the Host Screen's order is a record of where you have been,
        // and a Session that refused to attach is not somewhere you have been.
        void hostStore.rememberSession(host.id, sessionParam);

        // Size first, so the capture that follows is of a Pane the size of the
        // Surface rather than of whatever the last Client left it.
        remoteSize.reset();
        remoteSize.request(grid.current ?? current);
        // A phone is too narrow for side-by-side Panes, so a split Session
        // arrives with its active Pane filling the Window.
        await client.setZoom(sessionParam, zoomed);
        await refreshTopology();
        await showActivePane();
        refreshSessions();
      } catch (error) {
        if (!disposed.current) {
          setStatus({ phase: 'failed', message: describeConnectionFailure(error) });
        }
      }
    },
    [
      hostId,
      sessionParam,
      remoteSize,
      refreshTopology,
      showActivePane,
      refreshSessions,
      zoomed,
    ],
  );

  const handleResize = useCallback(
    ({ nativeEvent }: { nativeEvent: Grid }) => {
      const next: Grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
      grid.current = next;
      setVisibleGrid(next);
      view.current?.resize(next.rows);

      if (control.current) {
        // Every remote resize goes through one place, so a keyboard animation
        // is one round trip rather than thirty. See createResizeScheduler.
        remoteSize.request(next);
        return;
      }

      if (!hasStarted.current) {
        hasStarted.current = true;
        void start(next);
      }
    },
    [start, remoteSize],
  );

  const handleInput = useCallback(({ nativeEvent }: { nativeEvent: { data: string } }) => {
    // `data` is base64. The sibling `text` field must not be used: a
    // multi-byte character split across reads is corrupted by text decoding.
    //
    // What comes out of the Surface is not quite what a shell expects — every
    // keystroke arrives wrapped as a bracketed paste. See toShellInput.
    view.current?.type(toShellInput(base64ToBytes(nativeEvent.data)));
  }, []);

  /**
   * Shows or hides the system keyboard.
   *
   * Both directions go through the Surface's own first-responder state, added
   * to `expo-libghostty` by a local patch. Nothing in React Native can do this:
   * `Keyboard.dismiss()` only blurs what RN's own registry believes is focused,
   * and the Surface is a native text input that RN never registered — so it was
   * a no-op, and there was no way at all to raise the keyboard again.
   */
  const toggleKeyboard = useCallback(() => {
    if (keyboardVisible) {
      void surface.current?.blur();
    } else {
      void surface.current?.focus();
    }
  }, [keyboardVisible]);

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
        loading: kind === 'sessions' && sessions === null,
        cards: cardsFor(kind),
      });
      refreshBehindSheet(kind);
    },
    [cardsFor, refreshBehindSheet, sessions],
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
    setPicker((previous) => (previous.open ? { ...previous, error: describe(error) } : previous));
  }, []);

  /**
   * Acts on a picked row.
   *
   * The sheet closes on success and stays up on failure; see showPickerError.
   */
  const select = useCallback(
    (kind: PickerKind, id: string) => {
      void (async () => {
        const client = tmux.current;
        if (!client) return;
        try {
          if (kind === 'sessions') {
            if (id === sessionName.current) {
              setPicker({ open: false });
              return;
            }
            await client.switchSession(id);
            sessionName.current = id;
            setAttachedSession(id);
            setPicker({ open: false });
            // Switching lands in a Session just as arriving does, so it counts
            // the same on the Host Screen. Without this the order would only
            // remember how a visit started, not where it went.
            if (hostId) void deviceHostStore().rememberSession(hostId, id);
            remoteSize.reset();
            const current = grid.current;
            if (current) remoteSize.request(current);
          } else if (kind === 'windows') {
            await client.selectWindow(sessionName.current, Number(id));
            setPicker({ open: false });
          } else {
            const windowIndex = topology.activeWindow?.index;
            if (windowIndex === undefined) return;
            await client.selectPane(sessionName.current, windowIndex, Number(id));
            setPicker({ open: false });
          }
          // Selecting a Pane drops tmux out of zoom, and moving to another
          // Window lands on one nobody has zoomed, so the preference is
          // re-applied rather than assumed to have survived.
          await client.setZoom(sessionName.current, zoomed);
          await refreshTopology();
          await showActivePane();
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [
      refreshTopology,
      showActivePane,
      showPickerError,
      topology.activeWindow,
      zoomed,
      remoteSize,
      hostId,
    ],
  );

  /** Zoom, split and new-Window: the sheet's bottom bar. */
  const runSheetAction = useCallback(
    (id: string) => {
      void (async () => {
        const client = tmux.current;
        if (!client) return;
        try {
          if (id === 'new-window') {
            await client.newWindow(sessionName.current);
          } else if (id === 'split-right' || id === 'split-down') {
            await client.splitWindow(sessionName.current, id === 'split-right' ? 'right' : 'down');
            // A fresh split is not what the user is looking at yet, and on a
            // phone two Panes side by side are unreadable.
            await client.setZoom(sessionName.current, zoomed);
          }
          setPicker({ open: false });
          await refreshTopology();
          await showActivePane();
        } catch (error) {
          showPickerError(error);
        }
      })();
    },
    [refreshTopology, showActivePane, showPickerError, zoomed],
  );

  const changeZoom = useCallback(
    (on: boolean) => {
      setZoomed(on);
      void (async () => {
        const client = tmux.current;
        if (!client) return;
        await client.setZoom(sessionName.current, on);
        await refreshTopology();
      })();
    },
    [refreshTopology],
  );

  /**
   * The quiet overlay text, in the Theme's own dim tone.
   *
   * It sits directly on the Surface, so a fixed colour is right for exactly one
   * Theme and unreadable in another — Latte's terminal is nearly white.
   */
  const dimText = useMemo(() => ({ color: opened.terminal.dim }), [opened.terminal.dim]);

  const dockGroups: DockAction[][] = useMemo(() => {
    const connected = status.phase === 'connected';
    // One group, so the Dock reads as a single control rather than a row of
    // unrelated islands.
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
        {
          id: 'home',
          label: 'Home',
          systemImage: 'house',
          // All the way to the Hosts list, not back a step: Home means home,
          // and a step back is the Session list of the Host just left.
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
  }, [router, toggleKeyboard, keyboardVisible, openPicker, status.phase]);

  useEffect(() => {
    // Only so the Dock can show which way its keyboard button points.
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    disposed.current = false;
    return () => {
      // Connections are ephemeral by design; leaving the screen tears this
      // down and returning re-attaches, which tmux makes cheap.
      //
      // Nothing is handed back on the way out, because nothing was borrowed.
      // A control client sets no Session option, so a force-quit — which runs
      // none of this — leaves the Session exactly as it was found. That is the
      // whole of ADR 0006, and it is why this teardown is three lines.
      disposed.current = true;
      const openControl = control.current;
      const openConnection = connection.current;
      view.current?.dispose();
      view.current = null;
      control.current = null;
      connection.current = null;
      tmux.current = null;
      store.current = null;
      void (async () => {
        try {
          await openControl?.close();
        } finally {
          await openConnection?.disconnect();
        }
      })();
    };
  }, []);

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
        style={styles.surfaceArea}
        onLayout={({ nativeEvent }) => {
          surfaceHeight.current = nativeEvent.layout.height;
          surfaceWidth.current = nativeEvent.layout.width;
        }}>
        <TerminalView
          ref={surface}
          style={styles.surface}
          fontSize={opened.font ?? DEFAULT_FONT_SIZE}
          // The library's own bar of ctrl/esc/tab/arrows above the keyboard,
          // turned off by a local patch. It was the reason ADR 0003 ruled out
          // a modifier group in the Dock, so that decision is now open again —
          // with the bar gone there are no modifier keys at all.
          accessoryBar={false}
          theme={{
            background: opened.terminal.background,
            foreground: opened.terminal.foreground,
            cursorColor: opened.terminal.cursor,
            // The sixteen colours everything on the Host actually paints with.
            // Undefined for the Default Theme, which is ghostty's own palette.
            palette: opened.ansi ? [...opened.ansi] : undefined,
          }}
          onResize={handleResize}
          onInput={handleInput}
          // The Scrollback is tmux's, so the gesture has to be Muxify's:
          // ghostty would otherwise spend it on one of its own that does not
          // exist here. Needs the local patch.
          ownsScrollGesture
          onScroll={handleScroll}
        />

        {scrolled ? (
          <>
            <ScrollRail
              position={scrolled}
              rows={visibleGrid?.rows ?? 0}
              palette={opened.terminal}
            />
            <ScrollBackIndicator
              position={scrolled}
              palette={opened.terminal}
              onPress={jumpToLatest}
            />
          </>
        ) : null}

        {mouseTracking && visibleGrid ? (
          <MouseLayer grid={visibleGrid} onTap={handleTapCell} onScroll={handleNotches} />
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
          // Nothing to zoom out of with one Pane, so the switch is not offered
          // — unlike Split, which is how the second one gets made.
          picker.open && picker.kind === 'panes' && picker.cards.length > 1
            ? { on: zoomed, onChange: changeZoom }
            : undefined
        }
      />

      {keyWarning ? (
        <HostKeyWarning
          hostName={keyWarning.hostName}
          onAccept={() => {
            const accepted = keyWarning;
            setKeyWarning(null);
            void (async () => {
              if (hostId) await deviceHostStore().rememberFingerprint(hostId, accepted.fingerprint);
            })();
          }}
          onDismiss={() => setKeyWarning(null)}
        />
      ) : null}

      <Dock groups={dockGroups} />

      {/* Below the status bar, not behind it: the container's padding does not
          push an absolutely positioned child down, so the grid ended up
          underneath the battery where nobody could read it. */}
      <View style={[styles.overlay, { top: insets.top + 8 }]} pointerEvents="none">
        {/* Always rendered, so its value can be asserted rather than its
            absence. `surface-grid` appears only once the Surface has reported a
            grid, so its presence is the signal that layout and `onResize`
            completed; the value is device-specific, so select on the id. */}
        <ThemedText type="code" style={dimText} testID="connection-status">
          {label(status)}
        </ThemedText>
        {visibleGrid ? (
          <ThemedText type="code" style={dimText} testID="surface-grid">
            {visibleGrid.cols}x{visibleGrid.rows}
          </ThemedText>
        ) : null}
        {attachedSession ? (
          <ThemedText type="code" style={dimText} testID="attached-session">
            {attachedSession}
          </ThemedText>
        ) : null}
        {paneTrouble ? (
          <ThemedText type="code" style={styles.troubleText} testID="pane-trouble">
            {paneTrouble}
          </ThemedText>
        ) : null}
      </View>

      <StatusBanner status={status} palette={opened.terminal} />
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
  grid,
  onTap,
  onScroll,
}: {
  grid: Grid;
  onTap: (column: number, row: number) => void;
  onScroll: (notches: number) => void;
}) {
  const size = useRef({ width: 0, height: 0 });
  const origin = useRef(0);
  const previous = useRef(0);
  const dragged = useRef(false);
  /** Fractions of a line a slow drag has not yet spent. */
  const carried = useRef(0);

  return (
    <View
      style={StyleSheet.absoluteFill}
      testID="mouse-layer"
      onLayout={({ nativeEvent }) => {
        size.current = { width: nativeEvent.layout.width, height: nativeEvent.layout.height };
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={({ nativeEvent }: GestureResponderEvent) => {
        origin.current = nativeEvent.locationY;
        previous.current = nativeEvent.locationY;
        dragged.current = false;
        carried.current = 0;
      }}
      onResponderMove={({ nativeEvent }: GestureResponderEvent) => {
        const { height } = size.current;
        const travelled = nativeEvent.locationY - previous.current;
        previous.current = nativeEvent.locationY;
        if (Math.abs(nativeEvent.locationY - origin.current) > TAP_SLOP) dragged.current = true;
        if (height <= 0 || grid.rows <= 0) return;

        // A finger moving down pulls older output into view, which is the same
        // sign the Surface's own scroll reports.
        carried.current += travelled * (grid.rows / height);
        const notches = Math.trunc(carried.current / LINES_PER_NOTCH);
        if (notches === 0) return;
        carried.current -= notches * LINES_PER_NOTCH;
        onScroll(notches);
      }}
      onResponderRelease={({ nativeEvent }: GestureResponderEvent) => {
        const { width, height } = size.current;
        if (dragged.current || width <= 0 || height <= 0) return;
        onTap(
          cellOf(nativeEvent.locationX, width, grid.cols),
          cellOf(nativeEvent.locationY, height, grid.rows),
        );
      }}
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
  position: ScrollPosition;
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
  position: ScrollPosition;
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
 * The loud banner, shown only while something needs the user's attention. The
 * quiet always-present indicator above carries the same state for assertions.
 */
function StatusBanner({ status, palette }: { status: Status; palette: TerminalPalette }) {
  if (status.phase === 'connected') {
    return null;
  }

  const busy = status.phase === 'connecting' || status.phase === 'waiting-for-layout';

  return (
    <View
      style={[styles.banner, { backgroundColor: palette.black, borderColor: palette.grey }]}
      accessibilityLabel={label(status)}>
      {busy ? <ActivityIndicator size="small" color={palette.foreground} /> : null}
      <ThemedText type="small" style={[styles.bannerText, { color: palette.foreground }]}>
        {label(status)}
      </ThemedText>
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

function label(status: Status): string {
  switch (status.phase) {
    case 'waiting-for-layout':
      return 'Preparing terminal';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'closed':
      return `Detached: ${status.reason}`;
    case 'failed':
      return `Failed: ${status.message}`;
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    const message = error instanceof Error ? error.message : String(error);
    return code ? `${String(code)} — ${message}` : message;
  }
  return error instanceof Error ? error.message : String(error);
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
