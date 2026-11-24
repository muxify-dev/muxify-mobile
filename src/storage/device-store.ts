import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { parseGoToSections, type GoToSection } from '@/topics/go-to-answer';

import { createListCache, createGoToCache, type GoToCache } from './go-to-cache';
import { createHostStore, type HostStore, type JsonFile, type Secrets } from './store';

const RECORDS_FILE = 'muxify-records.json';
const GO_TO_FILE = 'muxify-go-to.json';

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

/** The app's one store. */
export function deviceHostStore(): HostStore {
  store ??= createHostStore(jsonFile(RECORDS_FILE), secrets);
  return store;
}

let goToCache: GoToCache | undefined;

/** The app's one copy of each Host's Go to paths. */
export function deviceGoToCache(): GoToCache {
  goToCache ??= createGoToCache(jsonFile(GO_TO_FILE));
  return goToCache;
}

let rankedCache: GoToCache<GoToSection> | undefined;
export function deviceRankedGoToCache(): GoToCache<GoToSection> {
  rankedCache ??= createListCache(jsonFile('muxify-go-to-sections.json'), parseGoToSections, (sections) => ({ sections }));
  return rankedCache;
}
