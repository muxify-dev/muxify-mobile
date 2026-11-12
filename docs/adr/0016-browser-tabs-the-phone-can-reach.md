# The phone opens the Browser Tabs it can reach

The Title Sheet lists a Browser Tab when the phone can load its URL. Before
this decision, it listed only Tabs at a Tailscale address. Now it also lists
public sites, such as `https://github.com/`. A tap opens a public site in the
same Web View as a Tailscale page. This decision replaces the "Why only those"
section of ADR 0015. The rest of ADR 0015 still applies.

## What the phone can reach

The phone sorts each URL into one of four kinds:

| Kind | Examples | Listed |
|---|---|---|
| tailnet | `*.ts.net`, an IPv4 address in 100.64.0.0/10 | yes |
| public | `github.com`, a public IPv4 address | yes |
| host-local | `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, a name with no dot, 127.0.0.0/8, 0.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, an IPv6 address | no |
| not web | not http or https: `about:`, `file:`, `chrome:` | no |

A host-local URL is an address as the Host sees it. On the phone, the same URL
is the phone itself, or a network that the phone is not on. A name with no dot,
such as `devbox`, resolves only on the Host's own network. The phone does not
know the Host's private networks, so it does not list 10.0.0.0/8 or
192.168.0.0/16, although some phones are on the same LAN. Desktop Muxify gives
Tailscale URLs by name, so an IPv6 address is almost always `::1` or a
link-local address. The phone does not list IPv6 addresses.

The phone does not check that a page loads before it lists the Tab. A public
site that is down shows the reason and **Try again**, as a Tailscale page does.

## Why public sites now

ADR 0015 said that the list is for the pages that the Host serves, and that the
user has a browser for the others. The user now wants the public pages of a
Window too, such as a page on GitHub, at the Session and with Back to the
Session under them.

The Web View keeps its cookies when the app stops (the persistent
`WKWebsiteDataStore` of `react-native-webview`). After one sign-in, a site such
as GitHub stays signed in. The sign-in on the Mac does not come to the phone,
because the phone loads the page again (ADR 0015, "The phone loads the page
again").

## Defaults

The user did not choose these items. They are the defaults until the user asks
for something different:

- A host-local Tab is not listed. It is not a dimmed row, because a row that
  cannot load is a row that the user learns not to tap.
- A public site opens in the Web View, not in Safari.
- The Web View has no "Open in Safari" button.

## Considered and rejected

- **An SSH tunnel for host-local Tabs.** Rejected for the reasons in ADR 0015:
  it adds a forward for each Tab to the life of the Connection, and a page that
  names its own origin breaks when the port differs.
- **Keep the Tailscale rule and add a list of allowed public sites.** Rejected:
  the user must keep the list, and the rule does not say what the user cares
  about, which is whether the page loads.

## Consequences

**`NSAllowsArbitraryLoadsInWebContent` now also applies to public sites.** A
public page at plain http loads in the Web View. The app's own connections keep
the default rule.

**The Log counts each kind.** For each read, the Log gives the number of Tabs of
each kind, so a Tab that is missing from the list is easy to explain.
