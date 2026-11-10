import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Form, Host, Section, Text, TextField, VStack, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  disabled,
  environment,
  font,
  foregroundColor,
  lineLimit,
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
import type { TopicId } from '@/topics/environment';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin } from '@/tmux/attach-holder';
import { topicSeedFromParam } from '@/topics/topic-detail';
import { describeError } from '@/lib/describe-error';
import { sessionPathSections, type SessionPathsRead } from '@/topics/session-paths';

const say = speakingAs(deviceLog(), 'add-session');

type Operation =
  | { kind: 'ready' }
  | { kind: 'creating' }
  | { kind: 'created'; session: string; attaching: boolean };

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
  const [operation, setOperation] = useState<Operation>({ kind: 'ready' });
  const currentOperation = useRef<Operation>(operation);
  const changeOperation = useCallback((next: Operation) => {
    currentOperation.current = next;
    if (present.current) setOperation(next);
  }, []);
  const present = useRef(true);
  useEffect(() => { present.current = true; return () => { present.current = false; }; }, []);
  const { appearance, palette } = useSettings();

  const folder = useNativeState('');
  const [query, setQuery] = useState('');
  const [paths, setPaths] = useState<SessionPathsRead | { kind: 'loading' }>({ kind: 'loading' });
  const [readAttempt, setReadAttempt] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const adding = operation.kind === 'creating' || (operation.kind === 'created' && operation.attaching);
  const completion = operation.kind === 'created' ? operation.session : null;
  const sections = paths.kind === 'listed' ? sessionPathSections(paths.choices, query) : [];

  useEffect(() => {
    let left = false;
    setPaths({ kind: 'loading' });
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const result = await appConnections().read(host, (transport, muxify) =>
        muxify.sessionPaths((command) => transport.exec(command), topicId as TopicId));
      if (!left && present.current && currentOperation.current.kind !== 'created') setPaths(result);
    })().catch((caught) => {
      if (!left && present.current && currentOperation.current.kind !== 'created') setPaths({ kind: 'failed', error: describeConnectionFailure(caught) });
    });
    return () => { left = true; };
  }, [hostId, topicId, readAttempt]);

  const attachSession = useCallback(async (session: string) => {
    changeOperation({ kind: 'created', session, attaching: true });
    setError(undefined);
    try {
      if (origin && !origin.attach) throw new Error('The Attach has ended. Open the Session from Home.');
      await openSession({ hostId, destination: { sessionName: session, topic: { id: topicId as TopicId, seed } }, origin });
      if (present.current) router.dismissTo('/terminal');
    } catch (caught) {
      if (present.current) setError(describeError(caught));
      changeOperation({ kind: 'created', session, attaching: false });
    }
  }, [changeOperation, hostId, topicId, seed, origin, openSession, router]);

  const addFolder = useCallback((wanted: string) => {
    if (currentOperation.current.kind !== 'ready' || !present.current) return;
    if (wanted === '') {
      setError('Give a folder on the Host.');
      return;
    }
    changeOperation({ kind: 'creating' });
    setError(undefined);
    void (async () => {
      try {
        const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
        if (!host) throw new Error('This Host is no longer saved.');
        if (!present.current) return;
        const added = await appConnections().write(host, (transport, muxify) =>
          muxify.addSession((command) => transport.exec(command), topicId as TopicId, wanted));
        if (added.kind === 'failed') {
          say(`${host.displayName} made no Session: ${added.error}`);
          if (present.current) setError(added.error);
          changeOperation({ kind: 'ready' });
          return;
        }
        say(`${host.displayName} made ${added.session}`);
        changeOperation({ kind: 'created', session: added.session, attaching: false });
        if (present.current) await attachSession(added.session);
      } catch (caught) {
        if (present.current) setError(describeConnectionFailure(caught));
        changeOperation({ kind: 'ready' });
      }
    })();
  }, [changeOperation, hostId, topicId, attachSession]);

  const retryAttach = useCallback(() => {
    const current = currentOperation.current;
    if (current.kind === 'created' && !current.attaching && present.current) void attachSession(current.session);
  }, [attachSession]);

  const cancel = () => {
    const current = currentOperation.current;
    if (current.kind === 'creating' || (current.kind === 'created' && current.attaching)) return;
    present.current = false;
    router.back();
  };

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
              onPress={cancel}
            />
          ),
          headerRight: () => (paths.kind === 'old' || completion || adding) ? (
            <ToolbarWord
              label={adding ? 'Saving…' : completion ? 'Retry Attach' : 'Save'}
              color={adding ? palette.secondaryLabel : palette.controlAccent}
              disabled={adding}
              onPress={completion ? retryAttach : () => addFolder(folder.value.trim())}
            />
          ) : null,
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
            header={<SectionHeader palette={palette}>{paths.kind === 'old' ? 'Folder on the Host' : 'Search or enter a folder'}</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={folder}
              onTextChange={setQuery}
              placeholder={paths.kind === 'old' ? '~/Dev/project' : 'Search folders or type a path'}
              modifiers={[
                accessibilityLabel(paths.kind === 'old' ? 'Folder' : 'Search folders'),
                textInputAutocapitalization('never'),
                autocorrectionDisabled(),
                disabled(operation.kind !== 'ready'),
              ]}
            />
            <FieldError error={error} palette={palette} />
            {paths.kind === 'loading' && <Text>Reading folders…</Text>}
            {paths.kind === 'failed' && <>
              <FieldError error={paths.error} palette={palette} />
              <Button label="Retry" onPress={() => setReadAttempt((value) => value + 1)} modifiers={[disabled(operation.kind !== 'ready')]} />
            </>}
            {paths.kind === 'listed' && sections.length === 0 && <Text>No matching folders.</Text>}
          </Section>
          {sections.map((section) => <Section
            key={section.id}
            header={<SectionHeader palette={palette}>{section.title}</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            {section.choices.map((choice, index) => <Button
              key={`${choice.directory}:${index}`}
              onPress={() => addFolder(choice.directory)}
              modifiers={[disabled(operation.kind !== 'ready'), accessibilityLabel(`Add Session at ${choice.directory}`)]}>
              <VStack alignment="leading" spacing={3}>
                <Text modifiers={[foregroundColor(palette.toolbarTint)]}>{choice.label}</Text>
                <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel), lineLimit(1)]}>{choice.directory}</Text>
                {choice.worktree?.branch != null && <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>{choice.worktree.branch}</Text>}
                {choice.alsoIn.length > 0 && <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                  {`Also in ${choice.alsoIn.map((topic) => topic.label).join(', ')}`}
                </Text>}
              </VStack>
            </Button>)}
          </Section>)}
          {paths.kind !== 'old' && query.trim() !== '' && <Section modifiers={[listRowBackground(palette.rowSurface)]}>
            <Button label={`Use ${query.trim()}`} onPress={() => addFolder(query.trim())} modifiers={[disabled(operation.kind !== 'ready')]} />
          </Section>}

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
