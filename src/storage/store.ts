import { emptyRecords, type Fingerprint, type Host, type Identity, type Records } from './records';

/** Where the JSON lives. The one seam between the store and the filesystem. */
export interface JsonFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

/**
 * Where credentials live: the device keychain, never the JSON.
 *
 * A password or a private key in a JSON file is readable by anything that can
 * read the app's container, including a backup. The keychain is the only place
 * on iOS that is not.
 */
export interface Secrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SaveHostInput {
  host: Omit<Host, 'id' | 'identityId'> & { id?: string };
  identity: Omit<Identity, 'id'> & { id?: string };
  /** The password or private key. Goes to the keychain, keyed by Identity. */
  credential: string;
}

export interface HostStore {
  load(): Promise<Records>;
  saveHost(input: SaveHostInput): Promise<Host>;
  removeHost(hostId: string): Promise<void>;
  /** The credential for a Host, read from the keychain at Connection time. */
  credentialFor(hostId: string): Promise<string | null>;
  rememberFingerprint(hostId: string, value: string): Promise<void>;
  fingerprintFor(hostId: string): Promise<Fingerprint | undefined>;
}

/** How a credential is addressed in the keychain. */
export function credentialKey(identityId: string): string {
  return `muxify.identity.${identityId}`;
}

/**
 * Everything Muxify remembers between launches.
 *
 * Records are JSON and credentials are not: the split is the whole point, and
 * it is enforced here rather than trusted to callers. A Host record never
 * carries a password or a key, and nothing writes one into the file.
 *
 * Reads go through the file every time rather than a cache. The records are a
 * handful of small objects, the app is not chatty with them, and a cache would
 * be one more thing that can disagree with what is on disk.
 */
export function createHostStore(
  file: JsonFile,
  secrets: Secrets,
  newId: () => string = randomId,
): HostStore {
  async function load(): Promise<Records> {
    const contents = await file.read();
    if (contents === null || contents.trim() === '') return emptyRecords();
    try {
      const parsed = JSON.parse(contents) as Partial<Records>;
      return {
        hosts: parsed.hosts ?? [],
        identities: parsed.identities ?? [],
        fingerprints: parsed.fingerprints ?? [],
      };
    } catch {
      // Unreadable records are treated as none rather than as a crash on
      // launch. The alternative is an app that cannot start until someone
      // clears its storage by hand.
      return emptyRecords();
    }
  }

  const save = (records: Records) => file.write(JSON.stringify(records, null, 2));

  return {
    load,

    async saveHost({ host, identity, credential }: SaveHostInput): Promise<Host> {
      const records = await load();
      const identityId = identity.id ?? newId();
      const hostId = host.id ?? newId();

      const savedIdentity: Identity = {
        id: identityId,
        username: identity.username,
        kind: identity.kind,
      };
      const savedHost: Host = { ...host, id: hostId, identityId };

      await save({
        hosts: replaceById(records.hosts, savedHost),
        identities: replaceById(records.identities, savedIdentity),
        fingerprints: records.fingerprints,
      });
      // Written after the records, so a failed keychain write cannot leave a
      // credential belonging to a Host that was never saved.
      if (credential !== '') {
        await secrets.set(credentialKey(identityId), credential);
      }
      return savedHost;
    },

    async removeHost(hostId: string): Promise<void> {
      const records = await load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) return;

      const hosts = records.hosts.filter((candidate) => candidate.id !== hostId);
      // An Identity may serve several Hosts, so it only goes when the last one
      // that used it does — deleting a credential another Host still needs
      // would break that Host silently.
      const stillUsed = hosts.some((candidate) => candidate.identityId === host.identityId);

      await save({
        hosts,
        identities: stillUsed
          ? records.identities
          : records.identities.filter((candidate) => candidate.id !== host.identityId),
        fingerprints: records.fingerprints.filter((candidate) => candidate.hostId !== hostId),
      });
      if (!stillUsed) {
        await secrets.remove(credentialKey(host.identityId));
      }
    },

    async credentialFor(hostId: string): Promise<string | null> {
      const records = await load();
      const host = records.hosts.find((candidate) => candidate.id === hostId);
      if (!host) return null;
      return secrets.get(credentialKey(host.identityId));
    },

    async rememberFingerprint(hostId: string, value: string): Promise<void> {
      const records = await load();
      const existing = records.fingerprints.find((candidate) => candidate.hostId === hostId);
      const fingerprint: Fingerprint = {
        hostId,
        value,
        // Kept from the original sighting: when a key was first trusted is the
        // interesting fact, not when it was last confirmed.
        firstSeenAt: existing?.firstSeenAt ?? new Date().toISOString(),
      };
      await save({
        ...records,
        fingerprints: [
          ...records.fingerprints.filter((candidate) => candidate.hostId !== hostId),
          fingerprint,
        ],
      });
    },

    async fingerprintFor(hostId: string): Promise<Fingerprint | undefined> {
      const records = await load();
      return records.fingerprints.find((candidate) => candidate.hostId === hostId);
    },
  };
}

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
