import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Appearance } from '@/constants/app-theme';
import { busy, type Composer } from './composer';
import { ComposerInput, nativePaste, type ComposerInputRef } from './native-input';
import { stageFile } from './staging';

/**
 * The Composer: where a message for a Pane is prepared before it is sent.
 *
 * A Liquid Glass card above the Key Row, drawn in the Theme's appearance rather
 * than the phone's — the glass is told which one, the same way the Banner is,
 * since left alone it follows the phone's setting and a light phone would put
 * a white card over a Dracula terminal — and its text in the Theme's chrome
 * colours. See appearanceFor.
 */
export function ComposerPanel({ composer, paneId, connected, palette, appearance, inputRef }: {
  composer: Composer;
  paneId: string;
  connected: boolean;
  palette: Appearance;
  /** The Theme's appearance, not the phone's: the glass and keyboard match it. */
  appearance: 'light' | 'dark';
  inputRef: RefObject<ComposerInputRef | null>;
}) {
  const draft = useSyncExternalStore(composer.subscribe, () => composer.draft(paneId));
  const [eventCount, setEventCount] = useState(0);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const sending = busy(draft);
  const ready = connected && draft.phase === 'idle' && !picking &&
    (draft.text.trim().length > 0 || draft.attachments.length > 0) &&
    draft.attachments.every((item) => item.phase === 'ready');

  useEffect(() => {
    if (!sending && !picking && !preview) void inputRef.current?.focus();
  }, [inputRef, sending, picking, preview]);

  async function pick(kind: 'photos' | 'files') {
    if (picking || sending) return;
    setPicking(true);
    setNotice(undefined);
    try {
      if (kind === 'photos') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], allowsMultipleSelection: true, orderedSelection: true,
          allowsEditing: false, shouldDownloadFromNetwork: true,
        });
        for (const asset of result.assets ?? []) {
          const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'image';
          composer.add(paneId, name, () => stageFile(asset.uri, name, true));
        }
      } else {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        for (const asset of result.assets ?? []) {
          composer.add(paneId, asset.name, () => stageFile(asset.uri, asset.name, asset.mimeType?.startsWith('image/') ?? false));
        }
      }
    } catch {
      setNotice('Couldn’t add the attachment. Try again.');
    } finally {
      setPicking(false);
      void inputRef.current?.focus();
    }
  }

  const glass = isGlassEffectAPIAvailable();
  const Card = glass ? GlassView : View;
  // A tile sitting on the glass, with an edge: over a light terminal the
  // frosted glass and a white tile come out the same near-white, as they do
  // for the Banner.
  const tile = { backgroundColor: palette.rowSurface, borderColor: palette.separator };
  return (
    <Card
      style={[styles.panel, glass ? null : [styles.plain, tile]]}
      {...(glass ? { glassEffectStyle: 'regular' as const, colorScheme: appearance } : {})}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: palette.secondaryLabel }]}>Message · Pane {paneId}</Text>
        {picking ? <ActivityIndicator size="small" color={palette.secondaryLabel} /> : null}
      </View>
      {draft.attachments.length > 0 ? (
        <ScrollView horizontal style={styles.attachments} keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
          {draft.attachments.map((item) => (
            <View key={item.id} style={[styles.attachment, styles.plain, tile]}>
              <Pressable
                accessibilityLabel={`Preview ${item.name}`}
                disabled={!item.file?.image}
                onPress={() => setPreview(item.file?.uri)}
                style={styles.thumbnail}>
                {item.file?.image
                  ? <Image source={{ uri: item.file.uri }} contentFit="cover" style={styles.thumbnail} />
                  : <Text numberOfLines={2} style={{ color: palette.toolbarTint, padding: 6 }}>{item.name}</Text>}
                {item.phase === 'preparing' ? <ActivityIndicator style={StyleSheet.absoluteFill} color={palette.secondaryLabel} /> : null}
              </Pressable>
              {item.phase === 'failed' ? (
                <Pressable accessibilityRole="button" onPress={() => composer.retry(paneId, item.id)} style={styles.retry}>
                  <Text style={{ color: palette.controlAccent }}>Retry</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} disabled={sending}
                onPress={() => composer.remove(paneId, item.id)} style={[styles.remove, { backgroundColor: palette.rowSurface }]}>
                <Text style={{ color: palette.toolbarTint, fontSize: 20 }}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <ComposerInput
        ref={inputRef}
        style={styles.input}
        value={{ text: draft.text, eventCount }}
        editable={!sending}
        dark={appearance === 'dark'}
        textColor={palette.toolbarTint}
        tintColor={palette.controlAccent}
        onTextChange={({ nativeEvent }) => {
          setEventCount(nativeEvent.eventCount);
          composer.edit(paneId, nativeEvent.text);
        }}
        onImagePaste={({ nativeEvent: { id } }) => {
          composer.add(paneId, 'Pasted image', async () => {
            const pasted = await nativePaste.preparePaste(id);
            try { return await stageFile(pasted.uri, pasted.name, true); }
            finally { const file = new File(pasted.uri); if (file.exists) file.parentDirectory.delete(); }
          }, () => { void nativePaste.releasePaste(id).catch(() => {}); });
        }}
      />
      {draft.message || notice ? <Text accessibilityRole="alert" style={[styles.message, { color: palette.destructive }]}>{draft.message ?? notice}</Text> : null}
      {sending ? <Text style={[styles.message, { color: palette.secondaryLabel }]}>
        {draft.phase === 'sending' ? 'Sending…' : draft.progress && draft.progress.total > 0
          ? `Uploading ${Math.round(100 * draft.progress.sent / draft.progress.total)}%` : 'Preparing upload…'}
      </Text> : null}
      <View style={styles.actions}>
        <Action label="Paste" palette={palette} disabled={sending || picking} onPress={() => { void inputRef.current?.paste(); }} />
        <Action label="Photos" palette={palette} disabled={sending || picking} onPress={() => { void pick('photos'); }} />
        <Action label="Files" palette={palette} disabled={sending || picking} onPress={() => { void pick('files'); }} />
        <View style={{ flex: 1 }} />
        {draft.phase === 'uncertain' ? (
          <Action label="Keep draft" palette={palette} onPress={() => composer.acknowledge(paneId)} />
        ) : sending ? (
          <Action label="Cancel" palette={palette} onPress={() => composer.cancel(paneId)} />
        ) : <Action label="Send" palette={palette} disabled={!ready} onPress={() => { void composer.send(paneId); }} />}
      </View>
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(undefined)}>
        <View style={styles.preview}>
          <Image source={{ uri: preview }} style={{ flex: 1 }} contentFit="contain" />
          <Pressable accessibilityRole="button" onPress={() => setPreview(undefined)} style={styles.closePreview}>
            <Text style={{ color: '#fff', fontSize: 18 }}>Close preview</Text>
          </Pressable>
        </View>
      </Modal>
    </Card>
  );
}

function Action({ label, palette, onPress, disabled = false }: {
  label: string; palette: Appearance; onPress(): void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.35 }]}>
    <Text style={{ color: palette.controlAccent, fontWeight: '600' }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 10, borderRadius: 22, paddingHorizontal: 10, paddingTop: 8, overflow: 'hidden' },
  plain: { borderWidth: StyleSheet.hairlineWidth },
  heading: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  title: { fontSize: 12 },
  input: { height: 92 },
  attachments: { marginTop: 6, maxHeight: 88 },
  attachment: { width: 84, height: 80, marginRight: 8, borderRadius: 12, overflow: 'hidden' },
  thumbnail: { width: 84, height: 80, justifyContent: 'center' },
  remove: { position: 'absolute', right: 0, top: 0, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  retry: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', padding: 8 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 9 },
  message: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 },
  preview: { flex: 1, backgroundColor: '#000e', paddingTop: 60, paddingBottom: 40 },
  closePreview: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
