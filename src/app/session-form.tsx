import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Form, Host, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  environment,
  font,
  foregroundColor,
  listRowBackground,
  scrollContentBackground,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { ToolbarWord } from '@/components/toolbar-word';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { execCommandRunner } from '@/tmux/exec-runner';
import { withHostTransport } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';

/**
 * Makes a Session on a Host.
 *
 * The one place Muxify changes what tmux is running rather than just looking
 * at it — see ADR 0005. A Session is made detached and then attached to like
 * any other, so everything after this point is the ordinary path.
 */
export default function SessionFormScreen() {
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { appearance, palette } = useSettings();

  const name = useNativeState('');
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const create = useCallback(() => {
    if (creating) return;
    const wanted = name.value.trim();
    if (wanted === '') {
      setError('Give the Session a name.');
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

      try {
        await withHostTransport(host, store, async (transport) => {
          const client = new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath));
          // Loud when the name is taken, rather than silently handing back
          // someone else's Session — see createSessionCommand.
          await client.createSession(wanted);
        });
      } catch (caught) {
        setError(describeCreateFailure(caught));
        setCreating(false);
        return;
      }

      // Straight into it: making a Session and then having to find it in a
      // list is a step nobody wants.
      router.back();
      router.push({ pathname: '/terminal', params: { hostId, session: wanted } });
    })();
  }, [creating, name, hostId, router]);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: 'New Session',
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
              label={creating ? 'Creating…' : 'Create'}
              color={creating ? palette.secondaryLabel : palette.controlAccent}
              onPress={create}
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
              ]}
            />
            <FieldError error={error} palette={palette} />
          </Section>
        </Form>
      </Host>
    </View>
  );
}

/**
 * tmux's own words for the two things that actually go wrong here, and the
 * Connection's for everything else.
 */
function describeCreateFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/duplicate session/i.test(message)) {
    return 'A Session with that name is already running on this Host.';
  }
  if (/bad session name|invalid/i.test(message)) {
    return 'tmux will not accept that name. Avoid dots and colons.';
  }
  return describeConnectionFailure(error);
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
