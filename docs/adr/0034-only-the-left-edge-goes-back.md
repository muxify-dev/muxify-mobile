# Only the left edge goes back

This decision replaces the "Three modes" and "'edge'" parts of ADR 0025. The
rest of ADR 0025 still applies: the 24-point edge band, and each layer with
its own sideways drag yields in the band.

## Problem

A drag right in the middle of a screen sometimes went back. It happened most
in the Web View. ADR 0025 made `'anywhere'` the default, so every screen but
the Terminal Screen had the iOS 26 content pop: a drag right from any point
goes back. The native stack (`react-native-screens`) makes the content pop
wait for a scroll view under the finger only when that scroll view can
scroll sideways (`contentSize.width > frame.width`). So a drag right in the
Web View went back on a page as narrow as the screen, and scrolled on a wider
page. The same page changed between the two when it loaded, zoomed or
changed its layout. To the user, back from the middle of a page came and
went.

Two recognizers go back on iOS 26:

- **UIKit's edge pop**, `interactivePopGestureRecognizer`, a screen-edge pan.
  It begins only for a finger that lands at the left edge. The stack makes
  every scroll view wait for it. A synthetic drag in the simulator never
  starts it, also from x = 0, so the e2e suites cannot check it.
- **The iOS 26 content pop**, `interactiveContentPopGestureRecognizer`. It
  begins anywhere. The stack turns it on with `fullScreenGestureEnabled` and
  limits it with `gestureResponseDistance`. The stack checked that limit
  where the finger was when the pop began, not where it landed, so the
  `'edge'` mode of ADR 0025 went back for a drag that landed at x = 28 or 32,
  and a slow drag from x = 20 did nothing.

The stack's own `RNSPanGestureRecognizer` and `RNSScreenEdgeGestureRecognizer`
work only with a custom animation on swipe, which the app does not use. The
Web View keeps `allowsBackForwardNavigationGestures` off, so the page's own
history has no swipe.

## Decision

Only the left edge goes back, on every screen. Every screen limits the
content pop to the 24-point band, `BACK_EDGE`, and the stack checks the limit
where the finger landed.

- **Two modes.** A screen picks `'edge'` or `'off'` with `useBackSwipe`.
  `'edge'` is the default in the layout. The Terminal Screen is `'off'` while
  a Selection is open.
- **A patch to `react-native-screens`** (`patches/react-native-screens.patch`)
  keeps the point where the finger landed for the content pop and checks
  `gestureResponseDistance` against it. On a screen with a limit, a touch
  that landed inside it belongs to the pop: a scroll view under it waits for
  the pop, as it waits for UIKit's edge pop. So the edge goes back also on a
  page that scrolls sideways.
- **A drag in the content is always the content's.** A page scrolls, the
  Surface changes the Pane, a Topic card opens its swipe action, and a list
  does nothing.
- **The layers keep yielding in the band.** The Surface (`backEdge`), the
  Mouse Layer and the inactive Pane cover (`startsAtBackEdge`), and the Host
  Screen's tab swipe (`SidewaysDrag`) fail a drag right that lands in the
  band. The layers and the stack now use the same point, where the finger
  landed, and the same width.
- **The Host Screen's tab swipe no longer holds the content pop off.** The
  pop begins only in the band, where the tab swipe fails.
- **A trackpad scroll follows the same rule.** On iPad, both back
  recognizers take a continuous two-finger scroll (`allowedScrollTypesMask`
  is `.continuous`, read from the running app). A scroll has no touch, and
  the pointer stays put while it runs, so the patch checks the band at the
  pointer. On the Terminal Screen, the trackpad pan (`TrackpadScroll`, which
  changes the Pane) fails a scroll to the right with the pointer in the band,
  so the back swipe takes it. Elsewhere a trackpad scroll changes the Pane or
  moves the Scrollback, as before.
- **Before iOS 26** the stack has no content pop and would draw one of its
  own, so the back swipe stays UIKit's edge pop there.

## Considered

- **Keep `'anywhere'`, and make only the Web View `'edge'`.** It fixes the
  page, and keeps a different rule for each kind of screen. The user asked
  for the same rule on every screen.
- **Turn the content pop off, and keep only UIKit's edge pop.** No patch,
  and the edge pop is the system's own. But its band is UIKit's, which the
  app cannot tune, and no e2e drag can start it, so the suites could not
  check that the edge goes back on any screen.
- **`gestureResponseDistance` with no patch.** The limit is measured after
  some travel, so the band is not where the finger landed, and on a page
  that scrolls sideways the scroll wins also at the edge.

## Consequences

The patch must move with each upgrade of `react-native-screens`. If a later
version checks the landing point itself, drop the patch. `e2e/back-swipe.sh`
drags from x = 2 and from the middle on the Terminal Screen, the Host Screen,
Settings and the Web View, on a page as narrow as the screen and on a wider
one. A failure on the wide page at the edge means the scroll view no longer
waits for the pop. No suite can drive a trackpad scroll, so the trackpad
rule is checked by hand on an iPad with a trackpad.
