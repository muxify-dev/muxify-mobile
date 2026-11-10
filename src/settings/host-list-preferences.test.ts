import { createSettingsStore, type SettingsFile } from './settings-store';
import { DEFAULT_SETTINGS, hostListsFor, type Settings } from './settings';

function memoryFile(initial: unknown) {
  let contents = JSON.stringify(initial);
  const file: SettingsFile = {
    read: async () => contents,
    write: async (next) => { contents = next; },
  };
  return { file, value: () => JSON.parse(contents) };
}

it('migrates the legacy order to existing Hosts and gives later Hosts defaults', async () => {
  const { file, value } = memoryFile({ hostScreenLists: ['topics', 'recent'], theme: 'dracula' });
  const store = createSettingsStore(file);
  const migrated = await store.load(['first', 'second']);
  expect(hostListsFor(migrated, 'first')).toEqual(['topics', 'recent']);
  expect(hostListsFor(migrated, 'second')).toEqual(['topics', 'recent']);
  expect(value().hostListPreferences.version).toBe(1);
  const afterRestart = await createSettingsStore(file).load(['first', 'second', 'new']);
  expect(hostListsFor(afterRestart, 'new')).toEqual(DEFAULT_SETTINGS.hostScreenLists);
  expect(afterRestart.theme).toBe('dracula');
});

it('keeps one Host change independent after restart', async () => {
  const { file } = memoryFile({ hostScreenLists: ['topics'] });
  const store = createSettingsStore(file);
  const saved = await store.load(['first', 'second']);
  await store.save({ ...saved, hostListPreferences: {
    version: 1, byHost: { ...saved.hostListPreferences?.byHost, first: ['recent', 'sessions'] },
  } });
  const restarted = await createSettingsStore(file).load(['first', 'second']);
  expect(hostListsFor(restarted, 'first')).toEqual(['recent', 'sessions']);
  expect(hostListsFor(restarted, 'second')).toEqual(['topics']);
});

it('preserves saved Host choices when another Host is first seen', async () => {
  const { file } = memoryFile({ hostScreenLists: ['topics'], hostListPreferences: {
    version: 1, byHost: { first: ['sessions', 'recent'] },
  } });
  const settings = await createSettingsStore(file).load(['first', 'new']);
  expect(hostListsFor(settings, 'first')).toEqual(['sessions', 'recent']);
  expect(hostListsFor(settings, 'new')).toEqual(DEFAULT_SETTINGS.hostScreenLists);
});

it('retries a failed migration without losing the legacy choice', async () => {
  const { file, value } = memoryFile({ hostScreenLists: ['topics'] });
  const write = file.write;
  file.write = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(write);
  const store = createSettingsStore(file);
  await expect(store.load(['first'])).rejects.toThrow('disk full');
  expect(value()).toEqual({ hostScreenLists: ['topics'] });
  expect(hostListsFor(await store.load(['first']), 'first')).toEqual(['topics']);
});

it('serializes slow writes so the last edit survives', async () => {
  const { file } = memoryFile(DEFAULT_SETTINGS);
  const write = file.write;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  file.write = async (contents) => {
    if (first) { first = false; await held; }
    await write(contents);
  };
  const store = createSettingsStore(file);
  const one: Settings = { ...DEFAULT_SETTINGS, theme: 'dracula' };
  const two: Settings = { ...one, fontSize: 16 };
  const a = store.save(one);
  const b = store.save(two);
  release();
  await Promise.all([a, b]);
  expect(await store.load()).toEqual(two);
});

it('validates each saved list and does not treat inherited properties as Hosts', async () => {
  const { file } = memoryFile({ hostListPreferences: { version: 1, byHost: {
    invalid: ['recent'], valid: ['topics', 'topics', 'recent', 'other'],
  } } });
  const settings = await createSettingsStore(file).load();
  expect(hostListsFor(settings, 'invalid')).toEqual(DEFAULT_SETTINGS.hostScreenLists);
  expect(hostListsFor(settings, 'valid')).toEqual(['topics', 'recent']);
  expect(hostListsFor(settings, 'constructor')).toEqual(DEFAULT_SETTINGS.hostScreenLists);
});

it('does not migrate after a failed read and keeps the choice on retry', async () => {
  const { file, value } = memoryFile({ hostScreenLists: ['topics'], theme: 'dracula' });
  const read = file.read;
  file.read = jest.fn().mockRejectedValueOnce(new Error('disk busy')).mockImplementation(read);
  file.write = jest.fn(file.write);
  const store = createSettingsStore(file);
  await expect(store.load(['first'])).rejects.toThrow('disk busy');
  expect(file.write).not.toHaveBeenCalled();
  expect(value()).toEqual({ hostScreenLists: ['topics'], theme: 'dracula' });
  const retried = await store.load(['first']);
  expect(hostListsFor(retried, 'first')).toEqual(['topics']);
  expect(retried.theme).toBe('dracula');
});

it.each(['{ invalid json', 'null', '[]'])('does not overwrite an unreadable migration source %s', async (contents) => {
  const write = jest.fn();
  const store = createSettingsStore({ read: async () => contents, write });
  await expect(store.load(['first'])).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});
