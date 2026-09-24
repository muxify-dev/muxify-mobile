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

/** Everything the app persists, as it sits on disk. */
export interface Records {
  hosts: Host[];
  identities: Identity[];
  fingerprints: Fingerprint[];
}

export function emptyRecords(): Records {
  return { hosts: [], identities: [], fingerprints: [] };
}
