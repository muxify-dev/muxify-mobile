# The Edge Drawer ends at the finger

## Problem

The Edge Drawer's list reads from the bottom, so the attached Session's card
is last. But the panel always used the full height, and its bottom was at the
bottom of the screen. The Grip is in the middle of a phone and three quarters
down an iPad. So the last row was far below the finger that opened the
drawer: about 360 points on an iPhone 17 and 240 on an iPad. Only with a
phone's keyboard up was it near. Gleb had to slide the finger down to reach
the rows he uses most.

## Decision

The panel ends at the finger. Gleb chose each part on the review page of
26 Nov 2026 (`.scratch/edge-drawer-placement/spec.md`):

- **D1, the anchor:** the point where the finger held the Grip. The band is
  110 points high, so the Grip's centre can be 55 points from the finger.
  VoiceOver has no finger, so its open uses the Grip's centre. **[Amended by
  ADR 0042: the anchor is the point where the finger lit Destinations on the
  Grip's Fan, about 44 points above the button's centre. VoiceOver still uses
  the Grip's centre.]**
- **D2, the height:** the panel is as tall as its list, up to the top of the
  screen. ADR 0036 D3 keeps the list short, so most panels are small and
  stay at the finger. A long list reaches the top and scrolls by itself.
- **D3, the iPad:** the same rule as the phone.

The panel's bottom is 34 points below the finger: the list's bottom padding
and half a row. So the last row is level with the finger, and a slide to the
left from the Lift Lane lands on it. The bottom never goes below the
keyboard's top or the home indicator (`drawerBottom` in
`navigation/grip.ts`).

The anchor is set once for each open. The panel does not move with the
finger, as the rows would then move under it. Only a change of the keyboard
moves its bottom.

## Consequences

- The Cancel Zone is now also above and below the panel, not only at its
  left. Its label is at the left, at the panel's bottom, by the finger.
- A held finger is checked against the panel's measured frame, not the
  full-screen overlay: the row under it, the Cancel Zone and the automatic
  scroll all use it.
- On an iPad the terminal is live above and below the column too.
