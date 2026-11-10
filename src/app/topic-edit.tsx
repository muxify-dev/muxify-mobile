import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  environment,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { SectionHeader } from '@/components/section-header';
import { RetiredTagChoice, TagChoice } from '@/components/tag-choice';
import { ToolbarWord } from '@/components/toolbar-word';
import type { Appearance } from '@/constants/app-theme';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { toggled } from '@/lib/toggled';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';
import type { Tag, TopicId } from '@/topics/environment';
import { useAttachHolder } from '@/tmux/attach-context';
import {
  changes,
  fieldsFromParam,
  saveTopicEdit,
  typedFields,
  unsent,
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
 * next Save sends only what still differs. The Attach reads the Topic again after each Save and on return.
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
      const result = await appConnections().read(host, (transport, muxify) => muxify.read((command) => transport.exec(command)));
      if (result.kind !== 'listed') throw new Error(result.kind === 'failed' ? result.error : 'Update Muxify on this Host to edit Tags.');
      if (!left) setConfigTags(result.snapshot.tags);
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
    {tagError ? <Pressable accessibilityLabel="Retry" onPress={() => setAttempt((value) => value + 1)}><RNText style={{ color: palette.controlAccent }}>Retry</RNText></Pressable> : null}
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
  const holder = useAttachHolder();
  const present = useRef(true);
  useEffect(() => { present.current = true; return () => { present.current = false; }; }, []);
  const { appearance } = useSettings();

  const title = useNativeState(opened.title);
  const note = useNativeState(opened.note ?? '');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(opened.tags));
  const [saved, setSaved] = useState(opened);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const retired = useMemo(
    () => opened.tags.filter((name) => !configTags.some((tag) => tag.name === name)),
    [opened, configTags],
  );

  const toggle = useCallback((name: string) => {
    setChosen((previous) => toggled(previous, name));
  }, []);

  const save = useCallback(() => {
    if (saving) return;
    const wanted = typedFields(
      title.value,
      note.value,
      // In Config order, as the Mac lists a Topic's Tags, with the kept retired ones last.
      [...configTags.map((tag) => tag.name), ...retired].filter((name) => chosen.has(name)),
    );
    if (wanted.title === '') {
      setErrors({ title: 'Give the Topic a title.' });
      return;
    }
    if (changes(saved, wanted).length === 0) {
      router.back();
      return;
    }

    setSaving(true);
    setErrors({});
    void (async () => {
      const store = deviceHostStore();
      const host = (await store.load()).hosts.find((candidate) => candidate.id === hostId);
      let outcome: { saved: TopicFields; errors: FieldErrors };
      if (!host) {
        outcome = {
          saved,
          errors: unsent(saved, wanted, 'This Host is no longer saved.'),
        };
      } else {
        try {
          outcome = await appConnections().write(host, (transport, muxify) =>
            saveTopicEdit(saved, wanted, (change) =>
              muxify
                .change((command) => transport.exec(command), topicId, change)
                .catch((caught: unknown) => ({
                  kind: 'failed' as const,
                  error: describeConnectionFailure(caught),
                })),
            ),
          );
        } catch (caught) {
          outcome = {
            saved,
            errors: unsent(saved, wanted, describeConnectionFailure(caught)),
          };
        }
      }

      const attached = holder.current();
      if (attached?.hostId === hostId && attached.state().topic?.id === topicId) void attached.refreshTopic();
      if (!present.current) return;
      const refused = Object.keys(outcome.errors);
      say(
        refused.length === 0
          ? 'saved a Topic edit'
          : `the Host refused a Topic edit of ${refused.join(', ')}`,
      );
      setSaved(outcome.saved);
      setSaving(false);
      if (refused.length === 0) router.back();
      else setErrors(outcome.errors);
    })();
  }, [saving, title, note, configTags, retired, chosen, saved, hostId, topicId, router, holder]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'Edit Topic',
          gestureEnabled: !saving,
          headerLeft: () => (
            <ToolbarWord
              label="Cancel"
              disabled={saving}
              color={palette.controlAccent}
              bold={false}
              onPress={() => { if (!saving) router.back(); }}
            />
          ),
          headerRight: () => (
            <ToolbarWord
              label={saving ? 'Saving…' : 'Save'}
              color={saving ? palette.secondaryLabel : palette.controlAccent}
              disabled={saving}
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
            <TextField text={title} modifiers={[accessibilityLabel('Topic title')]} />
            <FieldError error={errors.title} palette={palette} />
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Topic Note</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={note}
              placeholder="No Note"
              modifiers={[accessibilityLabel('Topic Note')]}
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
