# The phone opens only the Browser Tabs at a Tailscale address

> **Status: superseded in part by [ADR 0016](0016-browser-tabs-the-phone-can-reach.md).**
> The phone now also lists public sites. The "Why only those" section no
> longer applies. The rest of this decision still applies.

The Title Sheet lists the Browser Tabs of the Window on screen, and a tap opens
one in the Web View. The phone reads the Tabs from desktop Muxify with
`muxify browser tabs --window <id> --json`, on the Host's Connection, as it
reads Topics. It lists a Tab only when the URL is http or https at a Tailscale
address: a `*.ts.net` name, or an IPv4 address in 100.64.0.0/10.

## Why only those

A Tab's URL is an address as the Host sees it. `http://localhost:3000` on the
Host is the Host's own port, and on the phone the same URL is the phone. A page
at a Tailscale address is the same page from each machine of the tailnet, and
the phone is on the tailnet, because that is how it reaches the Host.

A public site would load, but it is not the reason for the list. The list is
for the pages that the Host serves, such as a dev server or a preview that an
Agent opened. The user has a browser for the others.

## The phone loads the page again

The Web View loads the URL on the phone. It does not show the Tab of the Host:
the scroll position, a form that is filled in and a sign-in on the Mac stay on
the Mac. This is the cost of a list that needs nothing but a URL.

## Plain http

A dev server at a Tailscale address is usually plain http. iOS refuses plain
http at a name unless the app allows it, so `app.json` sets
`NSAllowsArbitraryLoadsInWebContent`. It applies to web content only. The
app's own connections keep the default rule.

## Considered and rejected

- **An SSH tunnel for `localhost` Tabs.** The phone would forward a local port
  to the Host's port down the Connection and load `localhost` on the phone. It
  would show every dev server with no Tailscale address. Rejected for now: it
  adds a forward for each Tab to the life of the Connection, and a page that
  names its own origin breaks when the port differs. A Host that serves on its
  Tailscale address needs none of it.
- **List every Tab and let the load fail.** Rejected: a row that cannot load is
  a row that the user learns not to tap.
- **Tailscale IPv6 addresses (`fd7a:115c:a1e0::/48`).** Left out: the spec names
  the two forms above, and desktop Muxify gives Tailscale URLs by name.
- **The system browser, or `expo-web-browser`.** Rejected: the page must open
  inside the app, with Back to the Session under it.

## Consequences

**`react-native-webview` is a native module.** It is the web view that the Expo
57 documentation names, added with `npx expo install`. A dev client built before
it must be built again.

**The Web View showed a crash in the Surface.** A screen pushed over the
Terminal Screen takes the Surface out of the window, and the library then
frees its ghostty surface and builds a new one on Back. ghostty left the layer
of the freed surface in the view, with a pointer to the freed renderer. The
Topic Screen did the same and did not crash, because nothing had reused the
memory. A web page does, and about one Back in ten from the Web View ended the
app. The local patch to `expo-libghostty` now removes the layer when the
surface is freed.

**The read is one exec for each open of the Title Sheet.** `muxify` is found
once for each Connection (ADR 0012), so a Host with no desktop Muxify costs no
exec. A read that fails lists no Tabs and writes the reason to the Log. The
sheet shows no error for it, because a Host with no Browser is the usual case
and not a fault.

**The e2e sandbox has a stub `muxify`.** `muxify browser` talks to the Muxify
app that shows the tmux server. The sandbox puts a stub first on its sshd's
PATH that answers `browser` from a fixture and gives every other command to the
real CLI, so no e2e run reaches the app that the user works in.
