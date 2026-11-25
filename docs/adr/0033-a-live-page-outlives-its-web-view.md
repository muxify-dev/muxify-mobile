# A Live Page outlives its Web View

Before this decision, the Web View screen held the page's `WebView`. Back, a
pick in the Title Sheet and another Tab unmounted the screen, and the page
ended with it. The Place kept only the address and the scroll, so the page
opened again loaded from the start: a form half filled in was empty, and a
page that keeps its sign-in in memory or `sessionStorage` was signed out.

Now the page is a Live Page. `LivePagesProvider` sits above the navigator, as
the `AttachProvider` does (ADR 0007), and renders the `WebView` of each Live
Page there. The Web View screen puts a `PortalHost` in its body.
`react-native-teleport` moves the native `WKWebView` into that host, with no
remount, and moves it back when the screen goes. There the page waits under
the navigator's screens, out of sight.

## Hide is not close

- **Hide**: Back, the swipe from the edge, a Window, Session or Topic pick in
  the Title Sheet, and another Tab. The page waits. The Place still follows
  the rules of ADR 0020 and ADR 0030.
- **Close**: the Close Page button in the Web View's toolbar. The page is
  released, the Place forgets the Tab, and the Terminal Screen takes its
  place. A Tab that the Host lists no more when a Place opens it is released
  in the same way.

## Owners and release

A Live Page is keyed by the Host, the Place owner (a Topic, or a Session with
no Topic) and the Tab's URL. The same URL in two Topics is two pages, so no
form text, `sessionStorage` or page script goes from one Topic to another.
Cookies and `localStorage` are the web data store's, which the app shares by
design (ADR 0017).

The app releases the pages of an owner that the Host does not have any more.
On each Listing, a page whose Topic is not open on the Board, or whose
Session the Host does not have, is released. A page opened after that Listing
was received waits for the next one, because its Topic can be newer than the
Listing. Deleting a Host releases all its pages. A Disconnect keeps them, as
it keeps the Places.

## Considered and rejected

- **An overlay above the navigator, moved to the screen's frame.** It needs no
  native module, but the page does not move with the push and pop
  animations, and it covers what the screen draws over the page: the
  Connection Screen of a cold start and the reason a load failed.
- **Save the form and the scroll with injected script, and fill them in
  again.** It does not keep page script state, `sessionStorage`, or a form
  that the page draws itself.
- **A local Expo module that moves the view.** It does what
  `react-native-teleport` does, which already handles Fabric's mount
  instructions and the layout of the moved views.

## Consequences

- `react-native-teleport` is a native module. A dev client built before it
  must be built again.
- Each Live Page is one `WKWebView` in memory until it is released. The app
  does not limit the number of pages. Settling a Topic, or Close Page, gives
  the memory back.
- A hidden page is in the window, under the screens, so its timers continue.
  WebKit can slow them down because the page is not visible.
- Live Pages do not survive an app restart. The Place opens the page again at
  its address and scroll, as before.
