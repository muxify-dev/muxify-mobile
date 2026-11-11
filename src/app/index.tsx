import { Stack, useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
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
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { ToolbarGlyphButton } from '@/components/toolbar-glyph-button';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import { readDevHost } from '@/dev/dev-host';
import { placeToReconnect } from '@/domain/reconnect';
import { deviceSettingsStore } from '@/settings/device-settings';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord } from '@/storage/records';

/**
 * Whether this run of the app has looked for a Last Place yet. Module state
 * lives as long as the JavaScript does, so it is false only on a cold start: a
 * start from the background finds it true and stays where it was.
 */
let coldStartChecked = false;

export default function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { appearance, palette } = useSettings();
  const [hosts, setHosts] = useState<HostRecord[] | null>(null);

  useEffect(() => {
    if (coldStartChecked) return;
    coldStartChecked = true;
    if (!navigation.isFocused()) return;
    void (async () => {
      const [settings, records] = await Promise.all([
        deviceSettingsStore().load(),
        deviceHostStore().load(),
      ]);
      const place = placeToReconnect(settings, records);
      if (!place || !navigation.isFocused()) return;
      // Pushed in the order Back walks them, so the Terminal Screen has the
      // Host Screen and then Home under it, as if tapped to.
      router.push({ pathname: '/hosts/[id]', params: { id: place.hostId } });
      router.push({
        pathname: '/terminal',
        params: {
          hostId: place.hostId,
          session: place.session,
          ...(place.topicId ? { topicId: place.topicId } : {}),
          reconnect: '1',
        },
      });
    })();
  }, [router, navigation]);

  const reload = useCallback(async () => {
    const records = await deviceHostStore().load();
    setHosts(records.hosts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'Hosts',
          headerLeft: () => (
            <ToolbarGlyphButton
              systemImage="gearshape"
              label="Settings"
              tint={palette.toolbarTint}
              onPress={() => router.push('/settings')}
            />
          ),
        }}
      />

      {hosts === null ? null : hosts.length === 0 ? (
        <EmptyState
          appearance={appearance}
          palette={palette}
          onAddHost={() => router.push('/host-form')}
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
            {hosts.map((host) => (
              <HostSection key={host.id} host={host} appearance={appearance} palette={palette} />
            ))}
          </List>
        </Host>
      )}
    </View>
  );
}

function HostSection({ host, palette }: {
  host: HostRecord;
  appearance: 'light' | 'dark';
  palette: Appearance;
}) {
  const router = useRouter();
  return (
    <Section modifiers={[listRowBackground(palette.rowSurface)]}>
      <Button
        onPress={() => router.push({ pathname: '/hosts/[id]', params: { id: host.id } })}
        modifiers={[buttonStyle('plain'), accessibilityLabel(`Host ${host.displayName}`)]}>
        <HStack spacing={12} modifiers={[padding({ vertical: 12 }), frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
          <Image systemName="server.rack" size={22} color={palette.controlAccent} />
          <VStack alignment="leading" spacing={4}>
            <Text modifiers={[font({ size: 17, weight: 'semibold' }), foregroundColor(palette.toolbarTint)]}>{host.displayName}</Text>
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>{host.address}</Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
        </HStack>
      </Button>
    </Section>
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
