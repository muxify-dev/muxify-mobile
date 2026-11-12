import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

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

import { FillPlaceSheet } from '@/components/fill-place-sheet';
import {
  HostScreenRowView,
  rowKey,
  type MoveRole,
  type RowActions,
  type TopicRow,
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
import { fillChoices, moveTargetLabel, moveTargets, type MoveTarget } from '@/domain/host-screen-move';
import { useHostReading } from '@/hooks/use-host-reading';
import { useTopicActionFromMenu } from '@/hooks/use-topic-action-from-menu';
import { useTopicDrop } from '@/hooks/use-topic-drop';
import { useWakeFromMenu } from '@/hooks/use-wake-from-menu';
import { toggled } from '@/lib/toggled';
import { useHostLists, useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { hostCreationOrder } from '@/settings/settings';
import type { TopicId } from '@/topics/environment';
import {
  SWIPE_LABEL,
  swipeAction,
  TOPIC_ACTION_ICON,
  TOPIC_ACTION_LABEL,
} from '@/topics/topic-action';
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
  /** The Topic card the user moves: picked from its menu, until a target or Cancel is tapped. */
  const [moving, setMoving] = useState<TopicId | null>(null);
  /** The Open Place the user fills: tapped, until a Topic is picked or the sheet is closed. */
  const [filling, setFilling] = useState<string | null>(null);

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

  const input = { settings: { ...settings, hostScreenLists: lists }, recent, listing, topics, appearance };
  // A move opens the Bench: a card cannot go where the list hides it.
  const movingSections = moving === null ? [] : hostScreen({ ...input, opened: new Set([...opened, 'bench']) });
  // A Listing read during the move can drop the picked card, and the move ends with it.
  const picked = movingSections
    .flatMap((section) => section.rows)
    .find((row): row is TopicRow => row.kind === 'topic' && row.id === moving);
  const targets = picked === undefined ? null : moveTargets(movingSections, picked.id);
  const sections = targets === null ? hostScreen({ ...input, opened }) : movingSections;
  // The Benched Topics are choices even while the Bench row is closed. A Listing read while the sheet is open can fill the place, and the sheet closes with it.
  const choices = filling === null ? null : fillChoices(hostScreen({ ...input, opened: new Set([...opened, 'bench']) }), filling);

  const toggleExpanded = (section: HostScreenSection['id']) =>
    setExpanded((shown) => toggled(shown, section));

  const toggleOpened = (row: OpenableRow) => setOpened((shown) => toggled(shown, row));

  const wakeFromMenu = useWakeFromMenu(id, readHost);
  const actFromMenu = useTopicActionFromMenu(id, readHost);

  const dropOnHost = useTopicDrop(id, readHost);
  const startMove = (row: TopicRow) => {
    setMoving(row.id);
    // The targets come from the newest Listing, not from the one the menu was opened on.
    void readHost();
  };
  const sendMove = (topic: TopicId, target: MoveTarget) => {
    setMoving(null);
    void (target.kind === 'drop' ? dropOnHost(topic, target.drop) : actFromMenu(topic, target.action));
  };

  const fillPlace = (topic: TopicRow) => {
    if (choices === null) return;
    setFilling(null);
    void dropOnHost(topic.id, { kind: 'fill', place: choices.place });
  };

  const askSettle = (row: TopicRow) =>
    Alert.alert(`Settle ${row.label}?`, 'Settle keeps its Sessions running. Its Worktrees stay in both cases.', [
      { text: TOPIC_ACTION_LABEL.settle, onPress: () => void actFromMenu(row.id, 'settle') },
      {
        text: TOPIC_ACTION_LABEL['settle-stopping-sessions'],
        style: 'destructive',
        onPress: () => void actFromMenu(row.id, 'settle-stopping-sessions'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const actions: RowActions = {
    onOpenSession: hostEntry.openSession,
    onOpenTopic: (row) => hostEntry.openTopic(row.seed),
    busyTopic: hostEntry.busyTopic,
    onWake: (row, wake) => wakeFromMenu(row.id, wake),
    onTopicAction: (row, action) => void actFromMenu(row.id, action),
    onMove: startMove,
    onSettle: askSettle,
    onFillPlace: (row) => {
      setFilling(row.id);
      // The choices and the place's number come from the newest Listing, not from the one on screen.
      void readHost();
    },
    onToggle: toggleOpened,
    onRetry: () => void readHost(),
  };

  // While a card moves, a tap does not leave the screen, and no row has a menu or a swipe.
  const movingActions: RowActions = {
    onOpenSession: () => {},
    onOpenTopic: () => {},
    onToggle: toggleOpened,
    onRetry: actions.onRetry,
  };

  const moveRole = (row: HostScreenRow): MoveRole => {
    if (picked === undefined || targets === null) return { kind: 'none' };
    if (row === picked) return { kind: 'picked' };
    const target = targets.rows.get(row);
    return target === undefined
      ? { kind: 'none' }
      : { kind: 'target', label: moveTargetLabel(target), onPress: () => sendMove(picked.id, target) };
  };

  const renderRow = (row: HostScreenRow, index: number) => {
    const key = rowKey(row, index);
    if (targets !== null) {
      return (
        <HostScreenRowView
          key={key}
          row={row}
          palette={palette}
          openedAt={openedAt}
          actions={movingActions}
          move={moveRole(row)}
        />
      );
    }
    if (row.kind === 'topic') {
      const swipe = swipeAction(row.mark);
      if (swipe !== null) {
        return (
          <SwipeActions key={key}>
            <HostScreenRowView row={row} palette={palette} openedAt={openedAt} actions={actions} />
            <SwipeActions.Actions allowsFullSwipe={swipe === 'mark-read'}>
              <Button
                label={SWIPE_LABEL[swipe]}
                systemImage={TOPIC_ACTION_ICON[swipe]}
                onPress={() => void actFromMenu(row.id, swipe)}
                modifiers={[accessibilityLabel(`${TOPIC_ACTION_LABEL[swipe]} ${row.label}`)]}
              />
            </SwipeActions.Actions>
          </SwipeActions>
        );
      }
    }
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
          title: picked === undefined ? (host?.displayName ?? 'Host') : `Moving ${picked.label}`,
        }}
      />

      <Stack.Toolbar placement="right">
        {targets === null ? null : (
          <Stack.Toolbar.Button accessibilityLabel="Cancel Move" onPress={() => setMoving(null)}>
            Cancel
          </Stack.Toolbar.Button>
        )}
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
                  <SectionTitle
                    title={section.title}
                    palette={palette}
                    target={targets?.headers.get(section.id)}
                    onPress={(target) => picked !== undefined && sendMove(picked.id, target)}
                  />
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
      <FillPlaceSheet choices={choices} onPick={fillPlace} onDismiss={() => setFilling(null)} />
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

/** A section's title, with the move target that sits on it, such as Make a Guest on the Guests header. */
function SectionTitle({
  title,
  palette,
  target,
  onPress,
}: {
  title: string;
  palette: Appearance;
  target: MoveTarget | undefined;
  onPress: (target: MoveTarget) => void;
}) {
  if (target === undefined) return <SectionHeader palette={palette}>{title}</SectionHeader>;
  const label = moveTargetLabel(target);
  return (
    <HStack>
      <SectionHeader palette={palette}>{title}</SectionHeader>
      <Spacer />
      <Button
        label={label}
        onPress={() => onPress(target)}
        modifiers={[buttonStyle('bordered'), accessibilityLabel(label)]}
      />
    </HStack>
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
