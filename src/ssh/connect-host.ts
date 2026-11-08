import { connect, type SshConnection, type SshHostKey } from '@osuki-dev/react-native-ssh';

import type { HostStore } from '@/storage/store';
import type { Host } from '@/storage/records';

import { MissingCredentialError } from './failures';
import { compareHostKey, type KeyVerdict } from './host-key';

export interface HostConnection {
  connection: SshConnection;
  fingerprint: string;
  verdict: KeyVerdict;
}

/**
 * Opens a Connection to a saved Host, using the credential in the keychain.
 *
 * Host key handling is trust on first use, and deliberately not "accept
 * anything": the first key seen is recorded, every later one is compared, and a
 * change is reported to the caller to put in front of the user. Accepting
 * silently is a habit that survives into production, and the library hands us
 * the key precisely so we do not have to.
 *
 * The Fingerprint is *not* recorded here. A key seen during a failed
 * authentication has not been vouched for by anything, so only a Connection
 * that actually succeeds is worth remembering — which the caller does.
 */
export async function connectToHost(
  host: Host,
  store: HostStore,
  /**
   * Told the moment the key is checked, before the sign-in starts. Answers
   * whether to go on: false ends the attempt with HOST_KEY_REJECTED.
   */
  onHostKey?: (verdict: KeyVerdict, fingerprint: string) => boolean,
): Promise<HostConnection> {
  const credential = await store.credentialFor(host.id);
  if (credential === null || credential === '') {
    throw new MissingCredentialError();
  }

  const records = await store.load();
  const identity = records.identities.find((candidate) => candidate.id === host.identityId);
  if (!identity) {
    throw new MissingCredentialError();
  }

  const known = await store.fingerprintFor(host.id);
  let fingerprint = '';
  let verdict: KeyVerdict = { kind: 'first-sight' };

  const connection = await connect({
    host: host.address,
    port: host.port,
    username: identity.username,
    auth:
      identity.kind === 'password'
        ? { type: 'password', password: credential }
        : { type: 'privateKey', privateKey: credential },
    verifyHostKey: (key: SshHostKey) => {
      fingerprint = key.fingerprint;
      verdict = compareHostKey(known?.value, key.fingerprint);
      // A changed key does not block the Connection by default — someone who
      // has just rebuilt a machine still has to be able to reach it — but the
      // caller is told, and tells the user, or refuses it.
      return onHostKey?.(verdict, key.fingerprint) ?? true;
    },
  });

  return { connection, fingerprint, verdict };
}

export { MissingCredentialError, describeConnectionFailure } from './failures';
export { compareHostKey, type KeyVerdict } from './host-key';
