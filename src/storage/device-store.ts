import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { createHostStore, type HostStore, type JsonFile, type Secrets } from './store';

const RECORDS_FILE = 'muxify-records.json';

/**
 * The real storage behind the Hosts list: a JSON file in the app's documents
 * directory, and the iOS keychain for anything secret.
 *
 * Kept to the two seams the store defines, so everything above this line is
 * testable without a device — which is where all the interesting behaviour is,
 * such as not orphaning a credential two Hosts share.
 */
const jsonFile: JsonFile = {
  async read() {
    const file = new File(Paths.document, RECORDS_FILE);
    if (!file.exists) return null;
    return file.text();
  },
  async write(contents: string) {
    const file = new File(Paths.document, RECORDS_FILE);
    if (!file.exists) file.create();
    file.write(contents);
  },
};

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

/** The app's one store. */
export function deviceHostStore(): HostStore {
  store ??= createHostStore(jsonFile, secrets);
  return store;
}
