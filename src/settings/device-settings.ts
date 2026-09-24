import { File, Paths } from 'expo-file-system';

import { createSettingsStore, type SettingsFile, type SettingsStore } from './settings-store';

const SETTINGS_FILE = 'muxify-settings.json';

/** The real file behind the settings, beside the Hosts records. */
const settingsFile: SettingsFile = {
  async read() {
    const file = new File(Paths.document, SETTINGS_FILE);
    if (!file.exists) return null;
    return file.text();
  },
  async write(contents: string) {
    const file = new File(Paths.document, SETTINGS_FILE);
    if (!file.exists) file.create();
    file.write(contents);
  },
};

let store: SettingsStore | undefined;

/** The app's one settings store. */
export function deviceSettingsStore(): SettingsStore {
  store ??= createSettingsStore(settingsFile);
  return store;
}
