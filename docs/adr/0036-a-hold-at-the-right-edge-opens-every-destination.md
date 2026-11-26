# A hold at the right edge opens every destination

## Problem

Four controls reached destinations, and each one reached only part of the
tree. The Title Sheet reached Windows, Sessions and Topics, and the Tabs of
the current Window only. The Panes picker and the Pane Swipe reached Panes
of the current Window only. So a move to a Pane in another Window took two
controls. On the Web View the Panes picker and the Pane Swipe were not
there. The left edge goes back (ADR 0034), and the right edge had no meaning.

## Decision

A Grip at the right edge opens the Edge Drawer, on the
Terminal Screen and on the Web View. Gleb chose each part on the planning
page of 26 Nov 2026:

- **D1, the design:** the Edge Drawer, a tree list that slides from the
  Grip. Not a full-screen map of Windows, a slide through columns, or a
  search field first.
- **D2, the pick:** first both gestures: a lift on a row picks it, and a
  lift on the Grip left the drawer open for a tap. Gleb added the Cancel
  Zone: a lift outside the drawer closes it. After use on the iPad he made
  the drawer drag-only, as it is a quick switch: each lift closes it, and a
  lift on no row picks nothing. The close button went. He added the Lift
  Lane, a strip beside the rows where the held finger can move and lift
  with no pick, and an automatic scroll near the list's top and bottom.
  VoiceOver has no held finger, so its activate on the Grip still
  opens a drawer that stays open. Later the Grip went from a thin pill at
  the middle of the right edge to a round Liquid Glass button where a
  thumb reaches it: a little in from the bottom right corner on a phone,
  in the corner on an iPad. Then it became almost clear glass with no
  symbol: from the touch it fills with colour, and when the drawer opens it
  glows. The button was too visible, so it went back to the right edge as
  a small glass line, 6 × 48 points, with the same fill and glow. On a
  phone it is in the middle of the screen, where the thumb rests and just
  above the keyboard, so it does not move when the keyboard comes, and a
  phone on its side has none; on an iPad three quarters down. The drawer became a floating glass panel with an iOS grouped list,
  a card for each Session. With the Grip at the bottom,
  the drawer's list reads from the bottom up: the attached Session's card
  is by the finger. The drawer closes at the pick, and the move goes on
  behind it, so an open drawer never covers the Grip while a move runs.
- **D3, the scope:** first the Topic the Attach holds, or the attached
  Session, then a group with the other live Topics and the Sessions in no
  Topic. After use Gleb removed the group, and the setting that chose what
  it listed: the drawer is a view of the place on screen only, and the
  Host Screen is one step back for the rest. So the list is short, and
  rarely needs a scroll.
- **D4, the Tabs:** the Tabs of every listed Window, one read per Window
  each time the drawer opens.
- **D5, the hold:** 400 ms. Between the Selection long press (0.35 s) and
  the UIKit default (0.5 s).
- **D6, the old switchers:** they stay. A trial setting, off by default,
  hides every way into the Panes picker: the Layout Map, the Panes key and
  Options › Panes. Zoom and Split keep their own items in Options. Whether
  to retire them is decided after use. At first it hid the title tap too;
  after use Gleb kept the title tap at all times.

The drawer is the Title Sheet's second presentation in `useTitleSheet`, not
a second chooser. The two share the picks, the revision that a late answer
is checked against, and the error a pick leaves. So a pick in the drawer
does what the same pick in the sheet does, on both screens.

The Grip is a React Native view over the Surface and the page, not a
gesture in the Surface. The Surface's gestures are native, in the local
patch to `expo-libghostty`, and a recognizer of our own over the Surface
loses the race to them (see MouseLayer in `terminal.tsx`). The band takes
the touches that land in it. A drag that moves 20 points first is passed to
the Pane Swipe, as the layer on a Pane that is not the active one does.

## Consequences

- A page in the Web View does not scroll from the Grip's band, 28 × 110
  points at the right edge.
- A tap in the band does nothing. It does not raise the keyboard, as a tap
  on the Surface does.
- The drawer lists the Panes of the Window on screen only. The Topology has
  no Panes of other Windows; a pick of that Window and then a Pane is two
  picks.
- A trackpad click on the Grip does not open the drawer at once, and hover
  does not brighten it. A pointer press is a touch to React Native, so it
  must also be held.
- A held finger does not drag the list. The list scrolls by itself while
  the finger is near its top or bottom, and by a drag after the lift.
