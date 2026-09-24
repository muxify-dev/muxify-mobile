import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GlassRow } from '@/components/glass-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { readDevHost } from '@/dev/dev-host';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord } from '@/storage/records';

/**
 * The Hosts list: the app's front door.
 *
 * Re-reads on focus rather than holding state, because the form writes through
 * the store and this screen would otherwise show a Host that was just renamed
 * under its old name.
 */
export default function HostsScreen() {
  const router = useRouter();
  const [hosts, setHosts] = useState<HostRecord[] | null>(null);

  const reload = useCallback(async () => {
    const records = await deviceHostStore().load();
    setHosts(records.hosts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const confirmRemove = useCallback(
    (host: HostRecord) => {
      Alert.alert(`Delete ${host.displayName}?`, 'Its stored credential goes with it.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deviceHostStore().removeHost(host.id);
              await reload();
            })();
          },
        },
      ]);
    },
    [reload],
  );

  if (hosts === null) return <ThemedView style={styles.fill} />;

  if (hosts.length === 0) {
    return (
      <ThemedView style={styles.centred}>
        <ThemedText type="subtitle">No Hosts yet</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.blurb}>
          Add an SSH Host to start attaching to tmux Sessions from this phone.
        </ThemedText>
        <GlassRow
          accessibilityLabel="Add Host"
          onPress={() => router.push('/host-form')}
          style={styles.button}>
          <ThemedText type="smallBold">Add Host</ThemedText>
        </GlassRow>
        {readDevHost().ok ? (
          <Pressable
            onPress={() => void addDevHost(reload)}
            accessibilityRole="button"
            accessibilityLabel="Add dev Host">
            <ThemedText type="small" themeColor="textSecondary">
              Add dev Host from .env.local
            </ThemedText>
          </Pressable>
        ) : null}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.list}>
        {hosts.map((host) => (
          <GlassRow
            key={host.id}
            accessibilityLabel={host.displayName}
            onPress={() => router.push({ pathname: '/hosts/[id]', params: { id: host.id } })}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="smallBold">{host.displayName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {`${host.address}:${host.port}`}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => confirmRemove(host)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${host.displayName}`}
                hitSlop={10}>
                <ThemedText type="small" style={styles.delete}>
                  Delete
                </ThemedText>
              </Pressable>
            </View>
          </GlassRow>
        ))}

        <GlassRow
          accessibilityLabel="Add Host"
          onPress={() => router.push('/host-form')}
          style={styles.button}>
          <ThemedText type="smallBold">Add Host</ThemedText>
        </GlassRow>
      </ScrollView>
    </ThemedView>
  );
}

/**
 * Saves the Host described by .env.local, so a development machine can be
 * reached without typing a private key into a phone. It writes an ordinary
 * record through the ordinary store — everything after this is the same code
 * any Host uses.
 */
async function addDevHost(reload: () => Promise<void>): Promise<void> {
  const config = readDevHost();
  if (!config.ok) return;
  await deviceHostStore().saveHost({
    host: { displayName: 'Dev Host', address: config.host.address, port: config.host.port },
    identity: { username: config.host.username, kind: 'privateKey' },
    credential: config.host.privateKeyPem,
  });
  await reload();
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  blurb: {
    textAlign: 'center',
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  delete: {
    color: '#ff6b6b',
  },
  button: {
    alignItems: 'center',
  },
});
