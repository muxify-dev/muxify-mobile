import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

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
import { useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { lastSnapshot } from '@/topics/host-topics';
import { tagsParam } from '@/topics/tags-param';
import { topicSeedParam } from '@/topics/topic-detail';

/** How many rows a section shows before it offers to show the rest. */
const COLLAPSED = 3;

/**
 * A Host and its Sessions.
 *
 * It draws the lists that hostScreen returns, in the order set in Settings.
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
  const topicsOn = settings.hostScreenLists.includes('topics');
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

  const open = useCallback(
    (name: string) => {
      // Always navigation. Whether anything is opened, and whether the Session
      // that is already attached is left alone, is the holder's decision — see
      // createAttachHolder.
      router.push({ pathname: '/terminal', params: { hostId: id, session: name } });
    },
    [router, id],
  );

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
  const newTopic = () => {
    const tags = lastSnapshot(topics)?.tags ?? [];
    router.push({ pathname: '/topic-form', params: { hostId: id, tags: tagsParam(tags) } });
  };
  /** With Topics on, + asks which of the two to make. With them off, it is New Session as before. */
  const onNew = () => {
    if (!topicsOn) return newSession();
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['New Session', 'New Topic', 'Cancel'], cancelButtonIndex: 2 },
      (index) => [newSession, newTopic][index]?.(),
    );
  };

  const sections = hostScreen({ settings, recent, listing, topics, opened, appearance });

  const toggleExpanded = (section: HostScreenSection['id']) =>
    setExpanded((shown) => toggled(shown, section));

  const toggleOpened = (row: OpenableRow) => setOpened((shown) => toggled(shown, row));

  const wakeFromMenu = useWakeFromMenu(id, readHost);

  const actions: RowActions = {
    onOpenSession: open,
    onOpenTopic: (row) =>
      router.push({
        pathname: '/topic',
        params: {
          hostId: id,
          topicId: row.id,
          label: row.label,
          tags: tagsParam(lastSnapshot(topics)?.tags ?? []),
          seed: topicSeedParam(row.seed),
        },
      }),
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
          headerRight: () => (
            <ToolbarActions
              palette={palette}
              onEdit={() => router.push({ pathname: '/host-form', params: { id } })}
              newLabel={topicsOn ? 'New Session or Topic' : 'New Session'}
              onNew={onNew}
            />
          ),
        }}
      />

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

/**
 * Edit and New, as one glass group — the shape iOS gives a toolbar item group.
 *
 * Plain React Native rather than a SwiftUI island, including the Symbol: a bar
 * button's glass is drawn around the width the custom view reports, and an
 * island reports its width too late, so the capsule came out clamped with the
 * plus cut off. Yoga measures these immediately.
 */
function ToolbarActions({
  palette,
  newLabel,
  onEdit,
  onNew,
}: {
  palette: Appearance;
  newLabel: string;
  onEdit: () => void;
  onNew: () => void;
}) {
  return (
    <View style={styles.toolbarGroup}>
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit Host">
        <RNText style={[styles.toolbarWord, { color: palette.toolbarTint }]}>Edit</RNText>
      </Pressable>
      <Pressable onPress={onNew} accessibilityRole="button" accessibilityLabel={newLabel}>
        <SymbolView name="plus" size={23} tintColor={palette.toolbarTint} />
      </Pressable>
    </View>
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
  toolbarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    // The glass capsule is drawn around this view's frame, so its insets are
    // this view's padding, plus a little under six points UIKit adds of its
    // own. Eight and thirty-one put the capsule within a point of the one a
    // real ToolbarItemGroup draws: 108pt wide, 13 in from the word, 35 across
    // to the plus. The trailing side measures wider than the leading one in
    // both, because the plus has more empty box around its ink than the E has.
    paddingHorizontal: 8,
    gap: 31,
  },
  toolbarWord: {
    fontSize: 17,
  },
});
