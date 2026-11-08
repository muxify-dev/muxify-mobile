import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
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
  accessibilityValue,
  background,
  buttonStyle,
  controlSize,
  environment,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { SectionHeader } from '@/components/section-header';
import { ToolbarWord } from '@/components/toolbar-word';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { withHostTransport } from '@/tmux/ssh-connection';
import type { Tag } from '@/topics/environment';
import { createMuxifyCli } from '@/topics/muxify-cli';
import type { NewTopicRead } from '@/topics/new-topic';
import { tagsFromParam } from '@/topics/new-topic';
import { tagColorHex, type ColorAppearance } from '@/topics/tag-color';

const say = speakingAs(deviceLog(), 'new-topic');

/**
 * Makes an Empty Topic on a Host, as New Topic on the Mac does, and then opens
 * its Topic Screen, which is where a Session gets added to it.
 *
 * The Tags to choose from are the ones the Host Screen's last read had, passed
 * in by the Host Screen, so the sheet opens without a read of its own. An error
 * from the Host keeps the sheet open with the title and Tags as they were.
 */
export default function TopicFormScreen() {
  const router = useRouter();
  const { hostId, tags: tagsJson } = useLocalSearchParams<{
    hostId: string;
    tags?: string;
  }>();
  const { appearance, palette } = useSettings();
  const tags = useMemo(() => tagsFromParam(tagsJson), [tagsJson]);

  const title = useNativeState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const toggle = useCallback((name: string) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

  const save = useCallback(() => {
    if (creating) return;
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
        made = await withHostTransport(host, store, (transport) =>
          createMuxifyCli(say).create(
            (command) => transport.exec(command),
            wanted,
            // In Config order, as the Mac lists a Topic's Tags.
            tags.filter((tag) => chosen.has(tag.name)).map((tag) => tag.name),
          ),
        );
      } catch (caught) {
        made = { kind: 'failed', error: describeConnectionFailure(caught) };
      }
      if (made.kind === 'failed') {
        setError(made.error);
        setCreating(false);
        return;
      }

      router.back();
      router.push({
        pathname: '/topic',
        params: { hostId, topicId: made.topic, label: wanted },
      });
    })();
  }, [creating, title, hostId, tags, chosen, router]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'New Topic',
          headerLeft: () => (
            <ToolbarWord
              label="Cancel"
              color={palette.controlAccent}
              bold={false}
              onPress={() => router.back()}
            />
          ),
          headerRight: () => (
            <ToolbarWord
              label={creating ? 'Saving…' : 'Save'}
              color={creating ? palette.secondaryLabel : palette.controlAccent}
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
            {error === undefined ? null : (
              <Text
                modifiers={[
                  font({ size: 13 }),
                  foregroundColor(palette.destructive),
                  frame({ maxWidth: 3000, alignment: 'leading' }),
                ]}>
                {error}
              </Text>
            )}
          </Section>

          {tags.length === 0 ? null : (
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
                      color={tagColor(tag, appearance) ?? palette.secondaryLabel}
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

/** A Tag to give the new Topic: filled in its Tag colour when chosen, outlined when not. */
function TagChoice({
  tag,
  chosen,
  color,
  onPress,
}: {
  tag: Tag;
  chosen: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Button
      label={`#${tag.name}`}
      onPress={onPress}
      modifiers={[
        buttonStyle(chosen ? 'borderedProminent' : 'bordered'),
        controlSize('small'),
        tint(color),
        accessibilityLabel(`Tag #${tag.name}`),
        accessibilityValue(chosen ? 'chosen' : 'not chosen'),
      ]}
    />
  );
}

function tagColor(tag: Tag, appearance: ColorAppearance): string | null {
  const color = tag.color[appearance];
  return color === null ? null : tagColorHex(color, appearance);
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
