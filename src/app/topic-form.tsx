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
  environment,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { SectionHeader } from '@/components/section-header';
import { TagChoice } from '@/components/tag-choice';
import { ToolbarWord } from '@/components/toolbar-word';
import { toggled } from '@/lib/toggled';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';
import type { NewTopicRead } from '@/topics/new-topic';
import type { Tag } from '@/topics/environment';
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
      const result = await appConnections().read(host, (transport, muxify) => muxify.read((command) => transport.exec(command)));
      if (result.kind !== 'listed') throw new Error(result.kind === 'failed' ? result.error : 'Update Muxify on this Host to create Topics.');
      if (!left) setTags(result.snapshot.tags);
    })().catch((error) => { if (!left) setTagError(describeConnectionFailure(error)); });
    return () => { left = true; };
  }, [hostId, attempt]);

  const title = useNativeState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const present = useRef(true);
  useEffect(() => { present.current = true; return () => { present.current = false; }; }, []);

  const toggle = useCallback((name: string) => {
    setChosen((previous) => toggled(previous, name));
  }, []);

  const save = useCallback(() => {
    if (creating || tags === null) return;
    const wanted = title.value.trim();
    if (wanted === '') {
      setError('Give the Topic a title.');
      return;
    }

    setCreating(true);
    setError(undefined);
    void (async () => {
      const store = deviceHostStore();
      const records = await store.load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        setError('This Host is no longer saved.');
        setCreating(false);
        return;
      }

      let made: NewTopicRead;
      try {
        made = await appConnections().write(host, (transport, muxify) =>
          muxify.create(
            (command) => transport.exec(command),
            wanted,
            // In Config order, as the Mac lists a Topic's Tags.
            tags.filter((tag) => chosen.has(tag.name)).map((tag) => tag.name),
          ),
        );
      } catch (caught) {
        made = { kind: 'failed', error: describeConnectionFailure(caught) };
      }
      if (!present.current) return;
      if (made.kind === 'failed') {
        setError(made.error);
        setCreating(false);
        return;
      }

      router.replace({ pathname: '/topic-add-session', params: { hostId, topicId: made.topic, created: '1',
        seed: topicSeedParam({ id: made.topic, label: wanted, note: null,
          tags: tags.filter((tag) => chosen.has(tag.name)).map((tag) => tag.name), state: 'empty', sessions: [] }) } });
    })();
  }, [creating, title, hostId, tags, chosen, router]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'New Topic',
          gestureEnabled: !creating,
          headerLeft: () => (
            <ToolbarWord
              label="Cancel"
              disabled={creating}
              color={palette.controlAccent}
              bold={false}
              onPress={() => { if (!creating) router.back(); }}
            />
          ),
          headerRight: () => (
            <ToolbarWord
              label={creating ? 'Saving…' : 'Save'}
              color={creating || tags === null ? palette.secondaryLabel : palette.controlAccent}
              disabled={creating || tags === null}
              onPress={save}
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
          <Section
            header={<SectionHeader palette={palette}>Title</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={title}
              placeholder="Fix login"
              modifiers={[accessibilityLabel('Topic title')]}
            />
            <FieldError error={error} palette={palette} />
          </Section>

          {tags === null ? <Section
            header={<SectionHeader palette={palette}>Tags</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Text>{tagError ?? 'Reading Tags…'}</Text>
            {tagError ? <Button label="Retry Tags" onPress={() => setAttempt((value) => value + 1)} /> : null}
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
