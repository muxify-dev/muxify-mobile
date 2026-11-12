import { createUploader, type OpenUploadChannel } from '@/composer/upload';
import { deviceLog } from '@/diagnostics/device-log';
import { connectToHost } from '@/ssh/connect-host';
import { createHostConnections, type Dial, type HostConnections } from '@/ssh/host-connections';
import { deviceHostStore } from '@/storage/device-store';
import type { HostStore } from '@/storage/store';

import { sshTmuxTransport } from './ssh-transport';

/**
 * Opens a Host link over SSH, for the registry of Connections.
 *
 * The production half of the one dependency the registry takes on the outside
 * world. Everything with a decision in it lives above, and this is the part
 * verified by running the app rather than by a test.
 */
export function sshDial(store: HostStore): Dial {
  return async (host, dropped) => {
    const { connection, fingerprint, verdict } = await connectToHost(
      host,
      store,
      undefined,
      dropped,
    );
    // A non-PTY channel for one command, beside the screen exec: the Composer's
    // uploads and the Host CLI install run on these.
    const openChannel: OpenUploadChannel = (command, events) =>
      connection.openShell({ term: '', command }, events);
    return {
      transport: sshTmuxTransport(connection),
      upload: createUploader(openChannel),
      openChannel,
      fingerprint,
      verdict,
      isConnected: () => connection.isConnected,
      disconnect: () => connection.disconnect(),
    };
  };
}

let app: HostConnections | null = null;

/** The app's Connections, one per Host, for the Attach and every screen. See ADR 0012. */
export function appConnections(): HostConnections {
  app ??= createHostConnections({
    dial: sshDial(deviceHostStore()),
    store: deviceHostStore(),
    log: deviceLog(),
  });
  return app;
}
