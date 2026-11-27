import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { createHostStore, type HostStore, type JsonFile, type Secrets } from './store';

const RECORDS_FILE = 'muxify-records.json';
/** The files of the Go to caches, which an older version wrote. Go to shows no old rows now. */
const RETIRED_FILES = ['muxify-go-to.json', 'muxify-go-to-sections.json'];

/**
 * The real storage behind the Hosts list: a JSON file in the app's documents
 * directory, and the iOS keychain for anything secret.
 *
 * Kept to the two seams the store defines, so everything above this line is
 * testable without a device — which is where all the interesting behaviour is,
 * such as not orphaning a credential two Hosts share.
 */
const jsonFile = (name: string): JsonFile => ({
  async read() {
    const file = new File(Paths.document, name);
    if (!file.exists) return null;
    return file.text();
  },
  async write(contents: string) {
    const file = new File(Paths.document, name);
    if (!file.exists) file.create();
    file.write(contents);
  },
});

const secrets: Secrets = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      // The credential is needed only while someone is using the phone, and
      // only on this phone: no iCloud copy, no use while locked.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

let store: HostStore | undefined;

/** The app's one store. Its first use deletes the retired files, which hold each Host's folders. */
export function deviceHostStore(): HostStore {
  if (store === undefined) {
    store = createHostStore(jsonFile(RECORDS_FILE), secrets);
    for (const name of RETIRED_FILES) {
      const file = new File(Paths.document, name);
      if (file.exists) file.delete();
    }
  }
  return store;
}
