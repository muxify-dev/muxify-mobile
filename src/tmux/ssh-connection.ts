import { connectToHost } from '@/ssh/connect-host';
import { createUploader } from '@/composer/upload';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';

import type { HostConnection, OpenConnection } from './attach';
import { sshTmuxTransport } from './ssh-transport';

/**
 * Opens a Host link over SSH.
 *
 * The production half of the one dependency Attach takes on the outside world.
 * Deliberately three lines of its own: everything with a decision in it —
 * which key is trusted, when to size, what a closure means — lives above, and
 * this is the part verified by running the app rather than by a test.
 *
 * The control-mode harness passes a local process in its place, and the unit
 * tests a fake; that is the whole reason this is a parameter and not an import
 * inside Attach.
 */
export function sshConnection(store: HostStore): OpenConnection {
  return async (host: Host): Promise<HostConnection> => {
    const { connection, fingerprint, verdict } = await connectToHost(host, store);
    return {
      transport: sshTmuxTransport(connection),
      upload: createUploader((command, events) => connection.openShell({ term: '', command }, events)),
      fingerprint,
      verdict,
      close: () => connection.disconnect(),
    };
  };
}
