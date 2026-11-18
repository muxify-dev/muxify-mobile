import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import {
  Form,
  Host,
  HStack,
  ScrollView,
  Section,
  Text,
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
import { RetiredTagChoice, TagChoice } from '@/components/tag-choice';
import { HostWriteRow } from '@/components/host-write-row';
import type { Appearance } from '@/constants/app-theme';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useHostWrite } from '@/hooks/use-host-write';
import { toggled } from '@/lib/toggled';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { deviceHostStore } from '@/storage/device-store';
import type { Tag, TopicId } from '@/topics/environment';
import { changeTopic, pushedListing, pushedTopic } from '@/topics/host-writes';
import { newRequestId } from '@/topics/request';
import {
  changes,
  fieldsFromParam,
  saveTopicEdit,
  typedFields,
  type FieldErrors,
  type TopicFields,
} from '@/topics/topic-edit';

const say = speakingAs(deviceLog(), 'edit-topic');

/**
 * Changes a Topic's title, Topic Note and Tags, as Rename Topic, Set Topic
 * Note and the Tag menu do on the Mac.
 *
 * Save sends only the fields that differ from what the Host last had. A field
 * the Host refuses shows its reason under it and the sheet stays open, and the
 * next Save sends only what still differs. The Host Server pushes the change
 * to the Attach, which reads nothing after a Save.
 */
export default function TopicEditScreen() {
  const { hostId, topicId, topic } = useLocalSearchParams<{
    hostId: string;
    topicId: string;
    topic?: string;
  }>();
  const opened = useMemo(() => fieldsFromParam(topic), [topic]);
  const [configTags, setConfigTags] = useState<Tag[] | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let left = false;
    setTagError(null);
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const { tags: listed } = await pushedListing(host);
      if (!left) setConfigTags(listed);
    })().catch((error) => { if (!left) setTagError(describeConnectionFailure(error)); });
    return () => { left = true; };
  }, [hostId, attempt]);
  const { palette } = useSettings();

  if (opened === null) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Stack.Screen options={{ title: 'Edit Topic' }} />
        <Text>This link names no Topic to edit.</Text>
      </View>
    );
  }
  if (configTags === null) return <View style={[styles.fill, styles.center]}>
    <Stack.Screen options={{ title: 'Edit Topic' }} />
    <RNText style={{ color: palette.secondaryLabel }}>{tagError ?? 'Reading Tags…'}</RNText>
    {tagError ? <Pressable accessibilityLabel="Try again" onPress={() => setAttempt((value) => value + 1)}><RNText style={{ color: palette.controlAccent }}>Try again</RNText></Pressable> : null}
  </View>;
  return (
    <EditForm
      hostId={hostId}
      topicId={topicId as TopicId}
      opened={opened}
      configTags={configTags}
      palette={palette}
    />
  );
}

function EditForm({
  hostId,
  topicId,
  opened,
  configTags,
  palette,
}: {
  hostId: string;
  topicId: TopicId;
  opened: TopicFields;
  configTags: Tag[];
  palette: Appearance;
}) {
  const router = useRouter();
  const { appearance } = useSettings();
  const { write, hostName, send, check } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';

  const title = useNativeState(opened.title);
  const note = useNativeState(opened.note ?? '');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(opened.tags));
  const [saved, setSaved] = useState(opened);
  const [titleError, setTitleError] = useState<string | undefined>();
  const errors: FieldErrors = { ...(write.kind === 'failed' ? write.fields : undefined), ...(titleError ? { title: titleError } : {}) };

  const retired = useMemo(
    () => opened.tags.filter((name) => !configTags.some((tag) => tag.name === name)),
    [opened, configTags],
  );

  const toggle = useCallback((name: string) => {
    setChosen((previous) => toggled(previous, name));
  }, []);

  const wanted = () => typedFields(
    title.value,
    note.value,
    // In Config order, as the Mac lists a Topic's Tags, with the kept retired ones last.
    [...configTags.map((tag) => tag.name), ...retired].filter((name) => chosen.has(name)),
  );

  // Nothing is read after a Save: the Host Server pushes the Topic to the Attach.
  const finished = (done: true | undefined) => {
    if (done) router.back();
  };

  const save = () => {
    if (locked) return;
    const fields = wanted();
    if (fields.title === '') {
      setTitleError('Give the Topic a title.');
      return;
    }
    setTitleError(undefined);
    if (changes(saved, fields).length === 0) {
      router.back();
      return;
    }
    // One Request id for each field write, made before the work, so that a
    // second send of a field whose answer was lost goes with its first id.
    const requests = new Map(changes(saved, fields).map(({ field }) => [field, newRequestId()]));
    void send(async ({ host, step, refuse, unsure }) => {
      const outcome = await saveTopicEdit(saved, fields, (change) =>
        changeTopic(host, topicId, change, requests.get(change.field)!, () => step('sending')));
      setSaved(outcome.saved);
      if (outcome.inDoubt !== undefined) unsure(outcome.inDoubt);
      const refused = Object.keys(outcome.errors);
      say(refused.length === 0 ? 'saved a Topic edit' : `the Host refused a Topic edit of ${refused.join(', ')}`);
      if (refused.length > 0) refuse(`${host.displayName} refused part of the edit.`, outcome.errors);
      return true as const;
    }).then(finished);
  };

  const checkSaved = () => {
    const fields = wanted();
    void check(async ({ host, refuse }) => {
      const topic = await pushedTopic(host, topicId);
      const onHost: TopicFields = { title: topic.label, note: topic.note, tags: topic.tags };
      setSaved(onHost);
      if (changes(onHost, fields).length > 0) refuse(`Some changes are not on ${host.displayName}. Save sends them.`);
      return true as const;
    }).then(finished);
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Edit Topic', gestureEnabled: write.kind !== 'running' }} />
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
            words={{ host: hostName, sending: `Saving ${saved.title}`, mayHaveHappened: 'The changes may be saved.' }}
            palette={palette}
            onRetry={save}
            onCheck={checkSaved}
          />
          <Section
            header={<SectionHeader palette={palette}>Title</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField text={title} modifiers={[accessibilityLabel('Topic title'), disabled(locked)]} />
            <FieldError error={errors.title} palette={palette} />
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Topic Note</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={note}
              placeholder="No Note"
              modifiers={[accessibilityLabel('Topic Note'), disabled(locked)]}
            />
            <FieldError error={errors.note} palette={palette} />
          </Section>

          {configTags.length === 0 && retired.length === 0 ? null : (
            <Section
              header={<SectionHeader palette={palette}>Tags</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <ScrollView axes="horizontal" showsIndicators={false}>
                <HStack spacing={8}>
                  {configTags.map((tag) => (
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
                  {retired
                    .filter((name) => chosen.has(name))
                    .map((name) => (
                      <RetiredTagChoice
                        key={name}
                        name={name}
                        color={palette.secondaryLabel}
                        disabled={locked}
                        onPress={() => toggle(name)}
                      />
                    ))}
                </HStack>
              </ScrollView>
              <FieldError error={errors.tags} palette={palette} />
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
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
