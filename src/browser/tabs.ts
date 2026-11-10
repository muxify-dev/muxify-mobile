/**
 * What `muxify browser tabs --window <id> --json` says about one Window's
 * Browser, and which of its Tabs the phone can open.
 */

import { array, object, string } from '@/topics/json-shape';

/** One Tab of a Window's Browser on the Host, as desktop Muxify lists it. */
export interface BrowserTab {
  id: string;
  url: string;
  /** Empty until the page has one. */
  title: string;
  /** Whether it is the Tab that the Browser shows. */
  active: boolean;
}

/**
 * One read of a Window's Tabs. A Host with no desktop Muxify, a tmux server
 * that Muxify does not show and a `muxify` too old to have the command are
 * each a failed read, and the Title Sheet then lists no Tabs.
 */
export type BrowserTabsRead = { kind: 'listed'; tabs: BrowserTab[] } | { kind: 'failed'; error: string };

/** Parses the answer once, at the boundary. Throws with the path of the first thing that is wrong. */
export function parseBrowserTabs(json: unknown): BrowserTab[] {
  return array(json, 'tabs').map((tab, index) => {
    const at = `tabs[${index}]`;
    const entry = object(tab, at);
    return {
      id: string(entry.id, `${at}.id`),
      url: string(entry.url, `${at}.url`),
      title: string(entry.title, `${at}.title`),
      active: entry.active === true,
    };
  });
}

/** The Tabs the phone can reach, in the Browser's order. */
export function tailscaleTabs(tabs: BrowserTab[]): BrowserTab[] {
  return tabs.filter((tab) => isTailscaleAddress(tab.url));
}

/**
 * Whether a URL is a web page at a Tailscale address: a `*.ts.net` name, or an
 * IPv4 address in 100.64.0.0/10. The phone is on the Host's tailnet and
 * nowhere else the Host is, so `localhost` on the Host is not a page the phone
 * can load.
 */
export function isTailscaleAddress(url: string): boolean {
  const host = webHost(url);
  if (host === null) return false;
  if (host.endsWith('.ts.net')) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (!octets || octets.some((octet) => octet > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/** What a row calls a Tab: the page's title, or its address while it has none. */
export function tabLabel(tab: BrowserTab): string {
  return tab.title.trim() || tab.url;
}

/** The host and port of a URL, for a row's second line; the whole URL when it has none. */
export function tabAddress(tab: BrowserTab): string {
  return /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(tab.url)?.[1] ?? tab.url;
}

/**
 * The host of an http or https URL, in lower case, or null. A pattern and not
 * `URL`, whose `hostname` React Native has not always had.
 */
function webHost(url: string): string | null {
  const match = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#[\]]+)(?::\d*)?(?:[/?#]|$)/i.exec(url.trim());
  return match ? match[1].toLowerCase().replace(/\.$/, '') : null;
}
