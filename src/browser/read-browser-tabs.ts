import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { deviceHostStore } from '@/storage/device-store';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';
import type { ServerConnections } from '@/topics/host-write-request';

import {
  parseBrowserTabs,
  reachability,
  reachableTabs,
  tabRestoreOf,
  type BrowserTabsRead,
  type Reachability,
  type TabRestore,
} from './tabs';

const say = speakingAs(deviceLog(), 'browser');

/**
 * One read of a Window's Browser Tabs from its Host, for the Title Sheet and
 * a Topic Place's restore: `browserTabsOn` for the saved Host with this id.
 */
export async function readBrowserTabs(hostId: string, window: string): Promise<BrowserTabsRead> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  return browserTabsOn(host, window);
}

/**
 * `browser_tabs { window }` on the Host's Host Server, which answers the Tabs
 * that desktop Muxify stored for the Window, named by tmux's id. It gives only
 * the Tabs that the phone can reach (ADR 0017). It never throws: a Host in
 * Sessions only and a Host Server that refuses are each a failed read that
 * carries its reason, and the Log gets that reason.
 */
export async function browserTabsOn(
  host: Host,
  window: string,
  connections: ServerConnections = appConnections(),
): Promise<BrowserTabsRead> {
  try {
    const answer = await connections.onServer(host, (server) => server.request({ browser_tabs: { window } }));
    const listed = parseBrowserTabs(answer);
    say(`${host.displayName} listed ${listed.length} Tab(s) for ${window}: ${countByReachability(listed)}`);
    return { kind: 'listed', tabs: reachableTabs(listed) };
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} listed no Tabs for ${window}: ${message}`);
    return { kind: 'failed', error: message };
  }
}

/**
 * What reopening a Topic does with its Topic Place's Tab at `url`, after one
 * read of the Tabs of the Window it opened on. With no active Window there is
 * nothing to read, and the Tab shows as on a failed read.
 */
export async function readTabRestore(hostId: string, window: string | undefined, url: string): Promise<TabRestore> {
  const read: BrowserTabsRead = window ? await readBrowserTabs(hostId, window) : { kind: 'failed', error: 'no active Window' };
  return tabRestoreOf(read, url);
}

/** For example `2 tailnet, 1 public, 1 hostLocal, 0 notWeb`, so the Log explains a Tab that the list leaves out. */
function countByReachability(tabs: { url: string }[]): string {
  const counts: Record<Reachability, number> = { tailnet: 0, public: 0, hostLocal: 0, notWeb: 0 };
  for (const tab of tabs) counts[reachability(tab.url)] += 1;
  return Object.entries(counts)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
}
