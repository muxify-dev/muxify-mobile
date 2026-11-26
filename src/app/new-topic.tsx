import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Form, Host, HStack, ScrollView, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  disabled,
  environment,
  listRowBackground,
  onSubmit,
  scrollContentBackground,
  submitLabel,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { GoToList, type FolderRow } from '@/components/go-to-list';
import { HostWriteRow } from '@/components/host-write-row';
import { SectionHeader } from '@/components/section-header';
import { TagChoice } from '@/components/tag-choice';
import { goToRows } from '@/domain/go-to';
import { useGoToPaths } from '@/hooks/use-go-to-paths';
import { useHostWrite, type HostWriteRun } from '@/hooks/use-host-write';
import { useScreenKeyboardShortcuts } from '@/keyboard/key-commands';
import { toggled } from '@/lib/toggled';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { deviceHostStore } from '@/storage/device-store';
import type { Host as HostRecord } from '@/storage/records';
import { useOpenSession } from '@/tmux/attach-context';
import { folderSessionName } from '@/topics/add-session';
import type { Tag, TopicId } from '@/topics/environment';
import { addSession, createTopic, pushedListing, pushedTopic } from '@/topics/host-writes';
import { emptyTopicTitled } from '@/topics/new-topic';
import type { TopicDetail } from '@/topics/topic-detail';
import { recordVisit } from '@/topics/visit';

/**
 * Where the sheet is. `title`: the user gives the Topic a title and Tags.
 * `add-session`: the Host has the Empty Topic, and the user picks the folder
 * of its first Session. `made` is the Session the Host made, when the Attach
 * to it failed: a second try attaches and sends no second write.
 */
type Step =
  | { step: 'title' }
  | { step: 'add-session'; topic: TopicDetail; made: string | null };

/** What the user asked for in the second step, so that Retry sends the same. */
interface Addition {
  folder: string;
  /** In a new Worktree of the folder. */
  worktree: boolean;
}

/**
 * New Topic, as ⌘N on the Mac: a title, then a Session Path. The first step
 * makes an Empty Topic on the Host. The same sheet then lists the Host's
 * Session Paths, and a pick adds a Session there and opens it. Add later
 * leaves the Empty Topic on the Host.
 */
export default function NewTopicScreen() {
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { appearance, palette } = useSettings();
  const openSession = useOpenSession();
  const [step, setStep] = useState<Step>({ step: 'title' });
  const { write, hostName, send, check, request } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';

  const [tagsAttempt, setTagsAttempt] = useState(0);
  const [tagsRead, setTagsRead] = useState<{ attempt: number; tags: Tag[] | null; error?: string } | null>(null);
  useEffect(() => {
    let left = false;
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const { tags: listed } = await pushedListing(host);
      if (!left) setTagsRead({ attempt: tagsAttempt, tags: listed });
    })().catch((error) => { if (!left) setTagsRead({ attempt: tagsAttempt, tags: null, error: describeConnectionFailure(error) }); });
    return () => { left = true; };
  }, [hostId, tagsAttempt]);
  const newestTagsRead = tagsRead?.attempt === tagsAttempt ? tagsRead : null;
  const tags = newestTagsRead?.tags ?? null;
  const tagError = newestTagsRead?.error;

  const title = useNativeState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [titleError, setTitleError] = useState<string | undefined>();
  // In Config order, as the Mac lists a Topic's Tags.
  const chosenTags = (tags ?? []).filter((tag) => chosen.has(tag.name)).map((tag) => tag.name);

  const folder = useNativeState('');
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [listedAt] = useState(() => new Date());
  const adding = step.step === 'add-session';
  const { paths, reading, ask } = useGoToPaths(hostId, true, adding && query.trim() === '');
  // Read when the sheet opens, so the list is there when the title is sent.
  useEffect(() => ask(''), [ask]);
  const rows = adding ? goToRows({ query, mode: 'paths', sessions: [], paths, recent: [] }) : [];
  const onShow = Math.min(highlighted, Math.max(rows.length - 1, 0));
  // The last add, for Retry.
  const [added, setAdded] = useState<Addition | null>(null);

  const toAddSession = (topic: TopicId | undefined, label: string) => {
    if (topic === undefined) return;
    setStep({ step: 'add-session', topic: { id: topic, label, note: null, tags: chosenTags, state: 'empty', sessions: [] }, made: null });
  };

  const create = () => {
    if (locked || step.step !== 'title') return;
    const wanted = title.value.trim();
    if (wanted === '') {
      setTitleError('Give the Topic a title.');
      return;
    }
    setTitleError(undefined);
    void request(
      JSON.stringify([wanted, chosenTags]),
      ({ host, step: at }, id) => createTopic(host, wanted, chosenTags, id, () => at('sending')),
      (made) => made.topic,
    ).then((topic) => toAddSession(topic, wanted));
  };

  const checkCreated = () => {
    const wanted = title.value.trim();
    void check(async ({ host, refuse }) => {
      return emptyTopicTitled(await pushedListing(host), wanted) ?? refuse(`${wanted} is not on ${host.displayName}. Create sends it again.`);
    }).then((topic) => toAddSession(topic, wanted));
  };

  const attach = async (topic: TopicDetail, session: string, host: HostRecord, at: HostWriteRun['step'], visited?: string) => {
    setStep({ step: 'add-session', topic, made: session });
    at('attaching');
    await openSession({ hostId, destination: { sessionName: session, topic: { id: topic.id, seed: topic } }, keyboard: 'up' });
    if (visited !== undefined) recordVisit(host, visited);
    return true as const;
  };
  const opened = (done: true | undefined) => { if (done) router.dismissTo('/terminal'); };

  const add = (addition: Addition) => {
    if (step.step !== 'add-session') return;
    const { topic, made } = step;
    if (made !== null) {
      void send(({ host, step: at }) => attach(topic, made, host, at)).then(opened);
      return;
    }
    setAdded(addition);
    void request(
      JSON.stringify([addition.folder, addition.worktree]),
      ({ host, step: at }, id) => {
        const row = paths.rows.find((candidate) => candidate.directory === addition.folder);
        const folder = { directory: addition.folder, worktree: row?.worktree ?? null, name: row?.name };
        // The Topic is new, so no Session of it has the name of the folder's Session Path. A new
        // Worktree's Session takes its name from the branch, which only the Host knows.
        const chosenName = addition.worktree ? undefined : row?.name ?? folderSessionName(addition.folder);
        return addSession(host, topic.id, folder, { newWorktree: addition.worktree, chosenName }, id, () => at('sending'));
      },
      (result, { host, step: at }) => attach(topic, result.session, host, at, addition.folder),
    ).then(opened);
  };
  const addAt = (row: FolderRow | undefined, worktree: boolean) => {
    if (row === undefined || locked) return;
    add({ folder: row.kind === 'path' ? row.path.directory : row.directory, worktree });
  };
  const retryAdd = () => { if (added) add(added); };

  const checkAdded = () => {
    if (step.step !== 'add-session') return;
    const { topic } = step;
    void check(async ({ host, step: at, refuse }) => {
      const [session] = (await pushedTopic(host, topic.id)).sessions;
      if (!session) return refuse(`${topic.label} has no Session on ${host.displayName}. Pick the folder again to add it.`);
      return attach(topic, session.name, host, at);
    }).then(opened);
  };

  // Not while a write runs: its answer would open a Session after the sheet is gone.
  const close = () => { if (write.kind !== 'running') router.back(); };

  useScreenKeyboardShortcuts(adding && !locked ? {
    'list-up': () => setHighlighted(Math.max(onShow - 1, 0)),
    'list-down': () => setHighlighted(Math.min(onShow + 1, rows.length - 1)),
    'list-pick': () => addAt(pathRow(rows[onShow]), false),
    'list-worktree': () => addAt(pathRow(rows[onShow]), true),
    'list-close': close,
  } : {});

  const form = [
    environment('colorScheme', appearance),
    scrollContentBackground('hidden'),
    background(palette.background),
    tint(palette.controlAccent),
  ];

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: step.step === 'title' ? 'New Topic' : step.topic.label, gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={close}>
          {step.step === 'title' ? 'Cancel' : 'Add later'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {step.step === 'title' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" tintColor={palette.controlAccent} disabled={locked} onPress={create}>
            Create
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}

      <Host style={styles.fill} matchContents={false}>
        {step.step === 'title' ? (
          <Form modifiers={form}>
            <HostWriteRow
              write={write}
              words={{ host: hostName, sending: `Creating ${title.value.trim()}`, mayHaveHappened: 'The Topic may exist.' }}
              palette={palette}
              onRetry={create}
              onCheck={checkCreated}
            />
            <Section
              header={<SectionHeader palette={palette}>Title</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <TextField
                text={title}
                autoFocus
                placeholder="Fix login"
                modifiers={[accessibilityLabel('Topic title'), disabled(locked), submitLabel('next'), onSubmit(create)]}
              />
              <FieldError error={titleError} palette={palette} />
            </Section>

            {tags === null ? <Section
              header={<SectionHeader palette={palette}>Tags</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <Text>{tagError ?? 'Reading Tags…'}</Text>
              {tagError ? <Button label="Try again" onPress={() => setTagsAttempt((value) => value + 1)} modifiers={[disabled(locked)]} /> : null}
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
                        onPress={() => setChosen((previous) => toggled(previous, tag.name))}
                      />
                    ))}
                  </HStack>
                </ScrollView>
              </Section>
            )}
          </Form>
        ) : (
          <Form modifiers={form}>
            <HostWriteRow
              write={write}
              words={{
                host: hostName,
                sending: `Creating a Session in ${step.topic.label}`,
                attaching: step.made === null ? undefined : `Opening ${step.made}`,
                mayHaveHappened: 'The Session may exist.',
              }}
              palette={palette}
              onRetry={retryAdd}
              retryLabel={step.made === null ? 'Retry' : 'Retry Attach'}
              onCheck={checkAdded}
            />
            <Section
              header={<SectionHeader palette={palette}>Add a Session</SectionHeader>}
              modifiers={[listRowBackground(palette.rowSurface)]}>
              <TextField
                text={folder}
                autoFocus
                onTextChange={(value) => {
                  setQuery(value);
                  setHighlighted(0);
                  ask(value);
                }}
                placeholder="Search folders or type a path"
                modifiers={[
                  accessibilityLabel('Search folders'),
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  disabled(locked || step.made !== null),
                  submitLabel('go'),
                  onSubmit(() => addAt(pathRow(rows[onShow]), false)),
                ]}
              />
            </Section>
            <GoToList
              rows={rows}
              highlighted={onShow}
              reading={reading}
              palette={palette}
              now={listedAt}
              locked={locked || step.made !== null}
              onPick={(row) => addAt(pathRow(row), false)}
              folderMenu={{ label: 'In a new Worktree', icon: 'arrow.triangle.branch', onPress: (row) => addAt(row, true) }}
            />
          </Form>
        )}
      </Host>
    </View>
  );
}

/** The list of this sheet has no running Session, so every row is a folder. */
function pathRow(row: ReturnType<typeof goToRows>[number] | undefined): FolderRow | undefined {
  return row?.kind === 'session' ? undefined : row;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
