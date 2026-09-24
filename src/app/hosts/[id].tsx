import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { GlassRow } from '@/components/glass-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { connectToHost, describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord } from '@/storage/records';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient, type Session } from '@/tmux/tmux-client';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; sessions: Session[] }
  | { phase: 'failed'; message: string };

/**
 * A Host's Sessions.
 *
 * Reading them costs a whole Connection, which is dropped again once the list
 * is in hand: Connections are cheap to make and expensive to hold, and the
 * Terminal Screen opens its own anyway.
 */
export default function HostDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [host, setHost] = useState<HostRecord | undefined>();
  const [state, setState] = useState<State>({ phase: 'loading' });

  const read = useCallback(async () => {
    setState({ phase: 'loading' });
    const store = deviceHostStore();
    const records = await store.load();
    const found = records.hosts.find((candidate) => candidate.id === id);
    setHost(found);
    if (!found) {
      setState({ phase: 'failed', message: 'This Host is no longer saved.' });
      return;
    }

    try {
      const { connection, fingerprint, verdict } = await connectToHost(found, store);
      try {
        // Only a Connection that actually succeeded has vouched for the key,
        // so this is where first sight is recorded rather than in the callback.
        if (verdict.kind === 'first-sight') {
          await store.rememberFingerprint(found.id, fingerprint);
        }
        const client = new TmuxClient(sshTmuxTransport(connection), {
          tmuxExecutablePath: found.tmuxExecutablePath,
        });
        // A Host with no tmux server is a Host with no Sessions, which the
        // client already forgives — it must not read as a failure here.
        setState({ phase: 'ready', sessions: await client.listSessions() });
      } finally {
        await connection.disconnect();
      }
    } catch (error) {
      setState({ phase: 'failed', message: describeConnectionFailure(error) });
    }
  }, [id]);

  useEffect(() => {
    void read();
  }, [read]);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.list}>
        <ThemedText type="small" themeColor="textSecondary">
          {host ? `${host.address}:${host.port}` : ''}
        </ThemedText>

        {state.phase === 'loading' ? (
          <View style={styles.centred} accessibilityLabel="Reading Sessions">
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">
              Reading Sessions…
            </ThemedText>
          </View>
        ) : null}

        {state.phase === 'failed' ? (
          <ThemedText type="small" style={styles.error} testID="host-error">
            {state.message}
          </ThemedText>
        ) : null}

        {state.phase === 'ready' && state.sessions.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" testID="no-sessions">
            No tmux Sessions are running on this Host.
          </ThemedText>
        ) : null}

        {state.phase === 'ready'
          ? state.sessions.map((session) => (
              <GlassRow
                key={session.name}
                accessibilityLabel={`Session ${session.name}`}
                onPress={() =>
                  router.push({
                    pathname: '/terminal',
                    params: { hostId: id, session: session.name },
                  })
                }>
                <ThemedText type="smallBold">{session.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {`${session.windowCount} ${session.windowCount === 1 ? 'window' : 'windows'}`}
                </ThemedText>
              </GlassRow>
            ))
          : null}

        <View style={styles.actions}>
          <GlassRow accessibilityLabel="Retry" onPress={() => void read()} style={styles.action}>
            <ThemedText type="small">Retry</ThemedText>
          </GlassRow>
          <GlassRow
            accessibilityLabel="Edit Host"
            onPress={() => router.push({ pathname: '/host-form', params: { id } })}
            style={styles.action}>
            <ThemedText type="small">Edit Host</ThemedText>
          </GlassRow>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  centred: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
  },
  error: {
    color: '#ff6b6b',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
  },
});
