import { connect, type SshConnection } from '@osuki-dev/react-native-ssh';
import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock, type DockAction } from '@/components/dock';
import { PickerSheet, type PickerItem } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';
import { readDevHost } from '@/dev/dev-host';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { createResizeScheduler } from '@/tmux/resize-scheduler';
import { createSessionPreparer, type SessionPreparer } from '@/tmux/session-preparer';
import { readTopology, type Topology } from '@/tmux/topology';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient, type Pane, type Window } from '@/tmux/tmux-client';
import type { TmuxShell } from '@/tmux/transport';

/** The Surface's cell grid. Travels as a unit everywhere it is used. */
type Grid = { cols: number; rows: number };

/** What a picker is picking. One sheet serves all three. */
type PickerKind = 'sessions' | 'windows' | 'panes';

/** The sheet: closed, or open and showing whatever it has so far. */
type PickerState =
  | { open: false }
  | { open: true; kind: PickerKind; loading: boolean; items: PickerItem[]; error?: string };

type Status =
  | { phase: 'waiting-for-layout' }
  | { phase: 'connecting' }
  | { phase: 'connected'; fingerprint: string }
  | { phase: 'closed'; exitCode: number | undefined }
  | { phase: 'failed'; message: string };

export default function TerminalScreen() {
  const router = useRouter();
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
  const hasStarted = useRef(false);
  const disposed = useRef(false);

  const [status, setStatus] = useState<Status>({ phase: 'waiting-for-layout' });
  const [visibleGrid, setVisibleGrid] = useState<Grid | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ open: false });
  /** Last known Topology, for whether a picker has anything to offer. */
  const [topology, setTopology] = useState<Topology>(EMPTY_TOPOLOGY);
  /** Rendered in the Dock, so the attached Session survives a switch. */
  const [attachedSession, setAttachedSession] = useState('');

  /**
   * Owns every remote resize, so a keyboard animation cannot flood the Host
   * with Control Commands that land out of order. See createResizeScheduler.
   */
  const remoteSize = useMemo(
    () =>
      createResizeScheduler(async (next) => {
        const client = tmux.current;
        if (!client) return;
        await client.setWindowSize(sessionName.current, next);
        // A resize leaves rows tmux padded with dots and will not clean up on
        // its own, so every size change ends with a repaint. See
        // redrawClientCommand.
        await client.redrawClient(clientTty.current);
      }),
    [],
  );

  /** Re-reads the Session's Windows and Panes, for the Dock and the sheet. */
  const refreshTopology = useCallback(async (): Promise<Topology> => {
    const client = tmux.current;
    if (!client) return EMPTY_TOPOLOGY;
    const next = await readTopology(client, sessionName.current);
    setTopology(next);
    return next;
  }, []);

  const start = useCallback(async (initial: Grid) => {
    const config = readDevHost();
    if (!config.ok) {
      setStatus({ phase: 'failed', message: config.reason });
      return;
    }

    const { address, port, username, privateKeyPem } = config.host;
    setStatus({ phase: 'connecting' });

    try {
      const conn = await connect({
        host: address,
        port,
        username,
        auth: { type: 'privateKey', privateKey: privateKeyPem },
        // Ticket 13 replaces this with trust-on-first-use against a stored
        // Fingerprint. Accepting unconditionally is a spike-only shortcut.
        verifyHostKey: () => true,
        onDisconnected: (reason) => {
          if (!disposed.current) setStatus({ phase: 'failed', message: reason });
        },
      });

      if (disposed.current) {
        await conn.disconnect();
        return;
      }
      connection.current = conn;

      // Size from the latest grid, not the one captured when this started —
      // `onResize` fires more than once and the first is a pre-layout value.
      const current = grid.current ?? initial;

      // Everything tmux-shaped goes through the client, which owns command
      // construction and output parsing behind the transport seam.
      const client = new TmuxClient(sshTmuxTransport(conn));
      tmux.current = client;
      sessions.current = createSessionPreparer(client);
      sessionName.current = config.host.sessionName;
      setAttachedSession(config.host.sessionName);

      const opened = await client.attach(config.host.sessionName, current, {
        onData: (data) => {
          surface.current?.write(bytesToBase64(new Uint8Array(data)));
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
      setStatus({ phase: 'connected', fingerprint: conn.hostKey.fingerprint });

      void (async () => {
        // Ours is the Client that just attached; a redraw aimed anywhere else
        // would leave this Surface dirty.
        clientTty.current = await client.newestClient(config.host.sessionName);
        // Everything a Session needs before it can be shown on a phone: the
        // right Window size, and no status line. Switching Session runs the
        // same thing again. See createSessionPreparer.
        await sessions.current?.prepare(
          config.host.sessionName,
          grid.current ?? current,
          clientTty.current,
        );
        // Read once now so the Dock knows whether there is anything to pick
        // before the user reaches for a picker.
        await refreshTopology();
      })();

      // A resize may have landed while connecting.
      const latest = grid.current;
      if (latest && (latest.cols !== current.cols || latest.rows !== current.rows)) {
        opened.resize(latest.cols, latest.rows);
      }
    } catch (error) {
      if (!disposed.current) {
        setStatus({ phase: 'failed', message: describe(error) });
      }
    }
  }, [remoteSize, refreshTopology]);

  const handleResize = useCallback(
    ({ nativeEvent }: { nativeEvent: Grid }) => {
      const next: Grid = { cols: nativeEvent.cols, rows: nativeEvent.rows };
      grid.current = next;
      setVisibleGrid(next);

      if (shell.current) {
        // Ask the channel too — correct in principle, and it costs nothing if
        // the library ever starts sending the window-change request.
        shell.current.resize(next.cols, next.rows);
        // The resize that actually lands. See TmuxClient.setWindowSize.
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
    shell.current?.write(base64ToBytes(nativeEvent.data));
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
   * Opens a picker, reading what it lists from the Host right then.
   *
   * Muxify holds no live model of the Host — see ADR 0001 — so a sheet that
   * opened on a cached list would show Sessions that have since been killed
   * and Windows that have since been closed.
   */
  const openPicker = useCallback(
    (kind: PickerKind) => {
      setPicker({ open: true, kind, loading: true, items: [] });
      void (async () => {
        const client = tmux.current;
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
          const items =
            kind === 'sessions'
              ? sessionItems(await client.listSessions(), sessionName.current)
              : itemsFor(kind, await refreshTopology());
          setPicker((previous) =>
            previous.open && previous.kind === kind
              ? { open: true, kind, loading: false, items }
              : previous,
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
            await sessions.current?.prepare(
              id,
              grid.current ?? { cols: 80, rows: 24 },
              clientTty.current,
            );
          } else if (kind === 'windows') {
            await client.selectWindow(sessionName.current, Number(id));
            setPicker({ open: false });
            await client.redrawClient(clientTty.current);
          } else {
            const windowIndex = topology.activeWindow?.index;
            if (windowIndex === undefined) return;
            await client.selectPane(sessionName.current, windowIndex, Number(id));
            setPicker({ open: false });
            await client.redrawClient(clientTty.current);
          }
          await refreshTopology();
        } catch (error) {
          setPicker((previous) =>
            previous.open ? { ...previous, error: describe(error) } : previous,
          );
        }
      })();
    },
    [refreshTopology, topology.activeWindow],
  );

  const dockGroups: DockAction[][] = useMemo(() => {
    const connected = status.phase === 'connected';
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
          // a button that plainly cannot be used.
          disabled: !connected || topology.windows.length < 2,
        },
        {
          id: 'panes',
          label: 'Panes',
          systemImage: 'rectangle.split.2x1',
          onPress: () => openPicker('panes'),
          disabled: !connected || topology.panes.length < 2,
        },
      ],
      [
        {
          id: 'home',
          label: 'Home',
          systemImage: 'house',
          onPress: () => router.back(),
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
    topology.windows.length,
    topology.panes.length,
  ]);

  useEffect(() => {
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

      <View style={styles.surfaceArea}>
        <TerminalView
          ref={surface}
          style={styles.surface}
          fontSize={13}
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
        isPresented={picker.open}
        onDismiss={() => setPicker({ open: false })}
        loading={picker.open && picker.loading}
        error={picker.open ? picker.error : undefined}
        emptyMessage={picker.open ? PICKER_EMPTY[picker.kind] : ''}
        items={picker.open ? picker.items : []}
        onSelect={(id) => {
          if (picker.open) select(picker.kind, id);
        }}
      />

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

/** Session names as sheet rows, with the attached one marked. */
function sessionItems(names: string[], attachedSession: string): PickerItem[] {
  return names.map((name) => ({ id: name, label: name, current: name === attachedSession }));
}

function itemsFor(kind: 'windows' | 'panes', topology: Topology): PickerItem[] {
  return kind === 'windows' ? windowItems(topology.windows) : paneItems(topology.panes);
}

/** tmux addresses both by index, so the index leads the label as tmux shows it. */
function windowItems(windows: Window[]): PickerItem[] {
  return windows.map((window) => ({
    id: String(window.index),
    label: `${window.index}: ${window.name}`,
    current: window.active,
  }));
}

function paneItems(panes: Pane[]): PickerItem[] {
  return panes.map((pane) => ({
    id: String(pane.index),
    label: `${pane.index}: ${pane.command}`,
    current: pane.active,
  }));
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
