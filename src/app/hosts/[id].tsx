import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import {
  Button,
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
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { TAPPABLE_ROW } from '@/components/tappable-row';
import type { Appearance } from '@/constants/app-theme';
import { hostSessions, type RecentRow } from '@/domain/host-sessions';
import { timeAgoFrom } from '@/lib/relative-time';
import { useSettings } from '@/settings/settings-context';
import { connectToHost, describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord, RecentSession } from '@/storage/records';
import type { AttachPhase } from '@/tmux/attach';
import { useAttachHolder, useAttachState, useCurrentAttach } from '@/tmux/attach-context';
import { phaseLabel } from '@/tmux/attach-labels';
import { execCommandRunner } from '@/tmux/exec-runner';
import { sshTmuxTransport } from '@/tmux/ssh-transport';
import { TmuxClient, type Session } from '@/tmux/tmux-client';

/** How many rows a section shows before it offers to show the rest. */
const COLLAPSED = 3;

/** What the Host has to say for itself, once asked. */
type Listing =
  | { phase: 'reading' }
  | { phase: 'read'; sessions: Session[] }
  | { phase: 'failed'; message: string };

/**
 * A Host and its Sessions.
 *
 * Two lists, because there are two different things here: the Sessions this
 * phone has opened before — which Muxify remembers, in the order you last
 * wanted them — and everything else the Host happens to be running. See
 * hostSessions for the rule that decides which is which.
 *
 * What is remembered is on screen before the Host is even dialled, and the
 * Host's own answer arrives underneath a moment later. A Host you cannot reach
 * is exactly when you most want to see what you had open on it.
 */
export default function HostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { appearance, palette } = useSettings();

  const [host, setHost] = useState<HostRecord | undefined>();
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [listing, setListing] = useState<Listing>({ phase: 'reading' });
  const [showEveryRecent, setShowEveryRecent] = useState(false);
  const [showEveryAvailable, setShowEveryAvailable] = useState(false);
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

  const readHost = useCallback(async () => {
    setListing({ phase: 'reading' });
    const store = deviceHostStore();
    const records = await store.load();
    const found = records.hosts.find((candidate) => candidate.id === id);
    if (!found) {
      setListing({ phase: 'failed', message: 'This Host is no longer saved.' });
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
        const client = new TmuxClient(
          execCommandRunner(sshTmuxTransport(connection), found.tmuxExecutablePath),
        );
        // A Host with no tmux server is a Host with no Sessions, which the
        // client already forgives — it must not read as a failure here.
        setListing({ phase: 'read', sessions: await client.listSessions() });
      } finally {
        await connection.disconnect();
      }
    } catch (error) {
      setListing({ phase: 'failed', message: describeConnectionFailure(error) });
    }
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

  const { recent: rows, available } = hostSessions(
    recent,
    listing.phase === 'read' ? listing.sessions : undefined,
  );
  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: host?.displayName ?? 'Host',
          headerRight: () => (
            <ToolbarActions
              palette={palette}
              onEdit={() => router.push({ pathname: '/host-form', params: { id } })}
              onNew={() => router.push({ pathname: '/session-form', params: { hostId: id } })}
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
                {sessionSummary(rows.length + available.length, listing)}
              </Text>
            </HStack>
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Sessions</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            {rows.length === 0 ? (
              <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
                {listing.phase === 'reading'
                  ? 'Nothing opened on this Host yet.'
                  : 'Nothing opened on this Host yet. Pick one below to start.'}
              </Text>
            ) : (
              collapse(rows, showEveryRecent).map((row) => (
                <SwipeActions key={row.name}>
                  <RecentSessionRow
                    row={row}
                    palette={palette}
                    openedAt={openedAt}
                    attached={attachedHere?.sessionName === row.name ? attachedHere.phase : undefined}
                    onPress={() => open(row.name)}
                    onDisconnect={disconnect}
                  />
                  <SwipeActions.Actions>
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
              ))
            )}

            {rows.length > COLLAPSED ? (
              <DisclosureRow
                palette={palette}
                expanded={showEveryRecent}
                onPress={() => setShowEveryRecent((shown) => !shown)}
              />
            ) : null}
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Available on Host</SectionHeader>}
            footer={
              available.length > 0 ? (
                <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                  Opening one adds it to Sessions above.
                </Text>
              ) : undefined
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            {listing.phase === 'reading' ? (
              <HStack spacing={10} modifiers={[frame({ maxWidth: 3000 })]}>
                <ProgressView />
                <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
                  Checking Sessions…
                </Text>
                <Spacer />
              </HStack>
            ) : null}

            {listing.phase === 'failed' ? (
              <VStack
                spacing={8}
                alignment="leading"
                modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
                <HStack spacing={8}>
                  <Image systemName="exclamationmark.triangle" size={15} color={palette.destructive} />
                  <Text modifiers={[font({ size: 15 }), foregroundColor(palette.destructive)]}>
                    {listing.message}
                  </Text>
                  <Spacer />
                </HStack>
                <Button
                  label="Retry"
                  onPress={() => void readHost()}
                  modifiers={[buttonStyle('plain'), font({ size: 15 }), accessibilityLabel('Retry')]}
                />
              </VStack>
            ) : null}

            {listing.phase === 'read' && available.length === 0 ? (
              <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
                No other Sessions on this Host.
              </Text>
            ) : null}

            {collapse(available, showEveryAvailable).map((session) => (
              <Button
                key={session.name}
                onPress={() => open(session.name)}
                modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${session.name}`)]}>
                <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                  <Image systemName="terminal" size={20} color={palette.rowIcon} />
                  <Text modifiers={[font({ size: 17 })]}>{session.name}</Text>
                  <Spacer />
                  <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
                </HStack>
              </Button>
            ))}

            {available.length > COLLAPSED ? (
              <DisclosureRow
                palette={palette}
                expanded={showEveryAvailable}
                onPress={() => setShowEveryAvailable((shown) => !shown)}
              />
            ) : null}
          </Section>
        </Form>
      </Host>
    </View>
  );
}

/**
 * A remembered Session: what it is called, when you last opened it, who is on it.
 *
 * The one that is attached says so where the "Opened 2 hr ago" line would be,
 * and carries the way to end it. Nothing here starts or stops a Connection:
 * Disconnect asks the root, and the row itself is navigation.
 */
function RecentSessionRow({
  row,
  palette,
  openedAt,
  attached,
  onPress,
  onDisconnect,
}: {
  row: RecentRow;
  palette: Appearance;
  openedAt: Date;
  /** The phase of the Attach on this Session, or undefined when it is not. */
  attached?: AttachPhase;
  onPress: () => void;
  onDisconnect: () => void;
}) {
  const opened = timeAgoFrom(row.lastOpenedAt, openedAt);
  return (
    <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 })]}>
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
              <Text
                modifiers={[font({ size: 13 }), foregroundColor(palette.controlAccent)]}>
                {phaseLabel(attached)}
              </Text>
            ) : opened === undefined ? null : (
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                {`Opened ${opened}`}
              </Text>
            )}
          </VStack>
          <Spacer />
          {attached ? null : (
            <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
          )}
        </HStack>
      </Button>
      {attached ? (
        <Button
          label="Disconnect"
          onPress={onDisconnect}
          modifiers={[
            buttonStyle('plain'),
            font({ size: 15 }),
            foregroundColor(palette.destructive),
            accessibilityLabel(`Disconnect ${row.name}`),
          ]}
        />
      ) : null}
    </HStack>
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
  onEdit,
  onNew,
}: {
  palette: Appearance;
  onEdit: () => void;
  onNew: () => void;
}) {
  return (
    <View style={styles.toolbarGroup}>
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit Host">
        <RNText style={[styles.toolbarWord, { color: palette.toolbarTint }]}>Edit</RNText>
      </Pressable>
      <Pressable onPress={onNew} accessibilityRole="button" accessibilityLabel="New Session">
        <SymbolView name="plus" size={23} tintColor={palette.toolbarTint} />
      </Pressable>
    </View>
  );
}

function SectionHeader({ children, palette }: { children: string; palette: Appearance }) {
  return (
    <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.sectionHeader)]}>
      {children}
    </Text>
  );
}

/**
 * How the Connection section describes the Host in one line.
 *
 * Silent until the Host has actually answered: a count assembled from memory
 * alone would say "2 sessions" about a machine that has nine.
 *
 * It no longer says how many are attached. That was a warning, not a status —
 * joining a Session somebody was watching used to shrink their Window, because
 * Muxify borrowed `window-size smallest` to do it. A control client borrows
 * nothing, so there is nothing left to warn about. See ADR 0006.
 */
function sessionSummary(total: number, listing: Listing): string {
  if (listing.phase !== 'read') return '—';
  return `${total} ${total === 1 ? 'session' : 'sessions'}`;
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
