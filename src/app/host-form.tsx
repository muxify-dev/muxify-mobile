import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { GlassRow } from '@/components/glass-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  emptyHostDraft,
  validateHostDraft,
  type HostDraft,
  type HostDraftField,
  type IdentityKind,
} from '@/domain/validate-host-draft';
import { useTheme } from '@/hooks/use-theme';
import { deviceHostStore } from '@/storage/device-store';

/**
 * Add or edit a Host.
 *
 * One form for both, because a typo in an address should not mean recreating
 * the Host and losing what is attached to it. Editing keeps the Host's id, so
 * its Fingerprint and its place in the list survive.
 *
 * Validation runs here, before any Connection: a typo should produce an
 * immediate, specific answer rather than a network error thirty seconds later.
 */
export default function HostFormScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [draft, setDraft] = useState<HostDraft>(emptyHostDraft);
  const [errors, setErrors] = useState<Partial<Record<HostDraftField, string>>>({});
  const [identityId, setIdentityId] = useState<string | undefined>();

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const records = await deviceHostStore().load();
      const host = records.hosts.find((candidate) => candidate.id === id);
      if (!host) return;
      const identity = records.identities.find((candidate) => candidate.id === host.identityId);
      setIdentityId(host.identityId);
      setDraft({
        ...emptyHostDraft(),
        displayName: host.displayName,
        address: host.address,
        port: String(host.port),
        username: identity?.username ?? '',
        tmuxExecutablePath: host.tmuxExecutablePath ?? '',
        identityKind: identity?.kind ?? 'password',
      });
    })();
  }, [id]);

  const set = useCallback(
    (field: HostDraftField, value: string) =>
      setDraft((previous) => ({ ...previous, [field]: value })),
    [],
  );

  const save = useCallback(() => {
    const validation = validateHostDraft(draft, { requireCredential: id === undefined });
    setErrors(validation.errors);
    if (!validation.ok) return;

    void (async () => {
      await deviceHostStore().saveHost({
        host: {
          id,
          displayName: draft.displayName.trim(),
          address: draft.address.trim(),
          port: Number(draft.port),
          tmuxExecutablePath: draft.tmuxExecutablePath.trim() || undefined,
        },
        identity: { id: identityId, username: draft.username.trim(), kind: draft.identityKind },
        // Empty on an edit means "keep what the keychain already holds", so a
        // changed address does not mean retyping a private key.
        credential: draft.identityKind === 'password' ? draft.password : draft.privateKeyPem,
      });
      router.back();
    })();
  }, [draft, id, identityId, router]);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field
          label="Display name"
          value={draft.displayName}
          error={errors.displayName}
          onChange={(text) => set('displayName', text)}
        />
        <Field
          label="Address"
          value={draft.address}
          error={errors.address}
          autoCapitalize="none"
          onChange={(text) => set('address', text)}
        />
        <Field
          label="Port"
          value={draft.port}
          error={errors.port}
          keyboardType="number-pad"
          onChange={(text) => set('port', text)}
        />
        <Field
          label="User"
          value={draft.username}
          error={errors.username}
          autoCapitalize="none"
          onChange={(text) => set('username', text)}
        />

        <View style={styles.segmented}>
          {(['password', 'privateKey'] as IdentityKind[]).map((kind) => (
            <Pressable
              key={kind}
              onPress={() => set('identityKind', kind)}
              accessibilityRole="button"
              accessibilityLabel={kind === 'password' ? 'Use password' : 'Use private key'}
              style={[styles.segment, draft.identityKind === kind && styles.segmentOn]}>
              <ThemedText type="small">{kind === 'password' ? 'Password' : 'Private key'}</ThemedText>
            </Pressable>
          ))}
        </View>

        {draft.identityKind === 'password' ? (
          <Field
            label="Password"
            value={draft.password}
            error={errors.password}
            secureTextEntry
            autoCapitalize="none"
            placeholder={id ? 'Leave blank to keep the stored one' : undefined}
            onChange={(text) => set('password', text)}
          />
        ) : (
          <Field
            label="Private key"
            value={draft.privateKeyPem}
            error={errors.privateKeyPem}
            multiline
            autoCapitalize="none"
            placeholder={id ? 'Leave blank to keep the stored one' : 'Paste the key'}
            onChange={(text) => set('privateKeyPem', text)}
          />
        )}

        <Field
          label="tmux path (optional)"
          value={draft.tmuxExecutablePath}
          error={errors.tmuxExecutablePath}
          autoCapitalize="none"
          placeholder="Only when tmux is not on a non-interactive PATH"
          onChange={(text) => set('tmuxExecutablePath', text)}
        />

        <GlassRow accessibilityLabel="Save Host" onPress={save} style={styles.save}>
          <ThemedText type="smallBold">{id ? 'Save changes' : 'Add Host'}</ThemedText>
        </GlassRow>
      </ScrollView>
    </ThemedView>
  );
}

function Field({
  label,
  value,
  error,
  onChange,
  multiline,
  ...input
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (text: string) => void;
  multiline?: boolean;
} & Omit<React.ComponentProps<typeof TextInput>, 'onChange' | 'value'>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        accessibilityLabel={label}
        autoCorrect={false}
        placeholderTextColor="#6b7080"
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
          multiline && styles.inputTall,
          error !== undefined && styles.inputBad,
        ]}
      />
      {error !== undefined ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  form: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  field: {
    gap: 4,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputTall: {
    minHeight: 96,
    fontSize: 12,
  },
  inputBad: {
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  error: {
    color: '#ff6b6b',
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#20242f',
  },
  segmentOn: {
    backgroundColor: '#3b6ce0',
  },
  save: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});
