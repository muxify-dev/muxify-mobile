import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import {
  Form,
  Host,
  Picker,
  SecureField,
  Section,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  environment,
  font,
  foregroundColor,
  frame,
  keyboardType,
  listRowBackground,
  lineLimit,
  pickerStyle,
  scrollContentBackground,
  tag,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { ToolbarGlyphButton } from '@/components/toolbar-glyph-button';
import type { Appearance } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import {
  emptyHostDraft,
  validateHostDraft,
  type HostDraft,
  type HostDraftField,
  type IdentityKind,
} from '@/domain/validate-host-draft';
import { deviceHostStore } from '@/storage/device-store';

/**
 * Add or edit a Host, as a sheet over the list.
 *
 * One form for both, because a typo in an address should not mean recreating
 * the Host and losing what is attached to it. Editing keeps the Host's id, so
 * its Fingerprint and its place in the list survive.
 *
 * Validation runs here, before any Connection: a typo should produce an
 * immediate, specific answer rather than a network error thirty seconds later.
 */
export default function HostFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loaded, setLoaded] = useState<{ draft: HostDraft; identityId?: string } | null>(null);

  useEffect(() => {
    void (async () => {
      if (!id) {
        setLoaded({ draft: emptyHostDraft() });
        return;
      }
      const records = await deviceHostStore().load();
      const host = records.hosts.find((candidate) => candidate.id === id);
      if (!host) {
        setLoaded({ draft: emptyHostDraft() });
        return;
      }
      const identity = records.identities.find((candidate) => candidate.id === host.identityId);
      setLoaded({
        identityId: host.identityId,
        draft: {
          ...emptyHostDraft(),
          displayName: host.displayName,
          address: host.address,
          port: String(host.port),
          username: identity?.username ?? '',
          tmuxExecutablePath: host.tmuxExecutablePath ?? '',
          identityKind: identity?.kind ?? 'password',
        },
      });
    })();
  }, [id]);

  // Remounted once the record arrives, because the native fields take their
  // starting text when they are created and there is nothing to set it with
  // afterwards that would not fight the user's typing.
  if (!loaded) return <View style={styles.fill} />;
  return <HostForm hostId={id} identityId={loaded.identityId} initial={loaded.draft} />;
}

function HostForm({
  hostId,
  identityId,
  initial,
}: {
  hostId?: string;
  identityId?: string;
  initial: HostDraft;
}) {
  const router = useRouter();
  const { appearance, palette } = useSettings();
  const [errors, setErrors] = useState<Partial<Record<HostDraftField, string>>>({});
  const [identityKind, setIdentityKind] = useState<IdentityKind>(initial.identityKind);

  const displayName = useNativeState(initial.displayName);
  const address = useNativeState(initial.address);
  const port = useNativeState(initial.port);
  const username = useNativeState(initial.username);
  const password = useNativeState('');
  const privateKeyPem = useNativeState('');
  const tmuxExecutablePath = useNativeState(initial.tmuxExecutablePath);

  const save = useCallback(() => {
    const draft: HostDraft = {
      displayName: displayName.value,
      address: address.value,
      port: port.value,
      username: username.value,
      password: password.value,
      privateKeyPem: privateKeyPem.value,
      tmuxExecutablePath: tmuxExecutablePath.value,
      identityKind,
    };
    const validation = validateHostDraft(draft, { requireCredential: hostId === undefined });
    setErrors(validation.errors);
    if (!validation.ok) return;

    void (async () => {
      await deviceHostStore().saveHost({
        host: {
          id: hostId,
          displayName: draft.displayName.trim(),
          address: draft.address.trim(),
          port: Number(draft.port),
          tmuxExecutablePath: draft.tmuxExecutablePath.trim() || undefined,
        },
        identity: { id: identityId, username: draft.username.trim(), kind: identityKind },
        // Empty on an edit means "keep what the keychain already holds", so a
        // changed address does not mean retyping a private key.
        credential: identityKind === 'password' ? draft.password : draft.privateKeyPem,
      });
      router.back();
    })();
  }, [
    displayName,
    address,
    port,
    username,
    password,
    privateKeyPem,
    tmuxExecutablePath,
    identityKind,
    hostId,
    identityId,
    router,
  ]);

  const keptPlaceholder = hostId ? 'Leave blank to keep the stored one' : undefined;

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: hostId ? 'Edit Host' : 'New Host',
          headerLeft: () => (
            <ToolbarGlyphButton
              systemImage="xmark"
              label="Cancel"
              tint={palette.toolbarTint}
              onPress={() => router.back()}
            />
          ),
          headerRight: () => (
            <ToolbarWord
              label={hostId ? 'Save' : 'Add'}
              color={palette.controlAccent}
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
            header={<SectionHeader palette={palette}>Host</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Field palette={palette} label="Name" placeholder="Mac mini" error={errors.displayName}>
              <TextField
                text={displayName}
                placeholder="Mac mini"
                modifiers={[
                  textInputAutocapitalization('never'),
                  accessibilityLabel('Name'),
                ]}
              />
            </Field>

            <Field palette={palette} label="IP or Hostname" error={errors.address}>
              <TextField
                text={address}
                placeholder="server.local or 100.64.0.10"
                modifiers={[
                  font({ design: 'monospaced' }),
                  keyboardType('url'),
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  accessibilityLabel('Address'),
                ]}
              />
            </Field>

            <Field palette={palette} label="Port" error={errors.port}>
              <TextField
                text={port}
                placeholder="22"
                modifiers={[
                  font({ design: 'monospaced' }),
                  keyboardType('numeric'),
                  accessibilityLabel('Port'),
                ]}
              />
            </Field>

            <Field palette={palette} label="User" error={errors.username}>
              <TextField
                text={username}
                placeholder="ubuntu"
                modifiers={[
                  font({ design: 'monospaced' }),
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  accessibilityLabel('User'),
                ]}
              />
            </Field>
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Authentication</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Picker
              label=""
              selection={identityKind}
              onSelectionChange={(next) => setIdentityKind(next as IdentityKind)}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('password')]}>Password</Text>
              <Text modifiers={[tag('privateKey')]}>Private Key</Text>
            </Picker>

            {identityKind === 'password' ? (
              <Field palette={palette} label="Password" error={errors.password}>
                <SecureField
                  text={password}
                  placeholder={keptPlaceholder ?? 'Required'}
                  modifiers={[accessibilityLabel('Password')]}
                />
              </Field>
            ) : (
              <Field palette={palette} label="Private Key" error={errors.privateKeyPem}>
                <TextField
                  text={privateKeyPem}
                  placeholder={keptPlaceholder ?? 'Paste the key'}
                  axis="vertical"
                  modifiers={[
                    font({ size: 12, design: 'monospaced' }),
                    lineLimit(6),
                    textInputAutocapitalization('never'),
                    autocorrectionDisabled(),
                    accessibilityLabel('Private key'),
                  ]}
                />
              </Field>
            )}
          </Section>

          <Section
            header={<SectionHeader palette={palette}>tmux</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                Only needed when tmux is not on the Host&apos;s non-interactive PATH.
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Field palette={palette} label="Executable Path (Optional)" error={errors.tmuxExecutablePath}>
              <TextField
                text={tmuxExecutablePath}
                placeholder="/absolute/path/to/tmux"
                modifiers={[
                  font({ design: 'monospaced' }),
                  keyboardType('url'),
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  accessibilityLabel('tmux path'),
                ]}
              />
            </Field>
          </Section>
        </Form>
      </Host>
    </View>
  );
}

/**
 * A labelled row: the field's name above it in small caps-weight grey, the
 * input under it, and whatever is wrong with it below that.
 *
 * The label sits above rather than beside because these values are long — an
 * address or a key path beside a label has nowhere to go on a phone.
 */
function Field({
  label,
  error,
  palette,
  children,
}: {
  label: string;
  placeholder?: string;
  error?: string;
  palette: Appearance;
  children: React.ReactNode;
}) {
  return (
    <VStack spacing={6} alignment="leading" modifiers={[frame({ maxWidth: 3000 })]}>
      <Text
        modifiers={[
          font({ size: 13, weight: 'semibold' }),
          foregroundColor(palette.secondaryLabel),
        ]}>
        {label}
      </Text>
      {children}
      {error !== undefined ? (
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.destructive)]}>
          {error}
        </Text>
      ) : null}
    </VStack>
  );
}

function SectionHeader({ children, palette }: { children: string; palette: Appearance }) {
  return (
    <Text
      modifiers={[
        font({ size: 13, weight: 'semibold' }),
        foregroundColor(palette.sectionHeader),
      ]}>
      {children}
    </Text>
  );
}

/**
 * The sheet's confirming word: Add for a new Host, Save for an edit.
 *
 * Plain React Native, and padded: iOS 26 draws its glass capsule around the
 * view's own frame, so a bare word ends up in a disc it spills out of.
 */
function ToolbarWord({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.toolbarWord}>
      <RNText style={[styles.toolbarWordText, { color }]}>{label}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  toolbarWord: {
    paddingHorizontal: 8,
  },
  toolbarWordText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
