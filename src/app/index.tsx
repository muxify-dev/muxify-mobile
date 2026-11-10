import { Stack, useFocusEffect, useRouter } from 'expo-router';
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
import { HostScreenRowView, rowKey, type RowActions } from '@/components/host-screen-row-view';
import { ToolbarGlyphButton } from '@/components/toolbar-glyph-button';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import { readDevHost } from '@/dev/dev-host';
import { homeSection, type HostConnection } from '@/domain/home';
import { placeToReconnect } from '@/domain/reconnect';
import { useHostReading } from '@/hooks/use-host-reading';
import { useWakeFromMenu } from '@/hooks/use-wake-from-menu';
import { deviceSettingsStore } from '@/settings/device-settings';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import { useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { useHostEntry } from '@/hooks/use-host-entry';

/**
 * Whether this run of the app has looked for a Last Place yet. Module state
 * lives as long as the JavaScript does, so it is false only on a cold start: a
 * start from the background finds it true and stays where it was.
 */
let coldStartChecked = false;

/**
 * The dot beside a Host's name. System green and orange rather than palette
 * colours: the palette has no "ready" or "waiting", and these two are the ones
 * the phone already uses for it.
 */
const CONNECTION_DOT: Record<HostConnection, { color: string; label: string }> = {
  answered: { color: '#34c759', label: 'Connected' },
  checking: { color: '#ff9f0a', label: 'Checking' },
  refused: { color: '#ff453a', label: 'Unreachable' },
};

/**
 * Home: the app's front door. One section per Host, in the order Settings
 * gives, each with the first rows of that Host's Host Screen, so one tap
 * attaches or opens a Topic.
 *
 * Re-reads the Hosts on focus rather than holding them, because the form
 * writes through the store and this screen would otherwise show a Host that
 * was just renamed under its old name. Each section reads its own Host on
 * focus too; see ADR 0013.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { appearance, palette } = useSettings();
  const [hosts, setHosts] = useState<HostRecord[] | null>(null);

  useEffect(() => {
    if (coldStartChecked) return;
    coldStartChecked = true;
    void (async () => {
      const [settings, records] = await Promise.all([
        deviceSettingsStore().load(),
        deviceHostStore().load(),
      ]);
      const place = placeToReconnect(settings, records);
      if (!place) return;
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
  }, [router]);

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
          title: 'Muxify',
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

/**
 * One Host's section. It reads its own Host, so a Host that cannot be reached
 * waits in its own section and the others draw what they have.
 */
function HostSection({
  host,
  appearance,
  palette,
}: {
  host: HostRecord;
  appearance: 'light' | 'dark';
  palette: Appearance;
}) {
  const router = useRouter();
  const { settings } = useSettings();
  const topicsOn = settings.hostScreenLists.includes('topics');
  const { listing, topics, read } = useHostReading(host.id, topicsOn);
  const [recent, setRecent] = useState<RecentSession[]>([]);
  // Frozen per visit, as the Host Screen does: "2 hr ago" must not renumber
  // itself under the user's thumb.
  const [openedAt] = useState(() => new Date());
  const attach = useCurrentAttach();
  const attachState = useAttachState(attach);
  const attachedHere = attach?.hostId === host.id && attachState ? attachState : null;

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setRecent(await deviceHostStore().recentSessionsFor(host.id));
        await read();
      })();
    }, [host.id, read]),
  );

  const section = homeSection(host, {
    settings,
    recent,
    listing,
    topics,
    opened: NOTHING_OPENED,
    appearance,
  });

  const wakeFromMenu = useWakeFromMenu(host.id, read);

  const openHostScreen = () =>
    router.push({ pathname: '/hosts/[id]', params: { id: host.id } });

  const entered = useCallback(() => router.push('/terminal'), [router]);
  const hostEntry = useHostEntry(host.id, entered);
  const actions: RowActions = {
    onOpenSession: hostEntry.openSession,
    onOpenTopic: (row) => hostEntry.openTopic(row.seed),
    busyTopic: hostEntry.busyTopic,
    onWake: (row, wake) => wakeFromMenu(row.id, wake),
    // The Bench and No Topic open in place on the Host Screen, which Home has
    // no room for.
    onToggle: openHostScreen,
    onRetry: () => void read(),
  };

  const dot = CONNECTION_DOT[section.connection];

  return (
    <Section
      header={
        <HStack spacing={8} modifiers={[frame({ maxWidth: 3000 })]}>
          <Image
            systemName="circle.fill"
            size={9}
            color={dot.color}
            modifiers={[accessibilityLabel(dot.label)]}
          />
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.sectionHeader)]}>
            {host.displayName}
          </Text>
          <Spacer />
          <Button
            label="All ›"
            onPress={openHostScreen}
            modifiers={[
              buttonStyle('plain'),
              font({ size: 15 }),
              accessibilityLabel(`All of ${host.displayName}`),
            ]}
          />
        </HStack>
      }
      modifiers={[listRowBackground(palette.rowSurface)]}>
      {section.rows.map((row, index) => (
        <HostScreenRowView
          // Flattened from several lists, which may each have a note or a
          // checking row of their own.
          key={`${index}:${rowKey(row, index)}`}
          row={row}
          palette={palette}
          openedAt={openedAt}
          attached={
            row.kind === 'recent' && attachedHere?.sessionName === row.name
              ? attachedHere.phase
              : undefined
          }
          actions={actions}
        />
      ))}
    </Section>
  );
}

const NOTHING_OPENED: ReadonlySet<never> = new Set();

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
