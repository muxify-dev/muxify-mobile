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
  controlSize,
  disabled,
  environment,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { ToolbarWord } from '@/components/toolbar-word';
import { MarkImage } from '@/components/topic-marks';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import type { TopicId, TopicState } from '@/topics/environment';
import { readTopic } from '@/topics/read-topic';
import {
  lastTopic,
  loadingTopic,
  settledTopic,
  topicSeedFromParam,
  topicStartingFrom,
  type TopicSession,
  type TopicView,
} from '@/topics/topic-detail';
import { fieldsParam } from '@/topics/topic-edit';
import { WAKE_LABEL, wakeTopic, type Wake, type WakeState } from '@/topics/wake-topic';

/** Why a Topic with no live Session has none, in the Mac's words for its state. */
const NO_LIVE_SESSIONS: Record<Exclude<TopicState, 'live'>, string> = {
  dormant: 'This Topic is Dormant: it remembers Sessions, but none of them runs on the Host now. Reopen makes them again; Start Fresh makes one shell in each folder.',
  empty: 'This Topic is Empty: it has no Sessions.',
};

/**
 * One Topic of a Host: its Note, its Tags and its live Sessions with their
 * Windows and Agent marks. A tap on a Session attaches to it, on the same path
 * as a tap on the Host Screen, and Back from that Session goes Home.
 *
 * It reads the Topic again each time it comes into view, because the Mac can
 * change the Topic while the phone is in a Session, and because Add a Session
 * and Edit come back here when they have changed it. The last answer stays on
 * screen while it reads.
 */
export default function TopicScreen() {
  const router = useRouter();
  const { hostId, topicId, label, tags, seed } = useLocalSearchParams<{
    hostId: string;
    topicId: string;
    label?: string;
    /** The Config's Tags, for the Edit sheet. */
    tags?: string;
    /** What the Host Screen already read about this Topic. See topicSeedParam. */
    seed?: string;
  }>();
  const { appearance, palette } = useSettings();
  const [view, setView] = useState<TopicView>(() => topicStartingFrom(topicSeedFromParam(seed)));

  const reread = useCallback(async () => {
    setView(loadingTopic);
    const read = await readTopic(hostId, topicId as TopicId);
    setView((previous) => settledTopic(previous, read));
  }, [hostId, topicId]);

  useFocusEffect(
    useCallback(() => {
      void reread();
    }, [reread]),
  );

  const [waking, setWaking] = useState<WakeState>({ kind: 'idle' });

  const wake = async (how: Wake) => {
    if (waking.kind === 'working') return;
    setWaking({ kind: 'working', wake: how });
    const write = await wakeTopic(hostId, topicId as TopicId, how);
    if (write.kind === 'failed') {
      setWaking({ kind: 'failed', message: write.error });
      return;
    }
    await reread();
    setWaking({ kind: 'idle' });
  };

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
                  onPress={() => void reread()}
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
                    {topic.state === 'dormant' ? (
                      <WakeButtons waking={waking} onWake={(how) => void wake(how)} />
                    ) : null}
                    {waking.kind === 'failed' ? (
                      <FieldError error={waking.message} palette={palette} />
                    ) : null}
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

/**
 * Reopen, the main way, and Start Fresh, under a Dormant Topic's text. While
 * the Host works, the pressed button shows a spinner and both are disabled.
 */
function WakeButtons({ waking, onWake }: { waking: WakeState; onWake: (how: Wake) => void }) {
  const working = waking.kind === 'working';
  const button = (how: Wake, style: 'borderedProminent' | 'bordered') => (
    <Button
      onPress={() => onWake(how)}
      modifiers={[
        buttonStyle(style),
        controlSize('small'),
        disabled(working),
        accessibilityLabel(WAKE_LABEL[how]),
      ]}>
      <HStack spacing={6}>
        {working && waking.wake === how ? <ProgressView /> : null}
        <Text>{WAKE_LABEL[how]}</Text>
      </HStack>
    </Button>
  );
  return (
    <HStack spacing={12} modifiers={[frame({ maxWidth: 3000, alignment: 'leading' })]}>
      {button('reopen', 'borderedProminent')}
      {button('start-fresh', 'bordered')}
      <Spacer />
    </HStack>
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
          {(session.windows ?? []).map((window) => (
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
