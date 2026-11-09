import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
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

import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { ToolbarWord } from '@/components/toolbar-word';
import { MarkImage } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';
import type { TopicId, TopicState } from '@/topics/environment';
import {
  lastTopic,
  loadingTopic,
  settledTopic,
  TOPIC_UNASKED,
  type TopicSession,
  type TopicView,
} from '@/topics/topic-detail';
import { fieldsParam } from '@/topics/topic-edit';

const say = speakingAs(deviceLog(), 'topic');

/** Why a Topic with no live Session has none, in the Mac's words for its state. */
const NO_LIVE_SESSIONS: Record<Exclude<TopicState, 'live'>, string> = {
  dormant: 'This Topic is Dormant: it remembers Sessions, but none of them runs on the Host now.',
  empty: 'This Topic is Empty: it has no Sessions.',
};

/**
 * One Topic of a Host: its Note, its Tags and its live Sessions with their
 * Windows and Agent marks. A tap on a Session attaches to it, on the same path
 * as a tap on the Host Screen, so Home from that Session goes to the Host
 * Screen under this one.
 *
 * It reads the Topic again each time it comes into view, because the Mac can
 * change the Topic while the phone is in a Session, and because Add a Session
 * and Edit come back here when they have changed it. The last answer stays on
 * screen while it reads.
 */
export default function TopicScreen() {
  const router = useRouter();
  const { hostId, topicId, label, tags } = useLocalSearchParams<{
    hostId: string;
    topicId: string;
    label?: string;
    /** The Config's Tags, for the Edit sheet. */
    tags?: string;
  }>();
  const { appearance, palette } = useSettings();
  const [view, setView] = useState<TopicView>(TOPIC_UNASKED);

  const readTopic = useCallback(async () => {
    setView(loadingTopic);
    const store = deviceHostStore();
    const host = (await store.load()).hosts.find((candidate) => candidate.id === hostId);
    if (!host) {
      setView((previous) => settledTopic(previous, { kind: 'failed', error: 'This Host is no longer saved.' }));
      return;
    }
    try {
      const read = await appConnections().read(host, (transport, muxify) =>
        muxify.show((command) => transport.exec(command), topicId as TopicId),
      );
      say(read.kind === 'shown' ? `${host.displayName} showed a Topic` : `${host.displayName} could not show a Topic: ${read.error}`);
      setView((previous) => settledTopic(previous, read));
    } catch (error) {
      const message = describeConnectionFailure(error);
      say(`${host.displayName} refused the Topic: ${message}`);
      setView((previous) => settledTopic(previous, { kind: 'failed', error: message }));
    }
  }, [hostId, topicId]);

  useFocusEffect(
    useCallback(() => {
      void readTopic();
    }, [readTopic]),
  );

  const open = (session: string) =>
    router.push({ pathname: '/terminal', params: { hostId, session, topicId } });

  const topic = lastTopic(view);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: topic?.label ?? label ?? 'Topic',
          headerRight: () =>
            topic === null ? null : (
              <ToolbarWord
                label="Edit"
                color={palette.controlAccent}
                bold={false}
                onPress={() =>
                  router.push({
                    pathname: '/topic-edit',
                    params: {
                      hostId,
                      topicId,
                      topic: fieldsParam({
                        title: topic.label,
                        note: topic.note,
                        tags: topic.tags,
                      }),
                      tags,
                    },
                  })
                }
              />
            ),
        }}
      />
      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            environment('colorScheme', appearance),
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
          ]}>
          {view.kind === 'failed' ? (
            <Section modifiers={[listRowBackground(palette.rowSurface)]}>
              <VStack
                spacing={8}
                alignment="leading"
                modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
                <HStack spacing={8}>
                  <Image systemName="exclamationmark.triangle" size={15} color={palette.destructive} />
                  <Text modifiers={[font({ size: 15 }), foregroundColor(palette.destructive)]}>
                    {view.error}
                  </Text>
                  <Spacer />
                </HStack>
                <Button
                  label="Retry"
                  onPress={() => void readTopic()}
                  modifiers={[buttonStyle('plain'), font({ size: 15 }), accessibilityLabel('Retry')]}
                />
              </VStack>
            </Section>
          ) : null}

          {topic === null ? (
            view.kind === 'loading' ? (
              <Section modifiers={[listRowBackground(palette.rowSurface)]}>
                <HStack spacing={10} modifiers={[frame({ maxWidth: 3000 })]}>
                  <ProgressView />
                  <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
                    Checking Topic…
                  </Text>
                  <Spacer />
                </HStack>
              </Section>
            ) : null
          ) : (
            <>
              <Section modifiers={[listRowBackground(palette.rowSurface)]}>
                {/* The whole title, which the navigation bar cuts short. */}
                <Text modifiers={[font({ size: 22, weight: 'semibold' })]}>{topic.label}</Text>
                {topic.note === null ? null : (
                  <Text modifiers={[font({ size: 17 }), accessibilityLabel(`Note ${topic.note}`)]}>
                    {topic.note}
                  </Text>
                )}
                {topic.tags.length === 0 ? null : (
                  <Text modifiers={[font({ size: 15 }), foregroundColor(palette.secondaryLabel)]}>
                    {topic.tags.map((tag) => `#${tag}`).join('  ')}
                  </Text>
                )}
              </Section>
              <Section
                header={<SectionHeader palette={palette}>Sessions</SectionHeader>}
                modifiers={[listRowBackground(palette.rowSurface)]}>
                {topic.state === 'live' ? (
                  topic.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      palette={palette}
                      onPress={() => open(session.name)}
                    />
                  ))
                ) : (
                  <VStack
                    spacing={2}
                    alignment="leading"
                    modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
                    <Text modifiers={[font({ size: 17 })]}>No live Sessions</Text>
                    <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                      {NO_LIVE_SESSIONS[topic.state]}
                    </Text>
                  </VStack>
                )}
                <Button
                  onPress={() =>
                    router.push({ pathname: '/topic-add-session', params: { hostId, topicId } })
                  }
                  modifiers={[buttonStyle('plain'), accessibilityLabel('Add a Session')]}>
                  <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                    <Image systemName="plus.circle" size={20} color={palette.controlAccent} />
                    <Text modifiers={[font({ size: 17 }), foregroundColor(palette.controlAccent)]}>
                      Add a Session
                    </Text>
                    <Spacer />
                  </HStack>
                </Button>
              </Section>
            </>
          )}
        </Form>
      </Host>
    </View>
  );
}

/** A live Session of the Topic, with a line for each of its Windows and the Window's Agent mark. */
function SessionRow({
  session,
  palette,
  onPress,
}: {
  session: TopicSession;
  palette: Appearance;
  onPress: () => void;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain'), accessibilityLabel(`Session ${session.name}`)]}>
      <HStack spacing={12} modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
        <Image systemName="terminal" size={20} color={palette.rowIcon} />
        <VStack spacing={4} alignment="leading">
          <Text modifiers={[font({ size: 17 })]}>{session.name}</Text>
          {session.windows.map((window) => (
            <HStack key={window.id} spacing={6}>
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                {`${window.index}  ${window.name}`}
              </Text>
              {window.mark === null ? null : <MarkImage mark={window.mark} palette={palette} />}
            </HStack>
          ))}
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" size={13} color={palette.secondaryLabel} />
      </HStack>
    </Button>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
