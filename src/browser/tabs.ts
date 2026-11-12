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

/**
 * Whether the phone can load a URL that the Host's Browser has open. The
 * phone is on the Host's tailnet and on the internet, and on none of the
 * Host's own networks.
 *
 * - `tailnet`: a `*.ts.net` name, or an IPv4 address in 100.64.0.0/10.
 * - `public`: any other name with a dot, or a public IPv4 address.
 * - `hostLocal`: an address that on the phone is the phone, or a network the
 *   phone is not on: `localhost`, a name with no dot, a name under a suffix for
 *   local use, a loopback, private or link-local IPv4 address, or an IPv6
 *   address.
 * - `notWeb`: not an http or https URL with a host.
 */
export type Reachability = 'tailnet' | 'public' | 'hostLocal' | 'notWeb';

/** The Tabs the phone can reach, in the Browser's order. */
export function reachableTabs(tabs: BrowserTab[]): BrowserTab[] {
  return tabs.filter((tab) => {
    const reach = reachability(tab.url);
    return reach === 'tailnet' || reach === 'public';
  });
}

export function reachability(url: string): Reachability {
  const host = webHost(url);
  if (host === null) return 'notWeb';
  if (host.startsWith('[')) return 'hostLocal';
  if (/^[\d.]+$/.test(host)) return ipv4Reachability(host);
  if (host.endsWith('.ts.net')) return 'tailnet';
  if (!host.includes('.')) return 'hostLocal';
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))) return 'hostLocal';
  return 'public';
}

/** Names that resolve only on the network they are used on (RFC 6761, RFC 6762, RFC 8375, ICANN's `.internal`). */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];

/** A host of digits and dots that is not four octets from 0 to 255 is malformed, and the phone does not guess what it means. */
function ipv4Reachability(host: string): Reachability {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (!octets || octets.some((octet) => octet > 255)) return 'notWeb';
  const [first, second] = octets;
  if (first === 100 && second >= 64 && second <= 127) return 'tailnet';
  const hostLocal =
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254);
  return hostLocal ? 'hostLocal' : 'public';
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
 * The host of an http or https URL, in lower case and with no trailing dot, or
 * null. An IPv6 host keeps its brackets. A pattern and not `URL`, whose
 * `hostname` React Native has not always had.
 */
function webHost(url: string): string | null {
  const match = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]/?#]*\]|[^:/?#[\]]+)(?::\d*)?(?:[/?#]|$)/i.exec(url.trim());
  return match ? match[1].toLowerCase().replace(/\.$/, '') : null;
}
