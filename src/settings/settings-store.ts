import { DEFAULT_SETTINGS, parseSettings, type Settings } from './settings';

/** The one file this needs, so the store is testable without a device. */
export interface SettingsFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<Settings>;
}

/**
 * Keeps the user's terminal settings.
 *
 * Reads are forgiving and writes are whole-file: there are three settings, so
 * there is nothing to merge and no reason for a partial write to be possible.
 * A file that cannot be read is defaults — a phone that has never had settings
 * and one whose file is corrupt want the same thing, which is a working app.
 */
export function createSettingsStore(file: SettingsFile): SettingsStore {
  return {
    async load(): Promise<Settings> {
      try {
        const contents = await file.read();
        if (contents === null) return DEFAULT_SETTINGS;
        return parseSettings(JSON.parse(contents));
      } catch {
        return DEFAULT_SETTINGS;
      }
    },

    async save(settings: Settings): Promise<Settings> {
      // Written through the parser, so what lands on disk is what the app will
      // read back — a clamp that only happened in the UI would be a lie.
      const clean = parseSettings(settings);
      await file.write(JSON.stringify(clean));
      return clean;
    },
  };
}
