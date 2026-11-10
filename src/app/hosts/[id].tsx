import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  Section,
  Spacer,
  SwipeActions,
  Text,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  environment,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import {
  HostScreenRowView,
  rowKey,
  type RowActions,
} from '@/components/host-screen-row-view';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { SectionHeader } from '@/components/section-header';
import type { Appearance } from '@/constants/app-theme';
import {
  hostScreen,
  type HostScreenRow,
  type HostScreenSection,
  type OpenableRow,
} from '@/domain/host-screen';
import { useHostReading } from '@/hooks/use-host-reading';
import { useWakeFromMenu } from '@/hooks/use-wake-from-menu';
import { toggled } from '@/lib/toggled';
import { useHostLists, useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { hostCreationOrder } from '@/settings/settings';
import { useHostEntry } from '@/hooks/use-host-entry';

/** How many rows a section shows before it offers to show the rest. */
const COLLAPSED = 3;

/**
 * A Host and its Sessions.
 *
 * It draws the lists that hostScreen returns, in the order chosen for this Host.
 *
 * What is remembered is on screen before the Host is even dialled, and the
 * Host's own answer arrives underneath a moment later. A Host you cannot reach
 * is exactly when you most want to see what you had open on it.
 */
export default function HostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, appearance, palette } = useSettings();

  const [host, setHost] = useState<HostRecord | undefined>();
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [opened, setOpened] = useState<ReadonlySet<OpenableRow>>(new Set());
  const lists = useHostLists(id);
  const topicsOn = lists.includes('topics');
  const { listing, topics, read: readHost } = useHostReading(id, topicsOn);
  const [expanded, setExpanded] = useState<ReadonlySet<HostScreenSection['id']>>(new Set());
  // Frozen per visit: "2 hr ago" must not renumber itself under the user's
  // thumb, and the screen is short-lived enough that it will not go stale.
  const [openedAt] = useState(() => new Date());

  /**
   * Which Session, if any, this phone is attached to right now.
   *
   * A Connection is the app's and not a screen's, so this screen is a *reader*
   * of it: the row for an attached Session says what it is doing and offers to
   * end it, and tapping it goes back to the Terminal Screen without touching
   * the Connection. See ADR 0007.
   */
  const holder = useAttachHolder();
  const attach = useCurrentAttach();
  const attachState = useAttachState(attach);
  const attachedHere =
    attach && attach.hostId === id && attachState ? attachState : null;

  const readRecords = useCallback(async () => {
    const store = deviceHostStore();
    const records = await store.load();
    setHost(records.hosts.find((candidate) => candidate.id === id));
    setRecent(await store.recentSessionsFor(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await readRecords();
        await readHost();
      })();
    }, [readRecords, readHost]),
  );

  const entered = useCallback(() => router.push('/terminal'), [router]);
  const hostEntry = useHostEntry(id, entered);

  const disconnect = useCallback(() => {
    void holder.disconnect();
  }, [holder]);

  const forget = useCallback(
    (name: string) => {
      void (async () => {
        await deviceHostStore().forgetSession(id, name);
        await readRecords();
      })();
    },
    [id, readRecords],
  );

  const newSession = () => router.push({ pathname: '/session-form', params: { hostId: id } });
  const newTopic = () => router.push({ pathname: '/topic-form', params: { hostId: id } });

  const sections = hostScreen({ settings: { ...settings, hostScreenLists: lists }, recent, listing, topics, opened, appearance });

  const toggleExpanded = (section: HostScreenSection['id']) =>
    setExpanded((shown) => toggled(shown, section));

  const toggleOpened = (row: OpenableRow) => setOpened((shown) => toggled(shown, row));

  const wakeFromMenu = useWakeFromMenu(id, readHost);

  const actions: RowActions = {
    onOpenSession: hostEntry.openSession,
    onOpenTopic: (row) => hostEntry.openTopic(row.seed),
    busyTopic: hostEntry.busyTopic,
    onWake: (row, wake) => wakeFromMenu(row.id, wake),
    onToggle: toggleOpened,
    onRetry: () => void readHost(),
  };

  const renderRow = (row: HostScreenRow, index: number) => {
    const key = rowKey(row, index);
    if (row.kind !== 'recent') {
      return (
        <HostScreenRowView
          key={key}
          row={row}
          palette={palette}
          openedAt={openedAt}
          actions={actions}
        />
      );
    }
    const attached = attachedHere?.sessionName === row.name;
    return (
      <SwipeActions key={key}>
        <HostScreenRowView
          row={row}
          palette={palette}
          openedAt={openedAt}
          attached={attached ? attachedHere.phase : undefined}
          actions={actions}
        />
        <SwipeActions.Actions>
          {/* First, so a full swipe on the attached row ends the Connection:
              on that row it is the verb being reached for, and Forget is the
              odd one. Red because it ends something, unlike Forget beside it.
              Here rather than in the row, where a red word sat beside the
              phase and read as part of the status. */}
          {attached ? (
            <Button
              label="Disconnect"
              systemImage="bolt.slash"
              role="destructive"
              onPress={disconnect}
              // Said outright, because the Form's own tint reaches in here and
              // paints the role's red over in accent.
              modifiers={[tint(palette.destructive), accessibilityLabel(`Disconnect ${row.name}`)]}
            />
          ) : null}
          {/* Not destructive, and deliberately not red: this drops Muxify's
              memory of the Session and leaves it running. */}
          <Button
            label="Forget"
            systemImage="minus.circle"
            onPress={() => forget(row.name)}
            modifiers={[accessibilityLabel(`Forget ${row.name}`)]}
          />
        </SwipeActions.Actions>
      </SwipeActions>
    );
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: host?.displayName ?? 'Host',
        }}
      />

      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Host Options">
          <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
          {hostCreationOrder(lists).map((kind) => <Stack.Toolbar.MenuAction
            key={kind}
            icon={kind === 'sessions' ? 'terminal' : 'folder.badge.plus'}
            onPress={kind === 'sessions' ? newSession : newTopic}>
            {kind === 'sessions' ? 'New Session' : 'New Topic'}
          </Stack.Toolbar.MenuAction>)}
          <Stack.Toolbar.MenuAction icon="list.bullet" onPress={() => router.push({ pathname: '/host-lists', params: { hostId: id } })}>
            Configure panels
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            // See settings.tsx: SwiftUI follows the phone, not the app.
            environment('colorScheme', appearance),
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
          ]}>
          {sections.map((section) => (
            <Section
              key={section.id}
              header={
                section.title === null ? undefined : (
                  <SectionHeader palette={palette}>{section.title}</SectionHeader>
                )
              }
              footer={
                section.footer === null ? undefined : (
                  <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                    {section.footer}
                  </Text>
                )
              }
              modifiers={[listRowBackground(palette.rowSurface)]}>
              {(collapsible(section)
                ? collapse(section.rows, expanded.has(section.id))
                : section.rows
              ).map(renderRow)}
              {collapsible(section) && section.rows.length > COLLAPSED ? (
                <DisclosureRow
                  palette={palette}
                  expanded={expanded.has(section.id)}
                  onPress={() => toggleExpanded(section.id)}
                />
              ) : null}
            </Section>
          ))}
        </Form>
      </Host>
    </View>
  );
}


/** The row at the foot of a section that has more to show. */
function DisclosureRow({
  palette,
  expanded,
  onPress,
}: {
  palette: Appearance;
  expanded: boolean;
  onPress: () => void;
}) {
  const label = expanded ? 'Show fewer' : 'Show more';
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}>
      <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
        <Image
          systemName={expanded ? 'chevron.up' : 'chevron.down'}
          size={15}
          color={palette.controlAccent}
        />
        <Text modifiers={[font({ size: 17 }), foregroundColor(palette.controlAccent)]}>{label}</Text>
        <Spacer />
      </HStack>
    </Button>
  );
}

/** Only the Sessions sections fold: the Topics sections keep the Mac's whole layout. */
function collapsible(section: HostScreenSection): boolean {
  return section.id === 'recent' || section.id === 'sessions';
}

function collapse<T>(items: T[], expanded: boolean): T[] {
  return expanded ? items : items.slice(0, COLLAPSED);
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
