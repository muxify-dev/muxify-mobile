import * as Clipboard from 'expo-clipboard';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { uniqueId, type AttachmentFile } from './types';

const root = new Directory(Paths.cache, 'composer');
let initialized = false;

/** Drafts do not survive a process restart, so neither should their old files. */
function stagingRoot() {
  if (!initialized) {
    if (root.exists) root.delete();
    root.create({ intermediates: true, idempotent: true });
    initialized = true;
  }
  return root;
}

export async function stageFile(uri: string, name: string, image: boolean): Promise<AttachmentFile> {
  const directory = new Directory(stagingRoot(), uniqueId());
  directory.create();
  const clean = name.replace(/[\x00-\x1f\x7f/\\]/g, '_') || 'attachment';
  const local = new File(directory, clean);
  try {
    await new File(uri).copy(local);
    return {
      uri: local.uri, name: clean, size: local.size, image,
      open: () => local.open(FileMode.ReadOnly),
      dispose: () => { if (directory.exists) directory.delete(); },
    };
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}

/**
 * The image on the clipboard as a staged file, or null when it holds none.
 *
 * For a paste that starts outside a text view. The Composer's own input gets
 * a pasted image from its paste event; see native-input.
 */
export async function stageClipboardImage(): Promise<AttachmentFile | null> {
  if (!(await Clipboard.hasImageAsync())) return null;
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image) return null;
  const read = new File(stagingRoot(), `${uniqueId()}.png`);
  try {
    // `data` is a data URI: the base64 starts after the comma.
    read.write(image.data.slice(image.data.indexOf(',') + 1), { encoding: 'base64' });
    return await stageFile(read.uri, 'pasted-image.png', true);
  } finally {
    if (read.exists) read.delete();
  }
}
