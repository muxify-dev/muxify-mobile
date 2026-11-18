import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Text,
  Form,
  Host,
  HStack,
  ScrollView,
  Section,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  disabled,
  environment,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { SectionHeader } from '@/components/section-header';
import { TagChoice } from '@/components/tag-choice';
import { HostWriteRow } from '@/components/host-write-row';
import { toggled } from '@/lib/toggled';
import { useHostWrite } from '@/hooks/use-host-write';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { deviceHostStore } from '@/storage/device-store';
import type { Tag, TopicId } from '@/topics/environment';
import { createTopic, pushedListing } from '@/topics/host-writes';
import { emptyTopicTitled } from '@/topics/new-topic';
import { intentAfter, intentFor, type Intent } from '@/topics/request';
import { topicSeedParam } from '@/topics/topic-detail';


export default function TopicFormScreen() {
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{
    hostId: string;
  }>();
  const { appearance, palette } = useSettings();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [tagError, setTagError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let left = false;
    setTags(null);
    setTagError(undefined);
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const { tags: listed } = await pushedListing(host);
      if (!left) setTags(listed);
    })().catch((error) => { if (!left) setTagError(describeConnectionFailure(error)); });
    return () => { left = true; };
  }, [hostId, attempt]);

  const title = useNativeState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [titleError, setTitleError] = useState<string | undefined>();
  const { write, hostName, send, check } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';
  // The Request of the last Save, so a Retry with the same title and Tags is the same Request.
  const intent = useRef<Intent | null>(null);

  const toggle = useCallback((name: string) => {
    setChosen((previous) => toggled(previous, name));
  }, []);

  // In Config order, as the Mac lists a Topic's Tags. Before the Tags read answers none can be chosen.
  const chosenTags = (tags ?? []).filter((tag) => chosen.has(tag.name)).map((tag) => tag.name);

  const opened = (topic: TopicId | undefined, label: string) => {
    if (topic === undefined) return;
    router.replace({ pathname: '/topic-add-session', params: { hostId, topicId: topic, created: '1',
      seed: topicSeedParam({ id: topic, label, note: null, tags: chosenTags, state: 'empty', sessions: [] }) } });
  };

  const save = () => {
    if (locked) return;
    const wanted = title.value.trim();
    if (wanted === '') {
      setTitleError('Give the Topic a title.');
      return;
    }
    setTitleError(undefined);
    const sent = intentFor(intent.current, JSON.stringify([wanted, chosenTags]));
    intent.current = sent;
    void send(async ({ host, step, refuse, unsure }) => {
      const made = await createTopic(host, wanted, chosenTags, sent.request, () => step('sending'));
      intent.current = intentAfter(sent, made);
      if (made.kind === 'failed') return refuse(made.error);
      if (made.kind === 'unknown') return unsure(made.message);
      return made.topic;
    }).then((topic) => opened(topic, wanted));
  };

  const checkMade = () => {
    const wanted = title.value.trim();
    void check(async ({ host, refuse }) => {
      return emptyTopicTitled(await pushedListing(host), wanted) ?? refuse(`${wanted} is not on ${host.displayName}. Save creates it.`);
    }).then((topic) => opened(topic, wanted));
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'New Topic', gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" tintColor={palette.controlAccent} disabled={locked} onPress={save}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            environment('colorScheme', appearance),
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
          ]}>
          <HostWriteRow
            write={write}
            words={{ host: hostName, sending: `Creating ${title.value.trim()}`, mayHaveHappened: 'The Topic may exist.' }}
            palette={palette}
            onRetry={save}
            onCheck={checkMade}
          />
          <Section
            header={<SectionHeader palette={palette}>Title</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={title}
              placeholder="Fix login"
              modifiers={[accessibilityLabel('Topic title'), disabled(locked)]}
            />
            <FieldError error={titleError} palette={palette} />
          </Section>

          {tags === null ? <Section
            header={<SectionHeader palette={palette}>Tags</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Text>{tagError ?? 'Reading Tags…'}</Text>
            {tagError ? <Button label="Try again" onPress={() => setAttempt((value) => value + 1)} modifiers={[disabled(locked)]} /> : null}
          </Section> : tags.length === 0 ? null : (
            <Section
              header={<SectionHeader palette={palette}>Tags</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <ScrollView axes="horizontal" showsIndicators={false}>
                <HStack spacing={8}>
                  {tags.map((tag) => (
                    <TagChoice
                      key={tag.name}
                      tag={tag}
                      chosen={chosen.has(tag.name)}
                      appearance={appearance}
                      fallbackColor={palette.secondaryLabel}
                      disabled={locked}
                      onPress={() => toggle(tag.name)}
                    />
                  ))}
                </HStack>
              </ScrollView>
            </Section>
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
