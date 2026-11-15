import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { HostWriteRow } from '@/components/host-write-row';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useHostWrite, type HostWriteRun } from '@/hooks/use-host-write';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';
import type { TopicId } from '@/topics/environment';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin } from '@/tmux/attach-holder';
import { topicSeedFromParam } from '@/topics/topic-detail';
import { sessionPathSections, type SessionPathsRead } from '@/topics/session-paths';

const say = speakingAs(deviceLog(), 'add-session');

export default function TopicAddSessionScreen() {
  const router = useRouter();
  const { hostId, topicId, seed: seedParam, fromAttach, created } = useLocalSearchParams<{
    hostId: string; topicId: string; seed?: string; fromAttach?: string; created?: string;
  }>();
  const seed = useMemo(() => { const value = topicSeedFromParam(seedParam); return value?.id === topicId ? value : null; }, [seedParam, topicId]);
  const holder = useAttachHolder();
  const openSession = useOpenSession();
  const [origin] = useState(() => {
    const attach = holder.current();
    return fromAttach ? captureAttachOrigin(attach) : undefined;
  });
  const { write, hostName, send, check } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';
  /** The Session this sheet made. Once there is one, the folder choices stay off and Retry Attach sends no second write. */
  const [made, setMade] = useState<string | null>(null);
  const madeRef = useRef<string | null>(null);
  /** Cancel was tapped: callbacks that were already on their way do nothing. */
  const closed = useRef(false);
  const { appearance, palette } = useSettings();

  const folder = useNativeState('');
  const [query, setQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [paths, setPaths] = useState<SessionPathsRead | { kind: 'loading' }>({ kind: 'loading' });
  const [readAttempt, setReadAttempt] = useState(0);
  const [folderError, setFolderError] = useState<string | undefined>();
  const choosing = !locked && made === null;
  const sections = paths.kind === 'listed' ? sessionPathSections(paths.choices, query) : [];
  const choose = (directory: string) => { if (!closed.current && madeRef.current === null) setSelectedFolder(directory); };

  useEffect(() => {
    let left = false;
    const settled = () => !left && !closed.current && madeRef.current === null;
    setPaths({ kind: 'loading' });
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const result = await appConnections().read(host, (transport, muxify) =>
        muxify.sessionPaths((command) => transport.exec(command), topicId as TopicId));
      if (settled()) setPaths(result);
    })().catch((caught) => {
      if (settled()) setPaths({ kind: 'failed', error: describeConnectionFailure(caught) });
    });
    return () => { left = true; };
  }, [hostId, topicId, readAttempt]);

  const attach = async (session: string, step: HostWriteRun['step']) => {
    madeRef.current = session;
    setMade(session);
    step('attaching');
    if (origin && !origin.attach) throw new Error('The Attach has ended. Open the Session from Home.');
    await openSession({ hostId, destination: { sessionName: session, topic: { id: topicId as TopicId, seed } }, origin });
    return true as const;
  };
  const opened = (done: true | undefined) => { if (done && !closed.current) router.dismissTo('/terminal'); };

  const addFolder = (wanted: string) => {
    if (closed.current || madeRef.current !== null) return;
    if (wanted === '') {
      setFolderError('Give a folder on the Host.');
      return;
    }
    setFolderError(undefined);
    void send(async ({ host, step, refuse }) => {
      const added = await appConnections().write(host, (transport, muxify) => {
        step('sending');
        return muxify.addSession((command) => transport.exec(command), topicId as TopicId, wanted);
      });
      if (added.kind === 'failed') {
        say(`${host.displayName} made no Session: ${added.error}`);
        return refuse(added.error);
      }
      say(`${host.displayName} made ${added.session}`);
      return attach(added.session, step);
    }).then(opened);
  };

  const retryAttach = () => {
    const session = madeRef.current;
    if (session === null || closed.current) return;
    void send(({ step }) => attach(session, step)).then(opened);
  };

  const create = () => (made === null ? addFolder(selectedFolder ?? folder.value.trim()) : retryAttach());

  // A new Session is one the Topic did not have when the sheet opened.
  const checkMade = () => {
    void check(async ({ host, step, refuse }) => {
      const read = await appConnections().read(host, (transport, muxify) =>
        muxify.show((command) => transport.exec(command), topicId as TopicId));
      if (read.kind === 'failed') throw new Error(read.error);
      const before = new Set(seed?.sessions.map((session) => session.id));
      const added = read.topic.sessions.find((session) => !before.has(session.id));
      if (!added) return refuse(`${read.topic.label} has no new Session on ${host.displayName}. Create and open sends it again.`);
      return attach(added.name, step);
    }).then(opened);
  };

  const cancel = () => {
    if (write.kind === 'running') return;
    closed.current = true;
    router.back();
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Add a Session', gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={cancel}>
          {created === '1' && made === null ? 'Add later' : 'Cancel'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="done"
          tintColor={palette.controlAccent}
          disabled={locked || (made === null && selectedFolder === null && query.trim() === '')}
          onPress={create}>
          {made === null ? 'Create and open' : 'Retry Attach'}
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
            words={{ host: hostName, sending: `Creating a Session in ${seed?.label ?? 'the Topic'}`,
              attaching: made === null ? undefined : `Opening ${made}`, mayHaveHappened: 'The Session may exist.' }}
            palette={palette}
            onRetry={create}
            retryLabel={made === null ? 'Retry' : 'Retry Attach'}
            onCheck={checkMade}
          />
          {created === '1' && <Section modifiers={[listRowBackground(palette.rowSurface)]}>
            <Text>{seed ? `${seed.label} was created.` : 'The Topic was created.'}</Text>
            <Text>Choose a folder to add a Session, or add one later.</Text>
          </Section>}
          {selectedFolder !== null && <Section modifiers={[listRowBackground(palette.rowSurface)]}>
            <Text>{`Selected folder: ${selectedFolder}`}</Text>
          </Section>}
          <Section
            header={<SectionHeader palette={palette}>{paths.kind === 'old' ? 'Folder on the Host' : 'Search or enter a folder'}</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={folder}
              onTextChange={(value) => { setQuery(value); setSelectedFolder(null); }}
              placeholder={paths.kind === 'old' ? '~/Dev/project' : 'Search folders or type a path'}
              modifiers={[
                accessibilityLabel(paths.kind === 'old' ? 'Folder' : 'Search folders'),
                textInputAutocapitalization('never'),
                autocorrectionDisabled(),
                disabled(!choosing),
              ]}
            />
            <FieldError error={folderError} palette={palette} />
            {paths.kind === 'loading' && <Text>Reading folders…</Text>}
            {paths.kind === 'failed' && <>
              <FieldError error={paths.error} palette={palette} />
              <Button label="Retry" onPress={() => setReadAttempt((value) => value + 1)} modifiers={[disabled(!choosing)]} />
            </>}
            {paths.kind === 'listed' && sections.length === 0 && <Text>No matching folders.</Text>}
          </Section>
          {sections.map((section) => <Section
            key={section.id}
            header={<SectionHeader palette={palette}>{section.title}</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            {section.choices.map((choice, index) => <Button
              key={`${choice.directory}:${index}`}
              onPress={() => choose(choice.directory)}
              modifiers={[disabled(!choosing), accessibilityLabel(`Select folder ${choice.directory}`)]}>
              <VStack alignment="leading" spacing={3}>
                <Text modifiers={[foregroundColor(palette.toolbarTint)]}>{selectedFolder === choice.directory ? `✓ ${choice.label}` : choice.label}</Text>
                <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel), lineLimit(1)]}>{choice.directory}</Text>
                {choice.worktree?.branch != null && <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>{choice.worktree.branch}</Text>}
                {choice.alsoIn.length > 0 && <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondaryLabel)]}>
                  {`Also in ${choice.alsoIn.map((topic) => topic.label).join(', ')}`}
                </Text>}
              </VStack>
            </Button>)}
          </Section>)}
          {paths.kind !== 'old' && query.trim() !== '' && <Section modifiers={[listRowBackground(palette.rowSurface)]}>
            <Button label={`Use ${query.trim()}`} onPress={() => choose(query.trim())} modifiers={[disabled(!choosing)]} />
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
