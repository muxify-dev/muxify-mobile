import { connect, type SshConnection } from '@osuki-dev/react-native-ssh';
import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';

import { Dock, type DockAction } from '@/components/dock';
import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';
import { readDevHost } from '@/dev/dev-host';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient } from '@/tmux/tmux-client';
import type { TmuxShell } from '@/tmux/transport';

/** The Surface's cell grid. Travels as a unit everywhere it is used. */
type Grid = { cols: number; rows: number };

type Status =
  | { phase: 'waiting-for-layout' }
  | { phase: 'connecting' }
  | { phase: 'connected'; fingerprint: string }
  | { phase: 'closed'; exitCode: number | undefined }
  | { phase: 'failed'; message: string };

export default function TerminalScreen() {
  const router = useRouter();
  const surface = useRef<TerminalViewRef>(null);
  const connection = useRef<SshConnection | null>(null);
  const shell = useRef<TmuxShell | null>(null);
  const tmux = useRef<TmuxClient | null>(null);
  const sessionName = useRef<string>('');
  /** The Session's own status setting, restored when we detach. */
  const originalStatusLine = useRef<string | undefined>(undefined);
  const grid = useRef<Grid | null>(null);
  const hasStarted = useRef(false);
  const disposed = useRef(false);

  const [status, setStatus] = useState<Status>({ phase: 'waiting-for-layout' });
  const [visibleGrid, setVisibleGrid] = useState<Grid | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

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
      sessionName.current = config.host.sessionName;

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

      // Bring the remote to the Surface's real size immediately on attach, and
      // hide tmux's status line — the Dock already shows Session, Window and
      // Pane, and a phone has no rows to spare.
      void (async () => {
        await client.setWindowSize(config.host.sessionName, grid.current ?? current);
        originalStatusLine.current = await client.readStatusLine(config.host.sessionName);
        await client.setStatusLine(config.host.sessionName, 'off');
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
  }, []);

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
        void tmux.current?.setWindowSize(sessionName.current, next);
        return;
      }

      if (!hasStarted.current) {
        hasStarted.current = true;
        void start(next);
      }
    },
    [start],
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

  const dockGroups: DockAction[][] = useMemo(
    () => [
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
          systemImage: keyboardVisible
            ? 'keyboard.chevron.compact.down'
            : 'keyboard',
          onPress: toggleKeyboard,
        },
      ],
    ],
    [router, toggleKeyboard, keyboardVisible],
  );

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
      const client = tmux.current;
      const session = sessionName.current;
      const restoreTo = originalStatusLine.current;
      shell.current = null;
      connection.current = null;
      tmux.current = null;
      void (async () => {
        try {
          // Put the Session's status line back before dropping the Connection,
          // so Muxify does not leave the Host changed behind it.
          if (client && session && restoreTo !== undefined) {
            await client.setStatusLine(session, restoreTo);
          }
          await openShellHandle?.close();
        } finally {
          await openConnection?.disconnect();
        }
      })();
    };
  }, []);

  return (
    <View style={styles.container}>
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
