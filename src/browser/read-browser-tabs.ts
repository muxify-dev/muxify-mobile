import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';

import { reachability, reachableTabs, type BrowserTabsRead, type Reachability } from './tabs';

const say = speakingAs(deviceLog(), 'browser');

/**
 * One read of a Window's Browser Tabs from its Host, on the Host's
 * Connection, for the Title Sheet. It gives only the Tabs that the phone can
 * reach. It never throws: a Host that is no longer saved, a Host that
 * refuses and a Host with no Browser to list are each a failed read that
 * carries its reason, and the Log gets that reason.
 */
export async function readBrowserTabs(hostId: string, window: string): Promise<BrowserTabsRead> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  try {
    const read = await appConnections().read(host, (transport, muxify) =>
      muxify.browserTabs((command) => transport.exec(command), window),
    );
    if (read.kind === 'failed') {
      say(`${host.displayName} listed no Tabs for ${window}: ${read.error}`);
      return read;
    }
    const tabs = reachableTabs(read.tabs);
    say(`${host.displayName} listed ${read.tabs.length} Tab(s) for ${window}: ${countByReachability(read.tabs)}`);
    return { kind: 'listed', tabs };
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} refused the Tabs of ${window}: ${message}`);
    return { kind: 'failed', error: message };
  }
}

/** For example `2 tailnet, 1 public, 1 hostLocal, 0 notWeb`, so the Log explains a Tab that the list leaves out. */
function countByReachability(tabs: { url: string }[]): string {
  const counts: Record<Reachability, number> = { tailnet: 0, public: 0, hostLocal: 0, notWeb: 0 };
  for (const tab of tabs) counts[reachability(tab.url)] += 1;
  return Object.entries(counts)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
}
