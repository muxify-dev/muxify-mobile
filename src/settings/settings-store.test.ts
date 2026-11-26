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
  ligatures: false,
  appearance: 'dark',
  lightTheme: 'gruvbox-light',
  darkTheme: 'dracula',
  zoomMultipaneWindows: false,
  hostScreenTabs: { host1: 'sessions' },
  reconnectOnStart: true,
  hidePanesPicker: true,
  quickActions: {
    ctrl: [null, 'interrupt-twice', null, 'suspend'],
    cmd: ['paste', null, 'copy-pane', null],
  },
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

  it('writes none of the Host Screen lists that Configure panels saved', async () => {
    const { file, read } = fakeFile(JSON.stringify({
      darkTheme: 'dracula',
      hostScreenLists: ['topics', 'recent'],
      recentSessionsFirst: true,
      hostListPreferences: { version: 1, byHost: { host1: ['sessions'] } },
    }));
    const store = createSettingsStore(file);

    await store.save(await store.load());

    expect(JSON.parse(read()!)).toEqual({ ...DEFAULT_SETTINGS, darkTheme: 'dracula' });
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
