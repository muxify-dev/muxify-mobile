import type { SshConnection } from '@osuki-dev/react-native-ssh';
import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock, type DockAction } from '@/components/dock';
import { PickerSheet, type PreviewCard, type SheetAction } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';
import { connectToHost, describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { toShellInput } from '@/lib/terminal-input';
import { applyGrid } from '@/tmux/apply-grid';
import { createResizeScheduler } from '@/tmux/resize-scheduler';
import { createSessionPreparer, type SessionPreparer } from '@/tmux/session-preparer';
import {
  paneFrames,
  panePreviewTarget,
  trimPreview,
  windowPreviewTarget,
} from '@/tmux/preview';
import { readTopology, type Topology } from '@/tmux/topology';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient } from '@/tmux/tmux-client';
import type { TmuxShell } from '@/tmux/transport';

/** The Surface's cell grid. Travels as a unit everywhere it is used. */
type Grid = { cols: number; rows: number };

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
      subtitle: string;
      error?: string;
    };

type Status =
  | { phase: 'waiting-for-layout' }
  | { phase: 'connecting' }
  | { phase: 'connected'; fingerprint: string }
  | { phase: 'closed'; exitCode: number | undefined }
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
  const surface = useRef<TerminalViewRef>(null);
  const connection = useRef<SshConnection | null>(null);
  const shell = useRef<TmuxShell | null>(null);
  const tmux = useRef<TmuxClient | null>(null);
  const sessionName = useRef<string>('');
  /** The tty of our own tmux Client, used to aim a redraw at it. */
  const clientTty = useRef<string | undefined>(undefined);
  /** Owns every Session Muxify has taken over, and hands them all back. */
  const sessions = useRef<SessionPreparer | null>(null);
  const grid = useRef<Grid | null>(null);
  /** The Surface's height in points, paired with the grid it produced. */
  const surfaceHeight = useRef(0);
  const hasStarted = useRef(false);
  const disposed = useRef(false);

  const [status, setStatus] = useState<Status>({ phase: 'waiting-for-layout' });
  const [visibleGrid, setVisibleGrid] = useState<Grid | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ open: false });
  /**
   * Last known Topology, for whether a picker has anything to offer. Null until
   * the first read: not knowing is not the same as knowing there is nothing,
   * and a button disabled on a guess is worse than one that opens a short list.
   */
  const [topology, setTopology] = useState<Topology | null>(null);
  /** When the Topology was last read, to keep output-driven refreshes rare. */
  const topologyReadAt = useRef(0);
  /**
   * Whether the attached Pane fills the Window on its own.
   *
   * On by default: a phone is too narrow to read two Panes side by side, so a
   * split Session arrives zoomed and the splits are something you step into
   * rather than squint at. Turning it off shows the real layout.
   */
  const [zoomed, setZoomed] = useState(true);
  /** Rendered in the Dock, so the attached Session survives a switch. */
  const [attachedSession, setAttachedSession] = useState('');
  /** Set when the Host's key is not the one last seen. Never blocks. */
  const [keyWarning, setKeyWarning] = useState<{ hostName: string; fingerprint: string } | null>(
    null,
  );

  /**
   * Owns every remote resize, so a keyboard animation cannot flood the Host
   * with Control Commands that land out of order. See createResizeScheduler.
   */
  const remoteSize = useMemo(
    () =>
      createResizeScheduler(async (next, previous) => {
        const client = tmux.current;
        if (!client) return;
        await applyGrid(
          {
            setWindowSize: (grid) => client.setWindowSize(sessionName.current, grid),
            // The Client's own pty, resized from the Host side because the
            // SSH library will not send a window-change; see
            // resizeClientCommand. Without a tty there is nothing to aim at,
            // which only happens before the first Topology read.
            setClientSize: async (grid) => {
              const tty = clientTty.current;
              if (tty) await client.setClientSize(tty, grid);
            },
            redraw: () => client.redrawClient(clientTty.current),
          },
          next,
          previous,
        );
      }),
    [],
  );

  /** Re-reads the Session's Windows and Panes, for the Dock and the sheet. */
  const refreshTopology = useCallback(async (): Promise<Topology> => {
    const client = tmux.current;
    if (!client) return EMPTY_TOPOLOGY;
    topologyReadAt.current = Date.now();
    const next = await readTopology(client, sessionName.current);
    setTopology(next);
    return next;
  }, []);

  /**
   * Re-reads the Topology when the Host has been busy.
   *
   * Windows and Panes are not only created through the Dock — the usual way is
   * a tmux keybinding typed into the terminal, which Muxify sees only as bytes.
   * Output is the signal that something happened, so it is worth a look, but a
   * Session running something chatty produces a lot of it: hence the interval,
   * which keeps this to an occasional read rather than a poll.
   */
  const noteOutput = useCallback(() => {
    if (Date.now() - topologyReadAt.current < TOPOLOGY_REFRESH_MS) return;
    void refreshTopology();
  }, [refreshTopology]);

  const start = useCallback(
    async (initial: Grid) => {
      if (!hostId || !sessionParam) {
        setStatus({ phase: 'failed', message: 'No Host was chosen.' });
        return;
      }

      const store = deviceHostStore();
      const records = await store.load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        setStatus({ phase: 'failed', message: 'This Host is no longer saved.' });
        return;
      }

      setStatus({ phase: 'connecting' });

      try {
        const { connection: conn, fingerprint, verdict } = await connectToHost(host, store);

        if (disposed.current) {
          await conn.disconnect();
          return;
        }
        connection.current = conn;

        // Trust on first use: remember the key the first time, and say so
        // loudly when it changes. The Connection is not blocked either way —
        // someone who has just rebuilt a machine still has to reach it.
        if (verdict.kind === 'first-sight') {
          await store.rememberFingerprint(host.id, fingerprint);
        } else if (verdict.kind === 'changed') {
          setKeyWarning({ hostName: host.displayName, fingerprint });
        }

        // Size from the latest grid, not the one captured when this started —
        // `onResize` fires more than once and the first is a pre-layout value.
        const current = grid.current ?? initial;

        // Everything tmux-shaped goes through the client, which owns command
        // construction and output parsing behind the transport seam.
        const client = new TmuxClient(sshTmuxTransport(conn), {
          tmuxExecutablePath: host.tmuxExecutablePath,
        });
        tmux.current = client;
        sessions.current = createSessionPreparer(client);
        sessionName.current = sessionParam;
        setAttachedSession(sessionParam);

        const opened = await client.attach(sessionParam, current, {
          onData: (data) => {
            surface.current?.write(bytesToBase64(new Uint8Array(data)));
            noteOutput();
          },
          onClosed: (exitCode) => {
            shell.current = null;
            if (!disposed.current) setStatus({ phase: 'closed', exitCode });
          },
        });

        if (disposed.current) {
          await opened.close();
          await conn.disconnect();
          return;
        }

        shell.current = opened;
        setStatus({ phase: 'connected', fingerprint });

        void (async () => {
          // Ours is the Client that just attached; a redraw aimed anywhere else
          // would leave this Surface dirty.
          clientTty.current = await client.newestClient(sessionParam);
          // Everything a Session needs before it can be shown on a phone.
          // Switching Session runs the same thing again.
          await sessions.current?.prepare(sessionParam, clientTty.current);
          // The Window's size has one owner. Reset first: this Session's Window
          // is whatever size its last Client left it, not what the Surface has.
          remoteSize.reset();
          remoteSize.request(grid.current ?? current);
          // A phone is too narrow for side-by-side Panes, so a split Session
          // arrives with its active Pane filling the Window.
          await client.setZoom(sessionParam, true);
          // Read once now so the Dock knows whether there is anything to pick
          // before the user reaches for a picker.
          await refreshTopology();
        })();

        // A resize may have landed while connecting; the scheduler picks it up
        // once the Client's tty is known.
      } catch (error) {
        if (!disposed.current) {
          setStatus({ phase: 'failed', message: describeConnectionFailure(error) });
        }
      }
    },
    [hostId, sessionParam, remoteSize, refreshTopology, noteOutput],
  );

  const handleResize = useCallback(
    ({ nativeEvent }: { nativeEvent: Grid }) => {
      const next: Grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
      grid.current = next;
      setVisibleGrid(next);

      if (shell.current) {
        // Both remote sizes go through one place, because the order they are
        // applied in decides whether tmux paints padding. See applyGrid.
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
    // `data` is base64. The sibling `text` field must not be used: a multi-byte
    // character split across reads is corrupted by text decoding.
    //
    // What comes out of the Surface is not quite what a shell expects — every
    // keystroke arrives wrapped as a bracketed paste. See toShellInput.
    shell.current?.write(toShellInput(base64ToBytes(nativeEvent.data)));
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
   * Opens a picker, reading what it shows from the Host right then.
   *
   * Muxify holds no live model of the Host — see ADR 0001 — so a sheet that
   * opened on a cached list would show Sessions that have since been killed and
   * Windows that have since been closed. The previews are read in the same
   * breath, one round trip for all of them, because a picker that takes a
   * second to fill is a picker nobody opens.
   */
  const openPicker = useCallback(
    (kind: PickerKind) => {
      setPicker({ open: true, kind, loading: true, cards: [], subtitle: '' });
      void (async () => {
        const client = tmux.current;
        const show = (cards: PreviewCard[], subtitle: string) =>
          setPicker((previous) =>
            previous.open && previous.kind === kind
              ? { open: true, kind, loading: false, cards, subtitle }
              : previous,
          );
        const fail = (message: string) =>
          setPicker((previous) =>
            previous.open && previous.kind === kind
              ? { ...previous, loading: false, error: message }
              : previous,
          );
        if (!client) {
          fail('Not connected');
          return;
        }

        try {
          if (kind === 'sessions') {
            const sessions = await client.listSessions();
            const previews = await client.capturePanes(
              sessions.map((session) => `${session.name}:`),
            );
            show(
              sessions.map((session) => ({
                id: session.name,
                title: session.name,
                // The name leads here, unlike a Window's chip: a Session has
                // no badge to identify it by, so the preview alone would leave
                // the user guessing which is which.
                detail: `${session.name} · ${session.windowCount} ${plural(session.windowCount, 'window')}`,
                current: session.name === sessionName.current,
                preview: previewOf(previews, `${session.name}:`, PREVIEW_LINES),
              })),
              `${sessions.length} ${plural(sessions.length, 'session')}`,
            );
            return;
          }

          const next = await refreshTopology();
          const session = sessionName.current;

          if (kind === 'windows') {
            const previews = await client.capturePanes(
              next.windows.map((window) => windowPreviewTarget(session, window.index)),
            );
            show(
              next.windows.map((window) => ({
                id: String(window.index),
                title: window.name,
                detail: `${window.command} · ${window.paneCount} ${plural(window.paneCount, 'pane')}`,
                current: window.active,
                badge: String(window.index),
                preview: previewOf(
                  previews,
                  windowPreviewTarget(session, window.index),
                  PREVIEW_LINES,
                ),
              })),
              `${session} · ${next.windows.length} ${plural(next.windows.length, 'window')}`,
            );
            return;
          }

          const windowIndex = next.activeWindow?.index ?? 0;
          const previews = await client.capturePanes(
            next.panes.map((pane) => panePreviewTarget(session, windowIndex, pane.index)),
          );
          const frames = paneFrames(next.panes);
          show(
            next.panes.map((pane) => ({
              id: String(pane.index),
              title: pane.title || `Pane ${pane.index}`,
              detail: pane.command,
              current: pane.active,
              frame: frames.get(pane.index),
              preview: previewOf(
                previews,
                panePreviewTarget(session, windowIndex, pane.index),
                PANE_PREVIEW_LINES,
              ),
            })),
            `${next.panes.length} ${plural(next.panes.length, 'pane')}`,
          );
        } catch (error) {
          fail(describe(error));
        }
      })();
    },
    [refreshTopology],
  );

  /**
   * Acts on a picked row.
   *
   * The sheet closes on success and stays up on failure, because closing it
   * would leave the user looking at the old Session with no idea why. Every
   * move ends with a redraw: tmux leaves padding behind whenever what it drew
   * for was a different size, and a Window switch is exactly that.
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
            // The Session switched to has never been prepared: its Window is
            // sized for whatever last attached, and its status line is on.
            await sessions.current?.prepare(id, clientTty.current);
            remoteSize.reset();
            const current = grid.current;
            if (current) remoteSize.request(current);
          } else if (kind === 'windows') {
            await client.selectWindow(sessionName.current, Number(id));
            setPicker({ open: false });
          } else {
            const windowIndex = topology?.activeWindow?.index;
            if (windowIndex === undefined) return;
            await client.selectPane(sessionName.current, windowIndex, Number(id));
            setPicker({ open: false });
          }
          // Selecting a Pane drops tmux out of zoom, and moving to another
          // Window lands on one nobody has zoomed, so the preference is
          // re-applied rather than assumed to have survived.
          await client.setZoom(sessionName.current, zoomed);
          await client.redrawClient(clientTty.current);
          await refreshTopology();
        } catch (error) {
          setPicker((previous) =>
            previous.open ? { ...previous, error: describe(error) } : previous,
          );
        }
      })();
    },
    [refreshTopology, topology?.activeWindow, zoomed, remoteSize],
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
            await client.splitWindow(
              sessionName.current,
              id === 'split-right' ? 'right' : 'down',
            );
            // A fresh split is not what the user is looking at yet, and on a
            // phone two Panes side by side are unreadable.
            await client.setZoom(sessionName.current, zoomed);
          }
          setPicker({ open: false });
          await client.redrawClient(clientTty.current);
          await refreshTopology();
        } catch (error) {
          setPicker((previous) =>
            previous.open ? { ...previous, error: describe(error) } : previous,
          );
        }
      })();
    },
    [refreshTopology, zoomed],
  );

  const changeZoom = useCallback(
    (on: boolean) => {
      setZoomed(on);
      void (async () => {
        const client = tmux.current;
        if (!client) return;
        await client.setZoom(sessionName.current, on);
        await client.redrawClient(clientTty.current);
        await refreshTopology();

        // EXPERIMENT: a scripted resize sequence, timed so an outside observer
        // can see exactly when each value lands.
        // 3s: one call. 9s: two in the same tick. 15s: four in the same tick.
        setTimeout(() => shell.current?.resize(38, 20), 3000);
        setTimeout(() => {
          shell.current?.resize(38, 21);
          shell.current?.resize(38, 20);
        }, 9000);
        setTimeout(() => {
          shell.current?.resize(38, 22);
          shell.current?.resize(38, 21);
          shell.current?.resize(38, 22);
          shell.current?.resize(38, 21);
        }, 15000);
      })();
    },
    [refreshTopology],
  );

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
          onPress: () => openPicker('windows'),
          // Nothing to pick from one Window, and an empty sheet is worse than
          // a button that plainly cannot be used. Unknown counts as something
          // to pick: the sheet re-reads on open and can say otherwise.
          disabled: !connected || (topology !== null && topology.windows.length < 2),
        },
        {
          id: 'panes',
          label: 'Panes',
          systemImage: 'rectangle.split.2x1',
          onPress: () => openPicker('panes'),
          disabled: !connected || (topology !== null && topology.panes.length < 2),
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
  }, [
    router,
    toggleKeyboard,
    keyboardVisible,
    openPicker,
    status.phase,
    topology,
  ]);

  useEffect(() => {
    // The keyboard settling is the last word on the Surface's size, and tmux
    // may have painted padding on the way there. A redraw once the frame has
    // stopped moving clears whatever it left; the resize path cannot be relied
    // on for this, because a settled size that repeats one already applied is
    // dropped as a no-op and takes its redraw with it.
    const settled = () => void tmux.current?.redrawClient(clientTty.current);
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      settled();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      settled();
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [remoteSize]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      // Connections are ephemeral by design; leaving the screen tears this
      // down and returning re-attaches, which tmux makes cheap.
      disposed.current = true;
      const openShellHandle = shell.current;
      const openConnection = connection.current;
      const preparer = sessions.current;
      shell.current = null;
      connection.current = null;
      tmux.current = null;
      sessions.current = null;
      void (async () => {
        try {
          // Hand back every Session touched this visit — switching means there
          // may be more than one — before dropping the Connection, so Muxify
          // does not leave the Host changed behind it.
          await preparer?.restoreAll();
          await openShellHandle?.close();
        } finally {
          await openConnection?.disconnect();
        }
      })();
    };
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View
        style={styles.surfaceArea}
        onLayout={({ nativeEvent }) => {
          surfaceHeight.current = nativeEvent.layout.height;
        }}>
        <TerminalView
          ref={surface}
          style={styles.surface}
          fontSize={13}
          // The library's own bar of ctrl/esc/tab/arrows above the keyboard,
          // turned off by a local patch. It was the reason ADR 0003 ruled out
          // a modifier group in the Dock, so that decision is now open again —
          // with the bar gone there are no modifier keys at all.
          accessoryBar={false}
          theme={{
            background: SurfacePalette.background,
            foreground: SurfacePalette.foreground,
            cursorColor: SurfacePalette.cursor,
          }}
          onResize={handleResize}
          onInput={handleInput}
        />
      </View>

      <PickerSheet
        title={picker.open ? PICKER_TITLES[picker.kind] : ''}
        subtitle={picker.open ? picker.subtitle : ''}
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
          picker.open && picker.kind === 'panes'
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

      <View style={styles.overlay} pointerEvents="none">
        {/* Always rendered, so its value can be asserted rather than its
            absence. `surface-grid` appears only once the Surface has reported a
            grid, so its presence is the signal that layout and `onResize`
            completed; the value is device-specific, so select on the id. */}
        <ThemedText type="code" style={styles.statusText} testID="connection-status">
          {label(status)}
        </ThemedText>
        {visibleGrid ? (
          <ThemedText type="code" style={styles.statusText} testID="surface-grid">
            {visibleGrid.cols}x{visibleGrid.rows}
          </ThemedText>
        ) : null}
      </View>

      <StatusBanner status={status} />
    </View>
  );
}

/**
 * The loud banner, shown only while something needs the user's attention. The
 * quiet always-present indicator above carries the same state for assertions.
 */
function StatusBanner({ status }: { status: Status }) {
  if (status.phase === 'connected') {
    return null;
  }

  const busy = status.phase === 'connecting' || status.phase === 'waiting-for-layout';

  return (
    <View style={styles.banner} accessibilityLabel={label(status)}>
      {busy ? <ActivityIndicator size="small" color={SurfacePalette.foreground} /> : null}
      <ThemedText type="small" style={styles.bannerText}>
        {label(status)}
      </ThemedText>
    </View>
  );
}

const EMPTY_TOPOLOGY: Topology = { windows: [], panes: [] };

/** How often terminal output may trigger a Topology re-read. */
const TOPOLOGY_REFRESH_MS = 2500;

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
const PANE_PREVIEW_LINES = 8;
const PREVIEW_COLUMNS = 46;

function previewOf(
  previews: Map<string, string[]>,
  target: string,
  maxLines: number,
): string[] {
  return trimPreview(previews.get(target) ?? [], maxLines, PREVIEW_COLUMNS);
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
      return status.exitCode === undefined
        ? 'Shell closed'
        : `Shell closed (exit ${status.exitCode})`;
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SurfacePalette.background,
  },
  surfaceArea: {
    flex: 1,
  },
  surface: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 8,
    right: 12,
    alignItems: 'flex-end',
    gap: 2,
  },
  statusText: {
    color: SurfacePalette.dim,
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
    backgroundColor: '#1e2230',
  },
  bannerText: {
    flexShrink: 1,
    color: SurfacePalette.foreground,
  },
});
