/**
 * The single hardcoded Host used by the transport spike (tickets 04 and 05).
 *
 * Read from `EXPO_PUBLIC_*` env vars supplied by a gitignored `.env.local`, so
 * no address or key material is ever committed. Ticket 12 removes this module
 * entirely and connects to real saved Hosts instead.
 *
 * Caveat worth knowing: `EXPO_PUBLIC_` values are inlined into the JS bundle at
 * build time. That is acceptable here because the target is a local VM with a
 * disposable key, but it is not a pattern to carry into anything real.
 */

export interface DevHost {
  address: string;
  port: number;
  username: string;
  privateKeyPem: string;
  /** The tmux Session to attach to in ticket 05. */
  sessionName: string;
}

export type DevHostResult =
  | { ok: true; host: DevHost }
  | { ok: false; reason: string };

export function readDevHost(): DevHostResult {
  const address = process.env.EXPO_PUBLIC_DEV_SSH_HOST;
  const port = process.env.EXPO_PUBLIC_DEV_SSH_PORT;
  const username = process.env.EXPO_PUBLIC_DEV_SSH_USER;
  const key = process.env.EXPO_PUBLIC_DEV_SSH_KEY;
  const sessionName = process.env.EXPO_PUBLIC_DEV_SSH_SESSION;

  if (!address || !port || !username || !key) {
    return {
      ok: false,
      reason:
        'No dev Host configured. Copy .env.local.example to .env.local and fill in the connection details.',
    };
  }

  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return { ok: false, reason: `EXPO_PUBLIC_DEV_SSH_PORT is not a valid port: ${port}` };
  }

  return {
    ok: true,
    host: {
      address,
      port: parsedPort,
      username,
      // Env values cannot hold real newlines, so they are carried escaped.
      privateKeyPem: key.replace(/\\n/g, '\n'),
      sessionName: sessionName ?? '0',
    },
  };
}
