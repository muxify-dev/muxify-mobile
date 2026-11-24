import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeError } from '@/lib/describe-error';
import type { HostServer } from '@/ssh/host-server';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import { onHost } from './host-writes';
import type { ServerConnections } from './host-write-request';

const say = speakingAs(deviceLog(), 'visit');

/**
 * Tells the Host that the user opened a Session at this folder:
 * `visit_session_path { folder }` on its Host Server. Nothing waits for it
 * and a failure changes nothing on screen: the visit only ranks the folder in
 * the next Go to list, on the Mac and on the phone. A folder that starts with
 * `~` is the Host's home, as the Host Server takes only absolute folders.
 */
export function recordVisit(host: Host, folder: string, connections: ServerConnections = appConnections()): void {
  void connections.onServer(host, async (server) => {
    if (await ranksGoTo(server)) return;
    const absolute = await onHost(host, folder);
    await server.request({ visit_session_path: { folder: absolute } });
  })
    .catch((error: unknown) => say(`${host.displayName} did not record the visit of ${folder}: ${describeError(error)}`));
}

/** A Session visit uses the capability of the Connection that opened it. */
export function recordSessionVisit(host: Host, session: string, connections: ServerConnections = appConnections()): void {
  void connections.onServer(host, async (server) => {
    if (await ranksGoTo(server)) await server.request({ visit_session: { session } });
  }).catch((error: unknown) => say(`${host.displayName} did not record the visit of ${session}: ${describeError(error)}`));
}

async function ranksGoTo(server: HostServer): Promise<boolean> {
  let state = server.state();
  if (state.kind === 'starting' || state.kind === 'installing') {
    state = await new Promise<ReturnType<HostServer['state']>>((resolve) => {
      const stop = server.onState((next) => {
        if (next.kind === 'starting' || next.kind === 'installing') return;
        stop();
        resolve(next);
      });
    });
  }
  return state.kind === 'live' && state.goTo === true;
}
