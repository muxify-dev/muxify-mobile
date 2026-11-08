import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Form, Host, Section, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  environment,
  listRowBackground,
  scrollContentBackground,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { SectionHeader } from '@/components/section-header';
import { ToolbarWord } from '@/components/toolbar-word';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { withHostTransport } from '@/tmux/ssh-connection';
import type { AddSessionRead } from '@/topics/add-session';
import type { TopicId } from '@/topics/environment';
import { createMuxifyCli } from '@/topics/muxify-cli';

const say = speakingAs(deviceLog(), 'add-session');

/**
 * Makes a Session in a Topic at a folder on the Host, as Add Session on the Mac
 * does from a plain folder. There is no Worktree choice on the phone.
 *
 * Save closes the sheet, and the Topic Screen under it reads the Topic again
 * as it comes back into view, so the new Session shows there. An error from
 * the Host, such as a folder that is not there, keeps the sheet open with the
 * folder as it was.
 */
export default function TopicAddSessionScreen() {
  const router = useRouter();
  const { hostId, topicId } = useLocalSearchParams<{ hostId: string; topicId: string }>();
  const { appearance, palette } = useSettings();

  const folder = useNativeState('');
  const [error, setError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  const save = useCallback(() => {
    if (adding) return;
    const wanted = folder.value.trim();
    if (wanted === '') {
      setError('Give a folder on the Host.');
      return;
    }

    setAdding(true);
    setError(undefined);
    void (async () => {
      const store = deviceHostStore();
      const records = await store.load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        setError('This Host is no longer saved.');
        setAdding(false);
        return;
      }

      let added: AddSessionRead;
      try {
        added = await withHostTransport(host, store, (transport) =>
          createMuxifyCli(say).addSession(
            (command) => transport.exec(command),
            topicId as TopicId,
            wanted,
          ),
        );
      } catch (caught) {
        added = { kind: 'failed', error: describeConnectionFailure(caught) };
      }
      if (added.kind === 'failed') {
        say(`${host.displayName} made no Session: ${added.error}`);
        setError(added.error);
        setAdding(false);
        return;
      }

      say(`${host.displayName} made ${added.session}`);
      router.back();
    })();
  }, [adding, folder, hostId, topicId, router]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'Add a Session',
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
              label={adding ? 'Saving…' : 'Save'}
              color={adding ? palette.secondaryLabel : palette.controlAccent}
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
            header={<SectionHeader palette={palette}>Folder on the Host</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={folder}
              placeholder="~/Dev/project"
              modifiers={[
                accessibilityLabel('Folder'),
                textInputAutocapitalization('never'),
                autocorrectionDisabled(),
              ]}
            />
            <FieldError error={error} palette={palette} />
          </Section>
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
