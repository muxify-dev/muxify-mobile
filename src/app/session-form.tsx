import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Form, Host, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  environment,
  disabled,
  font,
  foregroundColor,
  listRowBackground,
  scrollContentBackground,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { HostWriteRow } from '@/components/host-write-row';
import type { Appearance } from '@/constants/app-theme';
import { useHostWrite, type HostWriteRun } from '@/hooks/use-host-write';
import { useSettings } from '@/settings/settings-context';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { useOpenSession } from '@/tmux/attach-context';
import { TmuxClient } from '@/tmux/tmux-client';
import { TmuxError } from '@/tmux/tmux-error';

/**
 * Makes a Session on a Host.
 *
 * The one place Muxify changes what tmux is running rather than just looking
 * at it — see ADR 0005. A Session is made detached and then attached to like
 * any other, so everything after this point is the ordinary path.
 */
export default function SessionFormScreen() {
  const router = useRouter();
  const openSession = useOpenSession();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { appearance, palette } = useSettings();
  const { write, hostName, send, check } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';
  /** The Session this sheet made: a later tap attaches to it and sends no second write. */
  const [made, setMade] = useState<string | null>(null);

  const name = useNativeState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const attach = async (session: string, step: HostWriteRun['step']) => {
    setMade(session);
    step('attaching');
    await openSession({ hostId, destination: { sessionName: session, topic: null } });
    return true as const;
  };
  const opened = (done: true | undefined) => { if (done) router.dismissTo('/terminal'); };

  const create = () => {
    if (locked) return;
    const wanted = made ?? name.value.trim();
    if (wanted === '') {
      setNameError('Give the Session a name.');
      return;
    }
    setNameError(undefined);
    void send(async ({ host, step, refuse }) => {
      if (!made) await appConnections().write(host, async (transport) => {
        step('sending');
        // Loud when the name is taken, rather than silently handing back
        // someone else's Session — see createSessionCommand.
        try {
          await new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).createSession(wanted);
        } catch (caught) {
          if (!(caught instanceof TmuxError)) throw caught;
          const aboutName = nameRefusal(caught);
          refuse(aboutName ?? caught.message, aboutName ? { name: aboutName } : undefined);
        }
      });
      return attach(wanted, step);
    }).then(opened);
  };

  const checkMade = () => {
    const wanted = name.value.trim();
    void check(async ({ host, step, refuse }) => {
      const sessions = await appConnections().read(host, (transport) =>
        new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions());
      if (!sessions.some((session) => session.name === wanted)) refuse(`${wanted} is not on ${host.displayName}. Create makes it.`);
      return attach(wanted, step);
    }).then(opened);
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'New Session', gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" tintColor={palette.controlAccent} disabled={locked} onPress={create}>
          {made ? 'Retry Attach' : 'Create'}
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
            words={{ host: hostName, sending: `Creating ${name.value.trim()}`, attaching: `Opening ${name.value.trim()}`,
              mayHaveHappened: 'The Session may exist.' }}
            palette={palette}
            onRetry={create}
            retryLabel={made ? 'Retry Attach' : 'Retry'}
            onCheck={checkMade}
          />
          <Section
            header={<Header palette={palette}>Name</Header>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                The Session keeps this name on the Host, and every other tmux client
                sees it.
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={name}
              placeholder="notes"
              modifiers={[
                font({ design: 'monospaced' }),
                textInputAutocapitalization('never'),
                autocorrectionDisabled(),
                accessibilityLabel('Session name'),
                disabled(locked || made !== null),
              ]}
            />
            <FieldError error={nameError ?? (write.kind === 'failed' ? write.fields?.name : undefined)} palette={palette} />
          </Section>
        </Form>
      </Host>
    </View>
  );
}

/** Why tmux refused the name, for the two refusals that are about it. */
function nameRefusal(error: TmuxError): string | undefined {
  if (/duplicate session/i.test(error.message)) {
    return 'A Session with that name is already running on this Host.';
  }
  if (/bad session name|invalid/i.test(error.message)) {
    return 'tmux will not accept that name. Avoid dots and colons.';
  }
  return undefined;
}

function Header({ children, palette }: { children: string; palette: Appearance }) {
  return (
    <Text
      modifiers={[font({ size: 13, weight: 'semibold' }), foregroundColor(palette.sectionHeader)]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
