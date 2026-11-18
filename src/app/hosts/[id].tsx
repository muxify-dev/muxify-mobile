import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import {
  Button,
  Form,
  Host,
  HStack,
  Picker,
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
  environment,
  listRowBackground,
  padding,
  pickerStyle,
  scrollContentBackground,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { placeTabRoute } from '@/browser/place-tab-route';
import { FillPlaceSheet } from '@/components/fill-place-sheet';
import { GoToList, type FolderRow } from '@/components/go-to-list';
import {
  HostScreenRowView,
  rowKey,
  type MoveRole,
  type RowActions,
  type TopicRow,
} from '@/components/host-screen-row-view';
import type { RenameParams } from '@/app/rename';
import { HostWriteRow } from '@/components/host-write-row';
import { TabSwipe } from '@/components/tab-swipe';
import { SectionHeader } from '@/components/section-header';
import type { Appearance } from '@/constants/app-theme';
import { hostProblemWords } from '@/domain/cover';
import { goToRows, pathOpening, type GoToMode, type GoToRow } from '@/domain/go-to';
import {
  firstReadAnswered,
  hostScreen,
  hostScreenTabs,
  runningSessions,
  tabOnShow,
  type HostScreenInput,
  type HostScreenRow,
  type HostScreenSection,
  type HostScreenTab,
  type OpenableRow,
  type SessionRow,
} from '@/domain/host-screen';
import { fillChoices, moveTargetLabel, moveTargets, type MoveTarget } from '@/domain/host-screen-move';
import { useGoToPaths } from '@/hooks/use-go-to-paths';
import { useGoToPick } from '@/hooks/use-go-to-pick';
import { useHostEntry } from '@/hooks/use-host-entry';
import { useHostListing } from '@/hooks/use-host-listing';
import { useTmuxWrites } from '@/hooks/use-tmux-writes';
import { useTopicCardWrites } from '@/hooks/use-topic-card-writes';
import { takeGoToRequest } from '@/keyboard/go-to-request';
import { useScreenKeyboardShortcuts } from '@/keyboard/key-commands';
import { toggled } from '@/lib/toggled';
import { useBackSwipe } from '@/navigation/use-back-swipe';
import { useSettings } from '@/settings/settings-context';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, PlaceTab, RecentSession } from '@/storage/records';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import type { TopicId } from '@/topics/environment';
import { lastSnapshot } from '@/topics/host-topics';
import {
  closeAlert,
  SWIPE_LABEL,
  swipeAction,
  TOPIC_ACTION_ICON,
  TOPIC_ACTION_LABEL,
  type TopicAction,
} from '@/topics/topic-action';
import type { Drop } from '@/topics/topic-drop';
import type { SessionAction } from '@/topics/tmux-order';
import { recordVisit } from '@/topics/visit';

const TAB_NAMES: Record<HostScreenTab, string> = { topics: 'Topics', sessions: 'Sessions' };

/**
 * A Host: its Topics or its Sessions, as the Mac's Sidebar shows them, and
 * Go to in the bar at the bottom.
 *
 * It draws the tab that hostScreen returns. While the Go to field has the
 * keys, the Go to list stands in place of the tab.
 */
export default function HostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, appearance, palette, rememberHostScreenTab } = useSettings();

  const [host, setHost] = useState<HostRecord | undefined>();
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [opened, setOpened] = useState<ReadonlySet<OpenableRow>>(new Set());
  const { listing, topics, sessionsOnly, problem, retry: retryHost } = useHostListing(id);
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
      void readRecords();
    }, [readRecords]),
  );

  const tabs = hostScreenTabs(topics);
  const tab = tabOnShow(settings.hostScreenTabs?.[id], tabs);
  const switchTab = () => rememberHostScreenTab(id, tabs[(tabs.indexOf(tab) + 1) % tabs.length]!);
  // A Host Server serves Go to. Without it, New Session is in the Options
  // menu, and in Sessions only there is no New Topic.
  const hasGoTo = !sessionsOnly && lastSnapshot(topics) !== null;

  // Null while the Go to field does not have the keys.
  const [goTo, setGoTo] = useState<GoToMode | null>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const search = useRef<SearchBarCommands>(null);
  // Frozen: "2 hr ago" must not change under the user's thumb.
  const [listedAt] = useState(() => new Date());
  const { paths, reading, ask } = useGoToPaths(id, hasGoTo, goTo !== null && query.trim() === '');
  useFocusEffect(useCallback(() => {
    if (hasGoTo) ask('');
  }, [hasGoTo, ask]));

  const closeGoTo = useCallback(() => {
    search.current?.cancelSearch();
    setGoTo(null);
    setQuery('');
    setHighlighted(0);
  }, []);
  const entered = useCallback((tab: PlaceTab | null) => {
    closeGoTo();
    // A Topic Place with a Tab: the page, in the Terminal Screen's place.
    router.push(tab ? placeTabRoute(tab) : '/terminal');
  }, [closeGoTo, router]);
  const hostEntry = useHostEntry(id, entered);
  const pick = useGoToPick(id, useCallback(() => entered(null), [entered]));

  const sessions = useMemo(() => runningSessions(listing, topics) ?? [], [listing, topics]);
  const rows = goTo === null ? [] : goToRows({
    query,
    mode: goTo,
    sessions: sessions.map(({ name, topicLabel }) => ({ name, topicLabel: topicLabel ?? null })),
    paths,
    recent,
  });
  const onShow = Math.min(highlighted, Math.max(rows.length - 1, 0));

  const openFolder = (row: FolderRow, another: boolean) => {
    const opening = pathOpening(row, sessions.map((session) => session.name), another || goTo === 'paths');
    if (opening.kind === 'new') {
      pick.make(opening);
      return;
    }
    if (host) recordVisit(host, opening.directory);
    hostEntry.openSession(opening.session);
  };
  const pickRow = (row: GoToRow | undefined, another = false) => {
    if (row === undefined || pick.write.kind === 'running') return;
    if (row.kind === 'session') hostEntry.openSession(row.name);
    else openFolder(row, another);
  };

  const disconnect = useCallback(() => {
    void holder.disconnect();
  }, [holder]);

  const newTopic = () => router.push({ pathname: hasGoTo ? '/new-topic' : '/topic-form', params: { hostId: id } });
  const newSessionAtFolder = () => {
    setGoTo('paths');
    search.current?.focus();
  };

  const input: Omit<HostScreenInput, 'opened'> = {
    tab,
    listing,
    topics,
    attach: attachedHere === null ? null : { sessionName: attachedHere.sessionName, topic: attachedHere.topic?.id ?? null },
    appearance,
    problem: problem === null ? null : hostProblemWords(problem, host?.displayName ?? 'the Host'),
  };
  // A move opens the Bench: a card cannot go where the list hides it.
  const movingSections = moving === null ? [] : hostScreen({ ...input, opened: new Set([...opened, 'bench']) });
  // A Listing pushed during the move can drop the picked card, and the move ends with it.
  const picked = movingSections
    .flatMap((section) => section.rows)
    .find((row): row is TopicRow => row.kind === 'topic' && row.id === moving);
  const targets = picked === undefined ? null : moveTargets(movingSections, picked.id);
  const sections = targets === null ? hostScreen({ ...input, opened }) : movingSections;
  // The Benched Topics are choices even while the Bench row is closed. A Listing pushed while the sheet is open can fill the place, and the sheet closes with it.
  const choices = filling === null ? null : fillChoices(hostScreen({ ...input, opened: new Set([...opened, 'bench']) }), filling);
  // The bar mounts again each time this screen comes back. The Go to field
  // that expo-router puts back in the toolbar after a push and a pop no longer
  // takes a tap, and a new field does.
  const barShown = useIsFocused() && hasGoTo && targets === null && filling === null;
  // ⌘P in the Terminal asks for Go to here, and the field takes it once the bar is back.
  useEffect(() => {
    if (barShown && takeGoToRequest(id)) search.current?.focus();
  }, [barShown, id]);

  useScreenKeyboardShortcuts({
    ...(barShown ? { 'go-to': () => search.current?.focus(), 'new-topic': newTopic } : {}),
    ...(tabs.length > 1 && goTo === null && targets === null ? { 'switch-tab': switchTab } : {}),
    ...(goTo === null ? {} : {
      'list-up': () => setHighlighted(Math.max(onShow - 1, 0)),
      'list-down': () => setHighlighted(Math.min(onShow + 1, rows.length - 1)),
      'list-pick': () => pickRow(rows[onShow]),
      'list-close': closeGoTo,
      'new-session-here': () => pickRow(rows[onShow], true),
    }),
  });

  const toggleOpened = (row: OpenableRow) => setOpened((shown) => toggled(shown, row));

  const cardWrites = useTopicCardWrites(id);
  const actFromMenu = (topic: TopicId, action: TopicAction) => cardWrites.order(topic, { kind: 'action', action });
  const dropOnHost = (topic: TopicId, drop: Drop) => cardWrites.order(topic, { kind: 'drop', drop });
  // The targets come from the newest Listing the Host Server pushed.
  const startMove = (row: TopicRow) => setMoving(row.id);
  const sendMove = (topic: TopicId, target: MoveTarget) => {
    setMoving(null);
    void (target.kind === 'drop' ? dropOnHost(topic, target.drop) : actFromMenu(topic, target.action));
  };

  const fillPlace = (topic: TopicRow) => {
    if (choices === null) return;
    setFilling(null);
    void dropOnHost(topic.id, { kind: 'fill', place: choices.place });
  };

  const askClose = (close: 'settle' | 'forget') => (row: TopicRow) => {
    const alert = closeAlert(close, row.label);
    Alert.alert(alert.title, alert.message, [
      { text: TOPIC_ACTION_LABEL[alert.keep], onPress: () => void actFromMenu(row.id, alert.keep) },
      { text: TOPIC_ACTION_LABEL[alert.stop], style: 'destructive', onPress: () => void actFromMenu(row.id, alert.stop) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const tmuxWrites = useTmuxWrites(id);
  // Rename opens the name sheet, Stop asks first, and Remove from Topic goes at once.
  const actOnSession = (row: SessionRow, action: SessionAction) => {
    const session = row.onHost?.id;
    if (session === undefined) return;
    if (action === 'rename-session') {
      const params: RenameParams = { hostId: id, kind: 'session', id: session, name: row.name };
      router.push({ pathname: '/rename', params });
    } else if (action === 'stop-session') tmuxWrites.confirm({ kind: 'stop-session', session }, row.name);
    else void tmuxWrites.order({ kind: 'remove-from-topic', session });
  };

  const actions: RowActions = {
    onOpenSession: hostEntry.openSession,
    onOpenTopic: (row) => hostEntry.openTopic(row.seed),
    isBusy: (busy) => hostEntry.busyTopic === busy || cardWrites.writing(busy as TopicId) || tmuxWrites.writing(busy),
    onSessionAction: actOnSession,
    onWake: (row, wake) => void cardWrites.order(row.id, { kind: 'wake', wake }),
    onTopicAction: (row, action) => void actFromMenu(row.id, action),
    onMove: startMove,
    onSettle: askClose('settle'),
    onForget: askClose('forget'),
    // The choices and the place's number come from the newest Listing the Host Server pushed.
    onFillPlace: (row) => setFilling(row.id),
    onToggle: toggleOpened,
    onRetry: retryHost,
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
      return <HostScreenRowView key={key} row={row} palette={palette} actions={movingActions} move={moveRole(row)} />;
    }
    if (row.kind === 'topic') {
      const swipe = swipeAction(row.mark);
      if (swipe !== null) {
        return (
          <SwipeActions key={key}>
            <HostScreenRowView row={row} palette={palette} actions={actions} />
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
    if (row.kind !== 'session' || attachedHere?.sessionName !== row.name) {
      return <HostScreenRowView key={key} row={row} palette={palette} actions={actions} />;
    }
    return (
      <SwipeActions key={key}>
        <HostScreenRowView row={row} palette={palette} attached={attachedHere.phase} actions={actions} />
        <SwipeActions.Actions>
          <Button
            label="Disconnect"
            systemImage="bolt.slash"
            role="destructive"
            onPress={disconnect}
            // Said outright, because the Form's own tint reaches in here and
            // paints the role's red over in accent.
            modifiers={[tint(palette.destructive), accessibilityLabel(`Disconnect ${row.name}`)]}
          />
        </SwipeActions.Actions>
      </SwipeActions>
    );
  };

  const changeQuery = useCallback((event: { nativeEvent: { text?: string } }) => {
    const text = event.nativeEvent.text ?? '';
    setQuery(text);
    setHighlighted(0);
    ask(text);
  }, [ask]);
  const fieldFocused = useCallback(() => setGoTo((mode) => mode ?? 'all'), []);
  // Return on the software keyboard. A hardware Return is the List Key, which the app takes before the field.
  const submit = useRef(() => {});
  useEffect(() => {
    submit.current = () => pickRow(rows[onShow]);
  });
  const fieldSubmitted = useCallback(() => submit.current(), []);

  const renderSection = (section: HostScreenSection) => (
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
      modifiers={[listRowBackground(palette.rowSurface)]}>
      {section.rows.map(renderRow)}
    </Section>
  );

  // While the Go to field has the keys, the Go to list stands in place of the tab.
  const onShowTab =
    goTo !== null ? (
      <>
        <HostWriteRow
          write={pick.write}
          words={{
            host: pick.hostName,
            sending: `Creating ${pick.picked?.name ?? 'a Session'}`,
            attaching: pick.picked ? `Opening ${pick.picked.name}` : undefined,
            mayHaveHappened: 'The Session may exist.',
          }}
          palette={palette}
          onRetry={pick.retry}
          onCheck={pick.check}
        />
        <GoToList
          rows={rows}
          highlighted={onShow}
          reading={reading}
          palette={palette}
          now={listedAt}
          locked={pick.write.kind === 'running'}
          onPick={pickRow}
          folderMenu={goTo === 'all' ? { label: 'New Session here', icon: 'plus', onPress: (row) => openFolder(row, true) } : undefined}
        />
      </>
    ) : !firstReadAnswered(input) ? (
      <Section modifiers={[listRowBackground(palette.rowSurface)]}>
        {renderRow({ kind: 'checking', text: `Reading ${host?.displayName ?? 'the Host'}…` }, 0)}
      </Section>
    ) : sections.map(renderSection);

  const swiftUIColors = [
    // See settings.tsx: SwiftUI follows the phone, not the app.
    environment('colorScheme', appearance),
    background(palette.background),
    tint(palette.controlAccent),
  ];
  const pickerShown = tabs.length > 1 && goTo === null && targets === null && firstReadAnswered(input);
  // A swipe outside the rows changes the tab, so back is at the edge only.
  const tabSwipe = pickerShown && filling === null;
  useBackSwipe(tabSwipe ? 'edge' : 'anywhere');

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
          <Stack.Toolbar.MenuAction
            hidden={hasGoTo}
            icon="terminal"
            onPress={() => router.push({ pathname: '/session-form', params: { hostId: id } })}>
            New Session
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction hidden={hasGoTo || sessionsOnly} icon="folder.badge.plus" onPress={newTopic}>
            New Topic
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            hidden={!hasGoTo}
            icon="envelope.open"
            onPress={() => void tmuxWrites.order({ kind: 'mark-all-read' })}>
            Mark All as Read
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="list.bullet" onPress={() => router.push({ pathname: '/chooser-lists', params: { hostId: id } })}>
            Configure chooser
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {barShown ? (
        <>
          <Stack.SearchBar
            ref={search}
            placeholder={goTo === 'paths' ? 'New Session at a folder' : 'Go to'}
            autoCapitalize="none"
            onFocus={fieldFocused}
            onChangeText={changeQuery}
            onSearchButtonPress={fieldSubmitted}
            onCancelButtonPress={closeGoTo}
          />
          <Stack.Toolbar placement="bottom">
            <Stack.Toolbar.SearchBarSlot />
            <Stack.Toolbar.Spacer />
            <Stack.Toolbar.Menu icon="plus" accessibilityLabel="New">
              <Stack.Toolbar.MenuAction icon="folder.badge.plus" onPress={newTopic}>
                New Topic
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="terminal" onPress={newSessionAtFolder}>
                New Session at a folder
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : null}

      <TabSwipe
        tabs={tabs}
        tab={tab}
        enabled={tabSwipe}
        onSwitch={(next) => rememberHostScreenTab(id, next)}
        header={(shown) =>
          pickerShown ? (
            <Host matchContents={{ vertical: true }}>
              <VStack modifiers={swiftUIColors}>
                <Picker
                  selection={shown}
                  onSelectionChange={(next) => rememberHostScreenTab(id, next)}
                  modifiers={[pickerStyle('segmented'), accessibilityLabel('Host Screen view'), padding({ horizontal: 16, vertical: 8 })]}>
                  {tabs.map((each) => <Text key={each} modifiers={[tag(each)]}>{TAB_NAMES[each]}</Text>)}
                </Picker>
              </VStack>
            </Host>
          ) : null
        }
        renderTab={(each) => (
          <Host style={styles.fill} matchContents={false}>
            <VStack spacing={0} modifiers={swiftUIColors}>
              <Form modifiers={[scrollContentBackground('hidden')]}>
                {each === tab ? onShowTab : hostScreen({ ...input, tab: each, opened }).map(renderSection)}
              </Form>
            </VStack>
          </Host>
        )}
      />
      <FillPlaceSheet choices={choices} onPick={fillPlace} onDismiss={() => setFilling(null)} />
    </View>
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

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
