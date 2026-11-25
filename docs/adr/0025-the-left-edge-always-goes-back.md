# The left edge always goes back

> **Status: superseded in part by [ADR 0034](0034-only-the-left-edge-goes-back.md).**
> Only the left edge goes back now, on every screen. The "Three modes" and
> "'edge'" points no longer apply. On the Host Screen, a drag right on the
> list no longer goes back, and the tab swipe waits for no content pop. The
> edge band and the layers that yield in it still apply.

The Terminal Screen had no reliable Back Swipe. Its full-screen back swipe was
off, because a swipe right is the previous Pane (5cae908). Only UIKit's strict
edge pop was left. It raced the Surface's one-finger pan, which takes a drag
right from any point, also from x = 0. In the e2e suite, a drag from x = 2 did
not leave the Terminal Screen. Every other screen went back from anywhere, as
iOS 26 does. On the Host Screen, only a tap changed between Topics and
Sessions.

## Decision

One rule for the app: the left edge always goes back. Inside the content, a
sideways drag moves inside the screen when the screen has something to move
between. On other screens it goes back too.

- **The edge band** is 24 points at the left edge, `BACK_EDGE` in
  `src/navigation/back-swipe.ts`. It is the one number for every layer.
- **Three modes.** A screen picks `'anywhere'`, `'edge'` or `'off'` with
  `useBackSwipe`. `'anywhere'` is the default in the layout. The Terminal
  Screen is `'edge'`, and `'off'` while a Selection is open, because a handle
  can be at column 1. The Host Screen is `'anywhere'`, because its tab swipe
  starts only on the tab control and the bar at the bottom.
- **`'edge'`** keeps the iOS 26 content pop on, and limits where it begins
  with `gestureResponseDistance`. The stack measures where the finger is when
  the pop begins, after some travel, so the limit is the band plus that
  travel.
- **Each layer with its own sideways drag yields in the band.** A drag right
  that landed in the band is not the layer's. The Surface's pan says no to it
  (`backEdge`, a prop of the patched libghostty view). The Mouse Layer and the
  inactive Pane cover use `startsAtBackEdge`. The Host Screen's tab swipe (the
  local `TabSwipe` module) says no to it. The two gestures never compete.
- **The Host Screen's tab swipe** starts only on the tab control and on the
  bar at the bottom (the Go to field and **＋**). It has the Pane Swipe's
  numbers and tick, and the segmented control changes at the commit point. The
  rows, the section headers and the empty area are the list's: a Topic card
  keeps its swipe action, and a drag right there goes back. UIKit draws the
  bar at the bottom in the navigation controller's view, beside the screens
  (on iOS 26, as a floating bar), so the gesture sits on that view. It takes
  only the touches that land on the control or on the bar while the Host
  Screen is on top. The stack's back swipe from anywhere waits for it to fail,
  so a sideways drag there is the tab's and not back. A tap goes to the
  control, the field or **＋**, because the gesture begins only after a
  sideways move. It is a gesture recognizer of its own kind, not a pan: a
  segmented control says no to every sideways pan that lands on it, so that
  its thumb can slide.

## Considered

- **The Surface's pan waits for the system's edge pop.** A smaller patch, but
  the band is UIKit's narrow one, which the app cannot tune, and the Host
  Screen would need a different method. The app would then have two rules.
- **Full-screen back on the Terminal Screen, and the Pane Swipe on two
  fingers.** It breaks the Pane Swipe that the suites and the user's hands
  know, and two fingers is the iPad trackpad's gesture.
- **A pager over the whole Host Screen list, rows included.** A swipe left on
  a Topic card would mean two things, and a SwiftUI pager and swipe actions in
  one list are known to fight.
- **The tab swipe everywhere outside the rows, and back at the edge only.**
  The first version. The section headers and the empty area under the rows
  changed the tab, so the Host Screen was the one list where a drag right
  from the middle did not go back, and a drag that started a little off a
  row changed the tab.
- **A thin view of the app's own over the bar at the bottom.** A view on top
  gets every touch on the bar, so it must pass each tap to the field or **＋**
  by hand, and it must follow the bar's frame. The gesture on the navigation
  controller's view needs neither.

## Consequences

A new layer with a sideways drag on an `'edge'` screen must yield in the band
with `startsAtBackEdge`, or the two gestures race again. `e2e/back-swipe.sh`
drags from x = 2 on the Terminal Screen, the Host Screen and Settings.

The Host Screen's tab swipe depends on where UIKit puts the bar at the
bottom: a view of the navigation controller's own, beside the screens and the
navigation bar. If a later iOS moves the bar into the screen's view, the bar
no longer starts the swipe, and `e2e/back-swipe.sh` step 5 fails.
