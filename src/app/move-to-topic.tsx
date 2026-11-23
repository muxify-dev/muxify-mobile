import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Form, Host, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  disabled,
  environment,
  foregroundColor,
  listRowBackground,
  onSubmit,
  scrollContentBackground,
  submitLabel,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { HostWriteRow } from '@/components/host-write-row';
import { SectionHeader } from '@/components/section-header';
import { useLiveListing } from '@/hooks/use-host-listing';
import { useHostWrite } from '@/hooks/use-host-write';
import { useSettings } from '@/settings/settings-context';
import { useAttachHolder } from '@/tmux/attach-context';
import { openTopics, type SessionId } from '@/topics/environment';
import { moveSession, pushedListing } from '@/topics/host-writes';
import { movedTopic, type MoveDestination, type Moved } from '@/topics/move-to-topic';

/** The Session the sheet moves, by tmux's id, with the name it had when the sheet opened. */
export type MoveToTopicParams = { hostId: string; session: SessionId; name: string };

/**
 * Move to Topic, as the Mac's Session menu has it: a Session goes into
 * another open Topic, or into a new Topic, which takes the place of a Board
 * Session's card. The choices are the open Topics of the Listing the Host
 * Server pushes, in Board order. The move is one Host Write; the Host renames
 * the Session for its Topic, and an Attach on it then holds that Topic.
 */
export default function MoveToTopicScreen() {
  const router = useRouter();
  const holder = useAttachHolder();
  const { hostId, session, name } = useLocalSearchParams<MoveToTopicParams>();
  const { appearance, palette } = useSettings();
  const snapshot = useLiveListing(hostId)?.received?.snapshot ?? null;
  const { write, hostName, check, request } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';

  const [naming, setNaming] = useState(false);
  const title = useNativeState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  // Where the last move went, for Retry and Check.
  const [sent, setSent] = useState<MoveDestination | null>(null);

  const moved = (done: Moved | undefined) => {
    if (done === undefined) return;
    const attach = holder.current();
    if (attach?.hostId === hostId) attach.movedIntoTopic(session, name, done.topic);
    router.back();
  };

  const move = (to: MoveDestination) => {
    if (locked) return;
    setSent(to);
    void request(
      JSON.stringify(to),
      ({ host, step }, id) => moveSession(host, session, to, id, () => step('sending')),
      (done) => done,
    ).then(moved);
  };

  const create = () => {
    const wanted = title.value.trim();
    if (wanted === '') {
      setTitleError('Give the Topic a title.');
      return;
    }
    setTitleError(undefined);
    move({ kind: 'new-topic', title: wanted });
  };

  const checkMoved = () => {
    if (sent === null) return;
    void check(async ({ host, refuse }) => {
      const topic = movedTopic(await pushedListing(host), session, sent);
      return topic === null ? refuse(`${name} is not in the Topic on ${host.displayName}. Retry sends the move again.`) : { topic };
    }).then(moved);
  };

  const form = [
    environment('colorScheme', appearance),
    scrollContentBackground('hidden'),
    background(palette.background),
    tint(palette.controlAccent),
  ];
  // Every open Topic but the one the Session is in.
  const topics = snapshot === null ? null : openTopics(snapshot)
    .filter((topic) => topic.id !== snapshot.sessions.find((each) => each.id === session)?.topic);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: naming ? 'New Topic' : 'Move to Topic', gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {naming ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" tintColor={palette.controlAccent} disabled={locked} onPress={create}>
            Create
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}

      <Host style={styles.fill} matchContents={false}>
        <Form modifiers={form}>
          <HostWriteRow
            write={write}
            words={{ host: hostName, sending: `Moving ${name}`, mayHaveHappened: `${name} may be in the Topic.` }}
            palette={palette}
            onRetry={naming ? create : () => { if (sent) move(sent); }}
            onCheck={checkMoved}
          />
          {naming ? (
            <Section
              header={<SectionHeader palette={palette}>Title</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <TextField
                text={title}
                autoFocus
                placeholder="Fix login"
                modifiers={[accessibilityLabel('Topic title'), disabled(locked), submitLabel('done'), onSubmit(create)]}
              />
              <FieldError error={titleError} palette={palette} />
            </Section>
          ) : (
            <>
              <Section modifiers={[listRowBackground(palette.rowSurface)]}>
                <Button
                  label="New Topic…"
                  systemImage="folder.badge.plus"
                  onPress={() => setNaming(true)}
                  modifiers={[accessibilityLabel('New Topic…'), disabled(locked)]}
                />
              </Section>
              <Section
                header={<SectionHeader palette={palette}>Open Topics</SectionHeader>}
                modifiers={[listRowBackground(palette.rowSurface)]}>
                {topics === null ? (
                  <Text modifiers={[foregroundColor(palette.secondaryLabel)]}>Reading Topics…</Text>
                ) : topics.length === 0 ? (
                  <Text modifiers={[foregroundColor(palette.secondaryLabel)]}>No open Topics</Text>
                ) : topics.map((topic) => (
                  <Button
                    key={topic.id}
                    label={topic.label}
                    onPress={() => move({ kind: 'topic', topic: topic.id })}
                    modifiers={[accessibilityLabel(`Topic ${topic.label}`), disabled(locked)]}
                  />
                ))}
              </Section>
            </>
          )}
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
