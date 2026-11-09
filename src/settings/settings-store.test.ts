import { createSettingsStore, type SettingsFile } from './settings-store';
import { DEFAULT_SETTINGS, MAX_FONT_SIZE, type Settings } from './settings';

function fakeFile(initial: string | null = null) {
  let contents = initial;
  const file: SettingsFile = {
    async read() {
      return contents;
    },
    async write(next) {
      contents = next;
    },
  };
  return { file, read: () => contents };
}

const CHANGED: Settings = {
  fontSize: 14,
  theme: 'dracula',
  zoomMultipaneWindows: false,
  hostScreenLists: ['topics', 'sessions'],
  recentSessionsFirst: false,
  reconnectOnStart: true,
  showStatusLines: false,
};

describe('settings store', () => {
  it('is defaults on a phone that has never had settings', async () => {
    const { file } = fakeFile(null);

    await expect(createSettingsStore(file).load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('reads back what it wrote', async () => {
    const { file } = fakeFile();
    const store = createSettingsStore(file);

    await store.save(CHANGED);

    await expect(store.load()).resolves.toEqual(CHANGED);
  });

  it('is defaults when the file is corrupt, rather than a broken app', async () => {
    const { file } = fakeFile('{ not json');

    await expect(createSettingsStore(file).load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('writes what it will read back, so a clamp is not only skin deep', async () => {
    const { file, read } = fakeFile();

    const saved = await createSettingsStore(file).save({ ...CHANGED, fontSize: 900 });

    expect(saved.fontSize).toBe(MAX_FONT_SIZE);
    expect(JSON.parse(read()!).fontSize).toBe(MAX_FONT_SIZE);
  });

  it('is defaults when the file cannot be read at all', async () => {
    const file: SettingsFile = {
      async read() {
        throw new Error('disk is busy');
      },
      async write() {},
    };

    await expect(createSettingsStore(file).load()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});
