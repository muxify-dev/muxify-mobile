import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  controlSize,
  environment,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  listStyle,
  multilineTextAlignment,
  padding,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { ToolbarGlyphButton } from '@/components/toolbar-glyph-button';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import { readDevHost } from '@/dev/dev-host';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord } from '@/storage/records';

/**
 * The Hosts list: the app's front door.
 *
 * Re-reads on focus rather than holding state, because the form writes through
 * the store and this screen would otherwise show a Host that was just renamed
 * under its old name.
 *
 * Laid out after remux, with its own nouns: a Host here is what remux calls a
 * server, and the glossary in CONTEXT.md is the thing to keep consistent.
 */
export default function HostsScreen() {
  const router = useRouter();
  const { appearance, palette } = useSettings();
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

  const addHost = useCallback(() => router.push('/host-form'), [router]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'Muxify',
          headerLeft: () => (
            <ToolbarGlyphButton
              systemImage="gearshape"
              label="Settings"
              tint={palette.toolbarTint}
              onPress={() => router.push('/settings')}
            />
          ),
          headerRight: () => (
            <ToolbarGlyphButton
              systemImage="plus"
              label="Add Host"
              tint={palette.toolbarTint}
              onPress={addHost}
            />
          ),
        }}
      />

      {hosts === null ? null : hosts.length === 0 ? (
        <EmptyState
          appearance={appearance}
          palette={palette}
          onAddHost={addHost}
          onAddDevHost={() => void addDevHost(reload)}
        />
      ) : (
        <Host style={styles.fill} matchContents={false}>
          <List
            modifiers={[
              // See settings.tsx: SwiftUI follows the phone, not the app.
              environment('colorScheme', appearance),
              listStyle('insetGrouped'),
              scrollContentBackground('hidden'),
              background(palette.background),
              tint(palette.controlAccent),
            ]}>
            <Section modifiers={[listRowBackground(palette.rowSurface)]}>
              {hosts.map((host) => (
                <SwipeActions key={host.id}>
                  <Button
                    onPress={() =>
                      router.push({ pathname: '/hosts/[id]', params: { id: host.id } })
                    }
                    modifiers={[buttonStyle('plain'), accessibilityLabel(host.displayName)]}>
                    <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                      <Image systemName="server.rack" size={20} color={palette.rowIcon} />
                      <VStack spacing={2} alignment="leading">
                        <Text modifiers={[font({ size: 17 })]}>{host.displayName}</Text>
                        <Text
                          modifiers={[
                            font({ size: 13, design: 'monospaced' }),
                            foregroundColor(palette.secondaryLabel),
                          ]}>
                          {`${host.address}:${host.port}`}
                        </Text>
                      </VStack>
                      <Spacer />
                      <Image
                        systemName="chevron.right"
                        size={13}
                        color={palette.secondaryLabel}
                      />
                    </HStack>
                  </Button>

                  <SwipeActions.Actions>
                    <Button
                      label="Delete"
                      systemImage="trash"
                      role="destructive"
                      onPress={() => confirmRemove(host)}
                      modifiers={[accessibilityLabel(`Delete ${host.displayName}`)]}
                    />
                  </SwipeActions.Actions>
                </SwipeActions>
              ))}
            </Section>
          </List>
        </Host>
      )}
    </View>
  );
}

/** Nothing saved yet: what this app is for, and the one thing to do about it. */
function EmptyState({
  appearance,
  palette,
  onAddHost,
  onAddDevHost,
}: {
  appearance: 'light' | 'dark';
  palette: Appearance;
  onAddHost: () => void;
  onAddDevHost: () => void;
}) {
  return (
    <Host style={styles.fill} matchContents={false}>
      <VStack
        spacing={0}
        modifiers={[
          environment('colorScheme', appearance),
          frame({ maxWidth: 3000, maxHeight: 3000 }),
        ]}>
        <Spacer />

        <Image systemName="server.rack" size={64} color={palette.secondaryLabel} />

        <Text
          modifiers={[font({ size: 22, weight: 'bold' }), padding({ top: 16, bottom: 6 })]}>
          No Hosts
        </Text>

        <Text
          modifiers={[
            font({ size: 17 }),
            foregroundColor(palette.secondaryLabel),
            multilineTextAlignment('center'),
            padding({ horizontal: 40, bottom: 24 }),
          ]}>
          Add an SSH Host to start using tmux Sessions from this phone.
        </Text>

        <Button
          label="Add Host"
          systemImage="plus"
          onPress={onAddHost}
          modifiers={[
            buttonStyle('glass'),
            // The system's own large control metrics, as remux has it: a pill
            // hand-padded to look right comes out three quarters the height of
            // one that asks for the size it wants.
            controlSize('large'),
            font({ size: 17, weight: 'semibold' }),
            tint(palette.controlAccent),
            accessibilityLabel('Add Host'),
          ]}
        />

        {readDevHost().ok ? (
          <Button
            label="Add dev Host from .env.local"
            onPress={onAddDevHost}
            modifiers={[
              buttonStyle('plain'),
              font({ size: 15 }),
              foregroundColor(palette.secondaryLabel),
              padding({ top: 16 }),
              accessibilityLabel('Add dev Host'),
            ]}
          />
        ) : null}

        <Spacer />
        {/* The stack of Spacers leaves the block a little above centre, which
            is where the eye expects it when the top bar is the only chrome. */}
        <Spacer modifiers={[frame({ height: 48 })]} />
      </VStack>
    </Host>
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
});
