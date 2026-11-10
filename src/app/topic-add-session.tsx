import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { appConnections } from '@/tmux/ssh-connection';
import type { AddSessionRead } from '@/topics/add-session';
import type { TopicId } from '@/topics/environment';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin } from '@/tmux/attach-holder';
import { topicSeedFromParam } from '@/topics/topic-detail';
import { describeError } from '@/lib/describe-error';

const say = speakingAs(deviceLog(), 'add-session');

export default function TopicAddSessionScreen() {
  const router = useRouter();
  const { hostId, topicId, seed: seedParam, fromAttach } = useLocalSearchParams<{
    hostId: string; topicId: string; seed?: string; fromAttach?: string;
  }>();
  const seed = useMemo(() => { const value = topicSeedFromParam(seedParam); return value?.id === topicId ? value : null; }, [seedParam, topicId]);
  const holder = useAttachHolder();
  const openSession = useOpenSession();
  const [origin] = useState(() => {
    const attach = holder.current();
    return fromAttach ? captureAttachOrigin(attach) : undefined;
  });
  const [completion, setCompletion] = useState<string | null>(null);
  const present = useRef(true);
  useEffect(() => { present.current = true; return () => { present.current = false; }; }, []);
  const { appearance, palette } = useSettings();

  const folder = useNativeState('');
  const [error, setError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  const save = useCallback(() => {
    if (adding) return;
    const wanted = folder.value.trim();
    if (!completion && wanted === '') {
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

      let added: AddSessionRead = completion ? { kind: 'added', session: completion } : { kind: 'failed', error: '' };
      try {
        if (!completion) added = await appConnections().write(host, (transport, muxify) =>
          muxify.addSession(
            (command) => transport.exec(command),
            topicId as TopicId,
            wanted,
          ),
        );
      } catch (caught) {
        added = { kind: 'failed', error: describeConnectionFailure(caught) };
      }
      if (!present.current) return;
      if (added.kind === 'failed') {
        say(`${host.displayName} made no Session: ${added.error}`);
        setError(added.error);
        setAdding(false);
        return;
      }

      say(`${host.displayName} made ${added.session}`);
      setCompletion(added.session);
      try {
        if (origin && !origin.attach) throw new Error('The Attach has ended. Open the Session from Home.');
        await openSession({ hostId, destination: { sessionName: added.session, topic: { id: topicId as TopicId, seed } }, origin });
        if (present.current) router.dismissTo('/terminal');
      } catch (caught) {
        if (present.current) { setError(describeError(caught)); setAdding(false); }
      }
    })();
  }, [adding, folder, hostId, topicId, router, completion, openSession, origin, seed]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'Add a Session',
          gestureEnabled: !adding,
          headerLeft: () => (
            <ToolbarWord
              label="Cancel"
              disabled={adding}
              color={palette.controlAccent}
              bold={false}
              onPress={() => { if (!adding) router.back(); }}
            />
          ),
          headerRight: () => (
            <ToolbarWord
              label={adding ? 'Saving…' : completion ? 'Retry Attach' : 'Save'}
              color={adding ? palette.secondaryLabel : palette.controlAccent}
              disabled={adding}
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
