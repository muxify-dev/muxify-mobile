# Host Screen gestures, Go to layout and the Terminal Header

Status: ready
Risk class: high (changes UX flows: the back swipe, the tab change, swipe feedback)
Review page with mocks and the simulator report:
~/.local/share/lavish-axi/c893df0baf24/host-screen-swipe.html

One issue, one commit, in this order. Each commit leaves the app working.
No branches: commit on the branch that is checked out.

## Decisions (made by the human)

- The lists follow the finger during a tab swipe, as now.
- On a Window with one Pane, a sideways drag on the Surface does nothing and
  gives no tick. Back stays at the edge band.
- While Go to has the keys, the navigation bar hides and the Go to list fills
  the screen from the top.
- The tab swipe starts on the tab control and on the bottom bar (Go to field
  and ＋) only. A tap on the control also changes the tab. The section
  headers and the empty area no longer change the tab. With the tab swipe off
  the list area, the Host Screen's back swipe is 'anywhere' again.

## 01 — The tab control is covered, and Go to leaves a stale top inset

Proven on the iPhone 17 simulator, iOS 27.2, with a layout probe:

- The Host Screen's content starts at y 0, under the navigation bar. SwiftUI
  moves each `Host`'s content down by the bar's inset by itself.
- Since #30 there are two Hosts: the tab control's (`Host matchContents`,
  header of `TabSwipe`) and the list's (in the strip). The control's Host is
  y 0, h 47, behind the bar. SwiftUI draws the Picker at y 101, outside that
  frame. The list area starts at y 47, and its Host paints its opaque
  background over y 101. The control shows until the strip gets its width,
  then it disappears, and a tap on it hits the list.
- Go to hides the control (header h 0) and the list area moves between y 47
  and y 0. The list's SwiftUI inset stays at the value for its old frame:
  "In Play" measured at 116, then 69 (top cut under the bar), then 170 (54
  points of gap). An app switch recomputes the insets and fixes it.

Fix direction: React Native owns the top inset. The content of this screen
starts below the bar, and each SwiftUI Host on it ignores the safe area
(`Host ignoreSafeArea`, @expo/ui). While Go to has the keys the bar hides
(decision above), so the top inset must follow the bar's real height then.
Verify the exact mechanism on the simulator; do not guess.

Gate: an e2e step (extend e2e/go-to.sh or e2e/back-swipe.sh) that opens and
closes Go to at least three times and checks, from `agent-device snapshot
--json` rects, that the first row is below the tab control and below the
navigation bar, and that a tap on "Sessions" changes the tab.

## 02 — The Terminal Header turns to the app colour during the back swipe

Reproduced: during a slow drag from the left edge, the whole bar (with the
status bar) turns the app's grey over the terminal's Theme colour at once.
The bar is the stack's one navigation bar; the Terminal Screen gives it the
Theme colour (src/components/terminal-header.tsx `headerStyle`), the Host
Screen gives it the app colour, and UIKit blends the bar between them.

Fix direction: the bar has no colour of its own on the Terminal Screen
(`headerTransparent`), and the Terminal Screen paints the Theme colour under
the bar in its own view, so the colour slides with the screen. If the Host
Screen's bar colour still blends in over the terminal, make that one
transparent too, with the same rule as 01. The Web View shares the Header.

Gate: a recorded slow back swipe (simctl recordVideo + ffmpeg frames) shows
the Theme colour on top of the terminal part of the screen in every frame.

## 03 — A sideways drag on a Window with one Pane ticks

Proven from the code: the patched Surface (patches/expo-libghostty.patch,
`touchPanMayBegin`) locks a sideways drag horizontal whenever `onSwipe` is
set, and `handleHorizontalPan` ticks at the commit point. The Terminal
Screen always sets `onSwipe`. With one Pane `paneForSwipe` finds nothing.

Fix: a Surface prop (for example `swipes: boolean`), true only when the
Window has another Pane to go to. False: the drag is not a swipe, no tick,
no movement; it scrolls as a normal touch scroll. The Mouse Layer ticks from
JS (`usePaneSwipe.drag` with `ticks`): the same rule there. Unit test the JS
part. A native change needs `expo prebuild` and a rebuild.

## 04 — Go to shows no sign of a read

Proven from the code: `GoToList` shows "Reading folders…" only when the list
has no rows. Running Sessions and the saved answer give rows at once.

Fix: while a read runs, a "Reading folders…" row with a spinner after the
rows on show, so no row moves. It goes when the answer comes or the read
fails. Not reproduced: the slowness itself (likely a new SSH Connection after
the 60 s idle close or a return from the background). Do not change the
Connection rules in this task.

## 05 — The tab swipe moves to the tab control and the bottom bar

See the decisions above. The bottom bar is the navigation controller's
UIToolbar (`Stack.Toolbar placement="bottom"`), not a React view. The
TabSwipe module needs a pan there; the stack's content pop must not win a
drag that starts on the bar. Check first that a pan on that toolbar gets
touches on iOS 26+ (the bar is a `_UIFloatingBar`). Fallback: a thin native
view over the bar that takes only sideways drags and lets taps through.

Keep: the commit point, tick and numbers of the Pane Swipe; the 24 point back
edge band (a drag right that starts in it goes back, also on the bar); a tap
on the Go to field still gives it the keys; the swipe is off while Go to has
the keys, while a card moves, while a place fills, and with one tab. A Host
with no Go to has no bar: the control's swipe and tap still work.

Update ADR 0025 (the Host Screen part), the Host Screen entry in CONTEXT.md,
and e2e/back-swipe.sh step 5 (a drag from the middle of the Host Screen now
goes back; a drag on the control or the bar changes the tab).
