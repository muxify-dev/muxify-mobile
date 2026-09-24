import {
  emptyRecords,
  type Fingerprint,
  type Host,
  type Identity,
  type RecentSession,
  type Records,
} from './records';

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
  /** Records that this phone has just opened a Session, stamped now. */
  rememberSession(hostId: string, name: string): Promise<void>;
  /** Drops the memory of a Session. The Session itself is left running. */
  forgetSession(hostId: string, name: string): Promise<void>;
  /** A Host's remembered Sessions, most recently opened first. */
  recentSessionsFor(hostId: string): Promise<RecentSession[]>;
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
  now: () => Date = () => new Date(),
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
        recentSessions: parsed.recentSessions ?? [],
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
        recentSessions: records.recentSessions,
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
        recentSessions: records.recentSessions.filter(
          (candidate) => candidate.hostId !== hostId,
        ),
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
        firstSeenAt: existing?.firstSeenAt ?? now().toISOString(),
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

    async rememberSession(hostId: string, name: string): Promise<void> {
      const records = await load();
      await save({
        ...records,
        recentSessions: [
          ...records.recentSessions.filter((candidate) => !sameSession(candidate, hostId, name)),
          { hostId, name, lastOpenedAt: now().toISOString() },
        ],
      });
    },

    async forgetSession(hostId: string, name: string): Promise<void> {
      const records = await load();
      await save({
        ...records,
        recentSessions: records.recentSessions.filter(
          (candidate) => !sameSession(candidate, hostId, name),
        ),
      });
    },

    async recentSessionsFor(hostId: string): Promise<RecentSession[]> {
      const records = await load();
      return records.recentSessions
        .filter((candidate) => candidate.hostId === hostId)
        .sort(byMostRecentlyOpened);
    },
  };
}

function sameSession(candidate: RecentSession, hostId: string, name: string): boolean {
  return candidate.hostId === hostId && candidate.name === name;
}

/**
 * Most recently opened first, and by name when two were opened in the same
 * millisecond — which is not a real case, but an order that depends on how the
 * file happened to be written is a list that reshuffles itself for no reason.
 */
function byMostRecentlyOpened(left: RecentSession, right: RecentSession): number {
  if (left.lastOpenedAt !== right.lastOpenedAt) {
    return left.lastOpenedAt < right.lastOpenedAt ? 1 : -1;
  }
  return left.name.localeCompare(right.name);
}

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
