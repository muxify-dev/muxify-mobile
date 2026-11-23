import { createHostStore, credentialKey, type JsonFile, type Secrets } from './store';
import type { Place } from './records';

function fakeStorage(initial: string | null = null) {
  let contents = initial;
  const vault = new Map<string, string>();
  const file: JsonFile = {
    read: async () => contents,
    write: async (next) => {
      contents = next;
    },
  };
  const secrets: Secrets = {
    get: async (key) => vault.get(key) ?? null,
    set: async (key, value) => {
      vault.set(key, value);
    },
    remove: async (key) => {
      vault.delete(key);
    },
  };
  return { file, secrets, vault, written: () => contents ?? '' };
}

function ids() {
  let next = 0;
  return () => `id${++next}`;
}

/** A clock that ticks a second per read, so an order is an order. */
function clock() {
  let seconds = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++seconds));
}

const HOST = {
  displayName: 'Build box',
  address: '10.0.0.4',
  port: 22,
};
const IDENTITY = { username: 'evgeny', kind: 'password' as const };

describe('saveHost', () => {
  it('stores the Host and its Identity, and hands back what was saved', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });

    expect(saved).toEqual({ ...HOST, id: 'id2', identityId: 'id1' });
    const records = await store.load();
    expect(records.hosts).toHaveLength(1);
    expect(records.identities).toEqual([{ id: 'id1', username: 'evgeny', kind: 'password' }]);
  });

  it('never writes the credential into the JSON', async () => {
    // The whole point of the split: a password in a file is readable by
    // anything that can read the app's container, including a backup.
    const { file, secrets, written } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });

    expect(written()).not.toContain('hunter2');
  });

  it('puts the credential in the keychain, keyed by Identity', async () => {
    const { file, secrets, vault } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });

    expect(vault.get(credentialKey('id1'))).toBe('hunter2');
  });

  it('edits a Host in place rather than adding a second one', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'x' });

    await store.saveHost({
      host: { ...HOST, id: saved.id, displayName: 'Renamed' },
      identity: { ...IDENTITY, id: saved.identityId },
      credential: 'x',
    });

    const records = await store.load();
    expect(records.hosts).toHaveLength(1);
    expect(records.hosts[0].displayName).toBe('Renamed');
  });

  it('leaves an existing credential alone when none is given', async () => {
    // Editing an address should not require retyping a private key.
    const { file, secrets, vault } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'keep-me' });

    await store.saveHost({
      host: { ...HOST, id: saved.id, address: '10.0.0.5' },
      identity: { ...IDENTITY, id: saved.identityId },
      credential: '',
    });

    expect(vault.get(credentialKey(saved.identityId))).toBe('keep-me');
  });
});

describe('removeHost', () => {
  it('removes the Host and its credential', async () => {
    const { file, secrets, vault } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });

    await store.removeHost(saved.id);

    expect((await store.load()).hosts).toEqual([]);
    expect(vault.size).toBe(0);
  });

  it('keeps a credential another Host still uses', async () => {
    // Identities are shared on purpose, so deletion has to check.
    const { file, secrets, vault } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const first = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'shared' });
    await store.saveHost({
      host: { ...HOST, displayName: 'Second' },
      identity: { ...IDENTITY, id: first.identityId },
      credential: '',
    });

    await store.removeHost(first.id);

    expect(vault.get(credentialKey(first.identityId))).toBe('shared');
    expect((await store.load()).identities).toHaveLength(1);
  });

  it('forgets the Host key it had recorded', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'x' });
    await store.rememberFingerprint(saved.id, 'SHA256:abc');

    await store.removeHost(saved.id);

    expect((await store.load()).fingerprints).toEqual([]);
  });

  it('does nothing for a Host that is not there', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    await expect(store.removeHost('gone')).resolves.toBeUndefined();
  });
});

describe('credentialFor', () => {
  it('reads the credential of the Host’s Identity', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });

    await expect(store.credentialFor(saved.id)).resolves.toBe('hunter2');
  });

  it('is null for a Host that is not there', async () => {
    const { file, secrets } = fakeStorage();

    await expect(createHostStore(file, secrets).credentialFor('gone')).resolves.toBeNull();
  });
});

describe('fingerprints', () => {
  it('records one on first sight and reads it back', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    await store.rememberFingerprint('h1', 'SHA256:abc');

    expect((await store.fingerprintFor('h1'))?.value).toBe('SHA256:abc');
  });

  it('keeps the original sighting time when the key is replaced', async () => {
    // When a key was first trusted is the interesting fact.
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    await store.rememberFingerprint('h1', 'SHA256:abc');
    const first = await store.fingerprintFor('h1');

    await store.rememberFingerprint('h1', 'SHA256:def');
    const second = await store.fingerprintFor('h1');

    expect(second?.value).toBe('SHA256:def');
    expect(second?.firstSeenAt).toBe(first?.firstSeenAt);
  });

  it('is undefined for a Host never connected to', async () => {
    const { file, secrets } = fakeStorage();

    await expect(createHostStore(file, secrets).fingerprintFor('h1')).resolves.toBeUndefined();
  });
});

describe('load', () => {
  it('is empty on a fresh install', async () => {
    const { file, secrets } = fakeStorage(null);

    await expect(createHostStore(file, secrets).load()).resolves.toEqual({
      hosts: [],
      identities: [],
      fingerprints: [],
      recentSessions: [],
      lastPlace: null,
      places: [],
    });
  });

  it('treats unreadable records as none rather than failing to launch', async () => {
    const { file, secrets } = fakeStorage('{ not json');

    await expect(createHostStore(file, secrets).load()).resolves.toEqual({
      hosts: [],
      identities: [],
      fingerprints: [],
      recentSessions: [],
      lastPlace: null,
      places: [],
    });
  });

  it('fills in a missing section of an older file', async () => {
    const { file, secrets } = fakeStorage('{"hosts":[]}');

    await expect(createHostStore(file, secrets).load()).resolves.toEqual({
      hosts: [],
      identities: [],
      fingerprints: [],
      recentSessions: [],
      lastPlace: null,
      places: [],
    });
  });
});

describe('recent Sessions', () => {
  it('remembers a Session against its Host, most recently opened first', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids(), clock());

    await store.rememberSession('host1', 'dotfiles');
    await store.rememberSession('host1', 'muxify');

    expect((await store.recentSessionsFor('host1')).map((s) => s.name)).toEqual([
      'muxify',
      'dotfiles',
    ]);
  });

  it('moves a Session back to the top when it is opened again', async () => {
    // The order is the point of the record: the list should answer "where was
    // I", and a Session opened twice is not older than one opened once.
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids(), clock());

    await store.rememberSession('host1', 'dotfiles');
    await store.rememberSession('host1', 'muxify');
    await store.rememberSession('host1', 'dotfiles');

    const recent = await store.recentSessionsFor('host1');
    expect(recent.map((s) => s.name)).toEqual(['dotfiles', 'muxify']);
    expect(recent).toHaveLength(2);
  });

  it('keeps each Host to its own Sessions', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids(), clock());

    await store.rememberSession('host1', 'shared-name');
    await store.rememberSession('host2', 'shared-name');

    expect(await store.recentSessionsFor('host1')).toHaveLength(1);
    expect(await store.recentSessionsFor('host2')).toHaveLength(1);
  });

  it('forgets a Host’s Sessions along with the Host', async () => {
    // Otherwise a Host deleted and re-added comes back haunted by the Sessions
    // of the one before it.
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const host = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });
    await store.rememberSession(host.id, 'muxify');

    await store.removeHost(host.id);

    expect(await store.recentSessionsFor(host.id)).toEqual([]);
  });

  it('reads records written before recent Sessions existed', async () => {
    const { file, secrets } = fakeStorage('{"hosts":[],"identities":[],"fingerprints":[]}');
    const store = createHostStore(file, secrets, ids());

    expect((await store.load()).recentSessions).toEqual([]);
  });
});

describe('the Last Place', () => {
  it('is none until a Session has been reached', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    expect((await store.load()).lastPlace).toBeNull();
  });

  it('keeps the place the Attach wrote, and the next one replaces it', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());

    await store.rememberLastPlace({ hostId: 'host1', session: 'dotfiles', topicId: 'topic1' });
    await store.rememberLastPlace({ hostId: 'host1', session: 'muxify', topicId: null });

    expect((await store.load()).lastPlace).toEqual({
      hostId: 'host1',
      session: 'muxify',
      topicId: null,
    });
  });

  it('is cleared by a Disconnect, and other records stay', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids(), clock());
    await store.rememberSession('host1', 'dotfiles');
    await store.rememberLastPlace({ hostId: 'host1', session: 'dotfiles', topicId: null });

    await store.forgetLastPlace();

    const records = await store.load();
    expect(records.lastPlace).toBeNull();
    expect(records.recentSessions.map((s) => s.name)).toEqual(['dotfiles']);
  });

  it('survives saving a Host, and goes with the Host it names', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'x' });
    await store.rememberLastPlace({ hostId: saved.id, session: 'work', topicId: null });

    await store.saveHost({
      host: { ...HOST, id: saved.id, displayName: 'Renamed' },
      identity: { ...IDENTITY, id: saved.identityId },
      credential: '',
    });
    expect((await store.load()).lastPlace?.session).toBe('work');

    await store.removeHost(saved.id);
    expect((await store.load()).lastPlace).toBeNull();
  });

  it.each([
    ['missing', {}],
    ['not an object', { lastPlace: 'host1:work' }],
    ['without a Host', { lastPlace: { session: 'work', topicId: null } }],
    ['with an empty Session', { lastPlace: { hostId: 'host1', session: '', topicId: null } }],
    ['with a Topic that is not text', { lastPlace: { hostId: 'host1', session: 'work', topicId: 4 } }],
    ['from before it had a Topic', { lastPlace: { hostId: 'host1', session: 'work' } }],
  ])('reads as none when it is %s, and the other records still load', async (_, saved) => {
    const { file, secrets } = fakeStorage(JSON.stringify({ hosts: [{ id: 'host1' }], ...saved }));
    const store = createHostStore(file, secrets, ids());

    const records = await store.load();
    expect(records.lastPlace).toBeNull();
    expect(records.hosts).toHaveLength(1);
  });
});

describe('reorderHosts', () => {
  async function savedHosts(names: string[]) {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const saved = [];
    for (const displayName of names) {
      saved.push(await store.saveHost({ host: { ...HOST, displayName }, identity: IDENTITY, credential: 'x' }));
    }
    return { store, saved };
  }
  const order = async (store: ReturnType<typeof createHostStore>) =>
    (await store.load()).hosts.map((host) => host.displayName);

  it('puts a new Host at the end', async () => {
    const { store } = await savedHosts(['one', 'two', 'three']);

    expect(await order(store)).toEqual(['one', 'two', 'three']);
  });

  it('keeps the order it is given, and editing a Host does not move it', async () => {
    const { store, saved } = await savedHosts(['one', 'two', 'three']);

    await store.reorderHosts([saved[2]!.id, saved[0]!.id, saved[1]!.id]);
    await store.saveHost({
      host: { ...HOST, id: saved[0]!.id, displayName: 'one, renamed' },
      identity: { ...IDENTITY, id: saved[0]!.identityId },
      credential: '',
    });

    expect(await order(store)).toEqual(['three', 'one, renamed', 'two']);
  });

  it('keeps a Host the order leaves out, and ignores an id that is no Host', async () => {
    const { store, saved } = await savedHosts(['one', 'two', 'three']);

    await store.reorderHosts([saved[2]!.id, 'gone']);

    expect(await order(store)).toEqual(['three', 'one', 'two']);
  });
});

describe('Places', () => {
  const place = (over: Partial<Place> = {}): Place => ({
    hostId: 'host1',
    owner: { kind: 'topic', topicId: 'topic1' },
    session: 'work',
    window: { id: '@2', index: 1, name: 'editor' },
    pane: '%7',
    tab: { url: 'http://100.64.0.1:3000/', page: 'http://100.64.0.1:3000/docs', scrollY: 420 },
    at: '2026-11-15T10:00:00.000Z',
    ...over,
  });
  const sessionPlace = (over: Partial<Place> = {}): Place =>
    place({ owner: { kind: 'session', session: 'work' }, ...over });

  it('keeps one per owner of each Host, a Topic or a Session, and reads it back after a relaunch', async () => {
    const storage = fakeStorage();
    const store = createHostStore(storage.file, storage.secrets);
    await store.rememberPlace(place());
    await store.rememberPlace(place({ hostId: 'host2' }));
    await store.rememberPlace(sessionPlace({ pane: '%9' }));
    await store.rememberPlace(place({ pane: '%8', tab: null }));

    const relaunched = createHostStore(fakeStorage(storage.written()).file, storage.secrets);
    expect(await relaunched.placeFor('host1', { kind: 'topic', topicId: 'topic1' })).toEqual(place({ pane: '%8', tab: null }));
    expect(await relaunched.placeFor('host2', { kind: 'topic', topicId: 'topic1' })).toEqual(place({ hostId: 'host2' }));
    expect(await relaunched.placeFor('host1', { kind: 'session', session: 'work' })).toEqual(sessionPlace({ pane: '%9' }));
    expect(await relaunched.placeFor('host1', { kind: 'topic', topicId: 'other' })).toBeNull();
    expect(await relaunched.placeFor('host1', { kind: 'session', session: 'renamed' })).toBeNull();
  });

  it('reads the Topic Places of an older build as Topic Places, and writes them back as Places', async () => {
    const { owner: _owner, ...rest } = place();
    const storage = fakeStorage(JSON.stringify({ hosts: [], topicPlaces: [{ ...rest, topicId: 'topic1' }] }));
    const store = createHostStore(storage.file, storage.secrets);

    expect(await store.placeFor('host1', { kind: 'topic', topicId: 'topic1' })).toEqual(place());
    await store.rememberPlace(sessionPlace());

    const written = JSON.parse(storage.written());
    expect(written.topicPlaces).toBeUndefined();
    expect(written.places).toEqual([place(), sessionPlace()]);
  });

  it('drops a bad entry and keeps the rest of the records', async () => {
    const good = place();
    const { owner: _owner, ...legacy } = good;
    const { file, secrets } = fakeStorage(JSON.stringify({
      hosts: [],
      lastPlace: { hostId: 'host1', session: 'work', topicId: 'topic1' },
      places: [
        good,
        { ...good, owner: { kind: 'topic', topicId: 'no window id' }, window: { index: 1, name: 'editor' } },
        { ...good, owner: { kind: 'topic', topicId: 'bad tab' }, tab: { url: 'http://a.ts.net/', page: 'http://a.ts.net/', scrollY: 'top' } },
        { ...good, session: '' },
        { ...good, owner: { kind: 'session', session: 'other' } },
        { ...good, owner: { kind: 'window', id: '@2' } },
        'not a place',
      ],
      topicPlaces: [
        { ...legacy, topicId: 'legacy' },
        { ...legacy, topicId: '' },
        { ...legacy, topicId: 'legacy bad pane', pane: 7 },
        'not a place',
      ],
    }));

    const records = await createHostStore(file, secrets).load();
    expect(records.places).toEqual([good, place({ owner: { kind: 'topic', topicId: 'legacy' } })]);
    expect(records.lastPlace).toEqual({ hostId: 'host1', session: 'work', topicId: 'topic1' });
  });

  it('goes with its Host, of both kinds, and stays through a Disconnect', async () => {
    const { file, secrets } = fakeStorage();
    const store = createHostStore(file, secrets, ids());
    const kept = await store.saveHost({ host: HOST, identity: IDENTITY, credential: 'hunter2' });
    const removed = await store.saveHost({ host: { ...HOST, displayName: 'Other' }, identity: IDENTITY, credential: 'x' });
    await store.rememberPlace(place({ hostId: kept.id }));
    await store.rememberPlace(sessionPlace({ hostId: kept.id }));
    await store.rememberPlace(place({ hostId: removed.id }));
    await store.rememberPlace(sessionPlace({ hostId: removed.id }));

    await store.forgetLastPlace();
    await store.removeHost(removed.id);

    expect((await store.load()).places).toEqual([place({ hostId: kept.id }), sessionPlace({ hostId: kept.id })]);
  });
});
