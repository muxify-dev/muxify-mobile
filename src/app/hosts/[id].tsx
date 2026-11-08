import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import {
  Button,
  ContextMenu,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
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
  font,
  foregroundColor,
  frame,
  listRowBackground,
  opacity,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { TAPPABLE_ROW } from '@/components/tappable-row';
import { SectionHeader } from '@/components/section-header';
import { MarkImage, TagMarks } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import { describeApp, describeDevice, deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { renderReport } from '@/diagnostics/report';
import {
  answered,
  asking,
  lastAnswer,
  refused,
  UNASKED,
  type Listing,
} from '@/domain/host-listing';
import {
  hostScreen,
  type HostScreenRow,
  type HostScreenSection,
  type OpenableRow,
  type RecentRow,
} from '@/domain/host-screen';
import { describeError } from '@/lib/describe-error';
import { timeAgoFrom } from '@/lib/relative-time';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import type { AttachPhase } from '@/tmux/attach';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { phaseLabel } from '@/tmux/attach-labels';
import { execCommandRunner } from '@/tmux/exec-runner';
import { withHostTransport } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import {
  lastSnapshot,
  listedSessions,
  loadingTopics,
  settled,
  TOPICS_UNASKED,
  type HostTopics,
} from '@/topics/host-topics';
import { createMuxifyCli } from '@/topics/muxify-cli';
import { tagsParam } from '@/topics/new-topic';

/** How many rows a section shows before it offers to show the rest. */
const COLLAPSED = 3;

/** The screen's own voice in the Log: what the Host answered when asked. */
const say = speakingAs(deviceLog(), 'host');

/**
 * A Host and its Sessions.
 *
 * Below the Connection section, it draws only what hostScreen returns: the
 * lists the user turned on in Settings, in their order.
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
  const [listing, setListing] = useState<Listing>(UNASKED);
  const [topics, setTopics] = useState<HostTopics>(TOPICS_UNASKED);
  const [opened, setOpened] = useState<ReadonlySet<OpenableRow>>(new Set());
  // One per visit: it keeps where `muxify` was found on this Host, so a
  // refresh is one exec instead of a probe and an exec.
  const [muxify] = useState(() => createMuxifyCli(say));
  const topicsOn = settings.hostScreenLists.includes('topics');
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

  /**
   * Asks the Host what Sessions it has, without taking down the last answer.
   *
   * Every return to this screen asks again — and most of them are returns from
   * a sheet that had nothing to do with the Host's Sessions. See host-listing
   * for why the question is invisible until it has a better answer to give.
   *
   * With Topics on, the one exec of each refresh is `environment show`, whose
   * snapshot has the Sessions too. When it gives no snapshot — no desktop
   * Muxify, an old one, a failed read — the Sessions list still needs its own
   * answer, so tmux is asked after all.
   */
  const readHost = useCallback(async () => {
    setListing(asking);
    if (topicsOn) setTopics(loadingTopics);
    const store = deviceHostStore();
    const records = await store.load();
    const found = records.hosts.find((candidate) => candidate.id === id);
    if (!found) {
      setListing(refused('This Host is no longer saved.'));
      return;
    }

    say(`asking ${found.displayName} for its ${topicsOn ? 'Topics' : 'Sessions'}`);
    let topicsRead = false;
    try {
      await withHostTransport(found, store, async (transport) => {
        const read = topicsOn ? await muxify.read((command) => transport.exec(command)) : null;
        if (read) {
          topicsRead = true;
          setTopics((previous) => settled(previous, read));
        }
        if (read?.kind === 'listed') {
          const sessions = listedSessions(read.snapshot);
          say(`${found.displayName} listed ${sessions.length} Sessions with its Topics`);
          setListing(answered(sessions));
        } else {
          const client = new TmuxClient(execCommandRunner(transport, found.tmuxExecutablePath));
          // A Host with no tmux server is a Host with no Sessions, which the
          // client already forgives — it must not read as a failure here.
          const sessions = await client.listSessions();
          say(`${found.displayName} listed ${sessions.length} Sessions`);
          setListing(answered(sessions));
        }
      });
    } catch (error) {
      const message = describeConnectionFailure(error);
      say(`${found.displayName} refused the listing: ${message}`);
      setListing(refused(message));
      if (topicsOn && !topicsRead) {
        setTopics((previous) => settled(previous, { kind: 'failed', error: message }));
      }
    }
  }, [id, topicsOn, muxify]);

  /**
   * Puts the Log on the clipboard, for pasting wherever the problem is being
   * looked at.
   *
   * Reached by a long press on any Session row rather than from Settings,
   * because this is where someone stands after leaving a Session that went
   * wrong: the Terminal Screen has nothing to long-press that is not a Pane,
   * and Settings is two screens away from the thing being reported. The
   * report's head describes the Attach as it stands, so a Log copied with the
   * Session still attached says what state it was left in. See ADR 0010.
   */
  const copyLog = useCallback(() => {
    const book = deviceLog();
    say('Log copied from the Host Screen');
    const text = renderReport(book, {
      app: describeApp(),
      device: describeDevice(),
      now: Date.now(),
      attached: attach && attachState ? { hostName: attach.hostName, state: attachState } : null,
    });
    void Clipboard.setStringAsync(text).then(
      () => {
        Alert.alert(
          'Log copied',
          `${book.entries().length} lines are on the clipboard. Paste them wherever the problem is being looked at.`,
        );
      },
      (error: unknown) => {
        Alert.alert('Could not copy the Log', describeError(error));
      },
    );
  }, [attach, attachState]);

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
    setExpanded((shown) => {
      const next = new Set(shown);
      if (!next.delete(section)) next.add(section);
      return next;
    });

  const toggleOpened = (row: OpenableRow) =>
    setOpened((shown) => {
      const next = new Set(shown);
      if (!next.delete(row)) next.add(row);
      return next;
    });

  const renderRow = (row: HostScreenRow, index: number) => {
    switch (row.kind) {
      case 'recent': {
        const attached = attachedHere?.sessionName === row.name;
        return (
          <SwipeActions key={row.name}>
            <LogMenu onCopyLog={copyLog}>
              <RecentSessionRow
                row={row}
                palette={palette}
                openedAt={openedAt}
                attached={attached ? attachedHere.phase : undefined}
                onPress={() => open(row.name)}
              />
            </LogMenu>
            <SwipeActions.Actions>
              {/* First, so a full swipe on the attached row ends the
                  Connection: on that row it is the verb being reached for,
                  and Forget is the odd one. Red because it is — it ends
                  something, unlike Forget beside it. Here rather than in the
                  row, where a red word sat beside the phase and read as part
                  of the status. */}
              {attached ? (
                <Button
                  label="Disconnect"
                  systemImage="bolt.slash"
                  role="destructive"
                  onPress={disconnect}
                  // Said outright, because the Form's own tint reaches in here
                  // and paints the role's red over in accent.
                  modifiers={[
                    tint(palette.destructive),
                    accessibilityLabel(`Disconnect ${row.name}`),
                  ]}
                />
              ) : null}
              {/* Not destructive, and deliberately not red: this drops
                  Muxify's memory of the Session and leaves it running. */}
              <Button
                label="Forget"
                systemImage="minus.circle"
                onPress={() => forget(row.name)}
                modifiers={[accessibilityLabel(`Forget ${row.name}`)]}
              />
            </SwipeActions.Actions>
          </SwipeActions>
        );
      }
      case 'available':
        return (
          <LogMenu key={row.name} onCopyLog={copyLog}>
            <Button
              onPress={() => open(row.name)}
              modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
              <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                <Image systemName="terminal" size={20} color={palette.rowIcon} />
                <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
                <Spacer />
                <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
              </HStack>
            </Button>
          </LogMenu>
        );
      case 'checking':
        return (
          <HStack key="checking" spacing={10} modifiers={[frame({ maxWidth: 3000 })]}>
            <ProgressView />
            <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
              {`Checking ${row.of}…`}
            </Text>
            <Spacer />
          </HStack>
        );
      case 'refused':
        return (
          <VStack
            key="refused"
            spacing={8}
            alignment="leading"
            modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
            <HStack spacing={8}>
              <Image systemName="exclamationmark.triangle" size={15} color={palette.destructive} />
              <Text modifiers={[font({ size: 15 }), foregroundColor(palette.destructive)]}>
                {row.message}
              </Text>
              <Spacer />
            </HStack>
            <Button
              label="Retry"
              onPress={() => void readHost()}
              modifiers={[buttonStyle('plain'), font({ size: 15 }), accessibilityLabel('Retry')]}
            />
          </VStack>
        );
      case 'note':
        return (
          <Text
            key="note"
            modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
            {row.text}
          </Text>
        );
      case 'topic':
        return (
          <Button
            key={row.id}
            onPress={() =>
              router.push({
                pathname: '/topic',
                params: { hostId: id, topicId: row.id, label: row.label },
              })
            }
            modifiers={[buttonStyle('plain'), accessibilityLabel(`Topic ${row.label}`)]}>
            <HStack
              spacing={12}
              modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW, opacity(row.dimmed ? 0.5 : 1)]}>
              <Image
                systemName={row.pinned ? 'pin.fill' : 'rectangle.stack'}
                size={20}
                color={row.pinned ? palette.controlAccent : palette.rowIcon}
              />
              <VStack spacing={2} alignment="leading">
                <Text modifiers={[font({ size: 17 })]}>{row.label}</Text>
                {row.note === null ? null : (
                  <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                    {row.note}
                  </Text>
                )}
                {row.dimmed ? (
                  <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                    No live Sessions
                  </Text>
                ) : null}
              </VStack>
              <Spacer />
              {row.tags.length === 0 ? null : <TagMarks tags={row.tags} palette={palette} />}
              {row.mark === null ? null : <MarkImage mark={row.mark} palette={palette} />}
              <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
            </HStack>
          </Button>
        );
      case 'locked-session':
        return (
          <LogMenu key={`locked:${row.name}`} onCopyLog={copyLog}>
            <Button
              onPress={() => open(row.name)}
              modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
              <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                <Image
                  systemName={row.pinned ? 'pin.fill' : 'terminal'}
                  size={20}
                  color={row.pinned ? palette.controlAccent : palette.rowIcon}
                />
                <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
                <Spacer />
                {row.mark === null ? null : <MarkImage mark={row.mark} palette={palette} />}
                <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
              </HStack>
            </Button>
          </LogMenu>
        );
      case 'open-place':
        return (
          <HStack
            key={row.id}
            spacing={12}
            modifiers={[frame({ maxWidth: 3000 }), accessibilityLabel('Open Place')]}>
            <Image systemName="circle.dashed" size={20} color={palette.secondaryLabel} />
            <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
              Open Place
            </Text>
            <Spacer />
          </HStack>
        );
      case 'bench':
        return (
          <Button
            key="bench"
            onPress={() => toggleOpened('bench')}
            modifiers={[buttonStyle('plain'), accessibilityLabel('Bench')]}>
            <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
              <Image systemName="tray.2" size={20} color={palette.rowIcon} />
              <Text modifiers={[font({ size: 17 })]}>Bench</Text>
              <Spacer />
              <Image
                systemName={row.opened ? 'chevron.up' : 'chevron.down'}
                size={13}
                color={palette.secondaryLabel}
              />
            </HStack>
          </Button>
        );
      case 'unknown-card':
        return (
          <Text
            key={`card:${index}`}
            modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
            {row.text}
          </Text>
        );
      case 'no-topic':
        return (
          <Button
            key="no-topic"
            onPress={() => toggleOpened('no-topic')}
            modifiers={[buttonStyle('plain'), accessibilityLabel('No Topic')]}>
            <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
              <Image systemName="tray" size={20} color={palette.rowIcon} />
              <Text modifiers={[font({ size: 17 })]}>No Topic</Text>
              <Spacer />
              <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
                {String(row.count)}
              </Text>
              <Image
                systemName={row.opened ? 'chevron.up' : 'chevron.down'}
                size={13}
                color={palette.secondaryLabel}
              />
            </HStack>
          </Button>
        );
    }
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
          <Section
            header={<SectionHeader palette={palette}>Connection</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <VStack
              spacing={4}
              alignment="leading"
              modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
              <Text modifiers={[font({ size: 17 })]}>Address</Text>
              <Text
                modifiers={[
                  font({ size: 13, design: 'monospaced' }),
                  foregroundColor(palette.secondaryLabel),
                ]}>
                {host ? `${host.address}:${host.port}` : ''}
              </Text>
            </VStack>

            <HStack modifiers={[frame({ maxWidth: 3000 })]}>
              <Text modifiers={[font({ size: 17 })]}>Sessions</Text>
              <Spacer />
              <Text modifiers={[font({ size: 17 }), foregroundColor(palette.secondaryLabel)]}>
                {sessionSummary(listing)}
              </Text>
            </HStack>
          </Section>

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

/**
 * A remembered Session: what it is called, when you last opened it, who is on it.
 *
 * The one that is attached says so where the "Opened 2 hr ago" line would be.
 * The way to end it is a swipe away, with Forget, rather than in the row:
 * nothing here starts or stops a Connection, and the row itself is navigation.
 */
function RecentSessionRow({
  row,
  palette,
  openedAt,
  attached,
  onPress,
}: {
  row: RecentRow;
  palette: Appearance;
  openedAt: Date;
  /** The phase of the Attach on this Session, or undefined when it is not. */
  attached?: AttachPhase;
  onPress: () => void;
}) {
  const opened = timeAgoFrom(row.lastOpenedAt, openedAt);
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${row.name}`)]}>
      <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
        <Image
          systemName="terminal"
          size={20}
          color={attached ? palette.controlAccent : palette.rowIcon}
        />
        <VStack spacing={2} alignment="leading">
          <Text modifiers={[font({ size: 17 })]}>{row.name}</Text>
          {attached ? (
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.controlAccent)]}>
              {phaseLabel(attached)}
            </Text>
          ) : opened === undefined ? null : (
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
              {`Opened ${opened}`}
            </Text>
          )}
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
      </HStack>
    </Button>
  );
}

/**
 * The long-press menu on a Session row, and the only thing on it: Copy log.
 *
 * A context menu because that is what a long press on a row means on iOS —
 * more about this thing — and the Log is about the Sessions on this Host more
 * than about anything else in the app. A tap on the row still opens it; the
 * menu waits underneath for the press that is held.
 */
function LogMenu({ onCopyLog, children }: { onCopyLog: () => void; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenu.Items>
        <Button
          label="Copy log"
          systemImage="doc.on.clipboard"
          onPress={onCopyLog}
          modifiers={[accessibilityLabel('Copy log')]}
        />
      </ContextMenu.Items>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
    </ContextMenu>
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

/**
 * How the Connection section describes the Host in one line.
 *
 * Silent until the Host has actually answered: a count assembled from memory
 * alone would say "2 sessions" about a machine that has nine. The answer it
 * gave last stands while it is being asked again, so the count does not blink
 * to a dash and back every time a sheet closes over this screen.
 *
 * It no longer says how many are attached. That was a warning, not a status —
 * joining a Session somebody was watching used to shrink their Window, because
 * Muxify borrowed `window-size smallest` to do it. A control client borrows
 * nothing, so there is nothing left to warn about. See ADR 0006.
 */
function sessionSummary(listing: Listing): string {
  const listed = lastAnswer(listing);
  if (listed === undefined) return '—';
  return `${listed.length} ${listed.length === 1 ? 'session' : 'sessions'}`;
}

/** The Topics list is what the screen is for, so it is never cut to its first rows. */
/** Only the Sessions sections fold: the Topics sections keep the Mac's whole layout. */
function collapsible(section: HostScreenSection): boolean {
  return section.id === 'recent' || section.id === 'available' || section.id === 'sessions';
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
