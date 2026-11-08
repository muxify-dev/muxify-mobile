import type { IdentityKind } from '@/domain/validate-host-draft';

/** A machine Muxify can reach. Carries no credential — see Identity. */
export interface Host {
  id: string;
  displayName: string;
  address: string;
  port: number;
  /** Absolute path to tmux, for Hosts where it is not on a non-interactive PATH. */
  tmuxExecutablePath?: string;
  /** The Identity used to authenticate. Several Hosts may share one. */
  identityId: string;
}

/**
 * Who Muxify authenticates as. Deliberately separate from Host so one
 * credential can serve several of them, and so the credential itself has one
 * place to live — the keychain, keyed by this record's id.
 */
export interface Identity {
  id: string;
  username: string;
  kind: IdentityKind;
}

/** A Host's key as last seen, for trust on first use (ticket 13). */
export interface Fingerprint {
  hostId: string;
  value: string;
  /** ISO 8601, so a record is readable without the app. */
  firstSeenAt: string;
}

/**
 * A Session this phone has opened, and when it last did.
 *
 * Not the Session itself — that lives on the Host and outlives every
 * Connection. This is Muxify's memory of one, and it is the only reason the
 * Host Screen can put Sessions in the order *you* last wanted them: tmux knows
 * when a Session was created and when it last saw activity, but not when this
 * phone last looked at it.
 *
 * Keyed by name rather than by any id, because a Session has no identity
 * beyond its name — kill it and make another with the same name and tmux
 * considers the matter closed, so Muxify does too.
 */
export interface RecentSession {
  hostId: string;
  name: string;
  /** ISO 8601, so a record is readable without the app. */
  lastOpenedAt: string;
}

/**
 * Where the user was when Muxify last closed: the Session of the last Attach
 * that reached its attached phase, and the Topic it was opened from, if any.
 * Reconnect on start opens it again. A Disconnect clears it, because a
 * Disconnect means "do not take me back".
 */
export interface LastPlace {
  hostId: string;
  session: string;
  topicId: string | null;
}

/** Everything the app persists, as it sits on disk. */
export interface Records {
  hosts: Host[];
  identities: Identity[];
  fingerprints: Fingerprint[];
  recentSessions: RecentSession[];
  lastPlace: LastPlace | null;
}

export function emptyRecords(): Records {
  return { hosts: [], identities: [], fingerprints: [], recentSessions: [], lastPlace: null };
}

/**
 * The Last Place a saved value names, or null for a missing or bad one. Only
 * this field is checked: a bad one sends a cold start to the Hosts list, which
 * is a safe place to be.
 */
export function parseLastPlace(raw: unknown): LastPlace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { hostId, session, topicId } = raw as Record<string, unknown>;
  if (typeof hostId !== 'string' || hostId === '') return null;
  if (typeof session !== 'string' || session === '') return null;
  if (topicId !== null && typeof topicId !== 'string') return null;
  return { hostId, session, topicId };
}
