# The Edge Drawer ends at the finger

Status: done. ADR 0037 records what was built (Gleb decided D1–D3 on the review page, 26 Nov 2026).
Review page with drawings:
~/.local/share/lavish-axi/427318fe5195/edge-drawer-placement.html
Risk class: medium (changes where a held finger finds the rows; the Lift, the Cancel Zone and the scroll read the panel's frame)

## Problem

Gleb holds the Grip and the Edge Drawer opens. The attached Session's card is
last in the list, "at the bottom by the Grip" (ADR 0036, CONTEXT.md › Edge
Drawer). But the panel's bottom is not at the Grip. It is at the bottom of the
screen, so Gleb must slide the finger down to reach the rows he wants most.

## How the drawer is placed now

`src/components/edge-drawer.tsx`, `EdgeDrawer`:

- The panel is `position: absolute`, `top: PANEL_MARGIN` (8), `right: PANEL_MARGIN`.
- `bottom` is `insets.bottom + 8`, or the keyboard's top + 8 while the keyboard is up.
- So the panel always fills the full height. The list is `justifyContent: 'flex-end'`
  and opens at its end, so the last rows are at the panel's bottom.

The Grip is not at the bottom (`src/navigation/grip.ts`, `gripHeight`):

| Screen | Grip centre | Panel bottom | Finger to last row |
|---|---|---|---|
| iPhone 17, keyboard down (874 pt) | 0.5 → ~437 | 874 − 34 − 8 = 832 | ~395 pt down |
| iPhone 17, keyboard up | ~437 | keyboard top − 8 ≈ 530 | ~90 pt down |
| iPad Pro 11", portrait (1210 pt) | 0.75 → ~907 | 1210 − 20 − 8 ≈ 1182 | ~275 pt down |

Only with the phone's keyboard up is the last row near the finger. That is the
one case the Grip's place was set for.

How it moves:

- It comes in with `SlideInRight` (180 ms) and goes with `SlideOutRight` (150 ms).
  It does not move up or down.
- It does not follow the finger. Its bottom changes only when the keyboard frame changes.
- When Tabs arrive, the list keeps its distance from the end (`measure.keepFromEnd`
  in `useEdgeSwitcher`), so the rows under the finger stay in place.

## Proposal

Put the panel's bottom at the finger that opened it, so the last row of the
attached Session's card is level with the finger. A slide to the left from the
Lift Lane then lands on that row. The panel grows up from there.

1. **The anchor.** `useEdgeSwitcher` keeps the `y` of the hold (`heldAt`) as
   `anchorY` for the open, and passes it to `EdgeDrawer`. The panel's bottom is:

   ```
   bottom edge (screen y) = min(anchorY + ROW_REACH, floor)
   ROW_REACH = list bottom padding (10) + half a row's min height (24) = 34
   floor     = (keyboard top, or screen height − insets.bottom) − PANEL_MARGIN
   ```

   As a style: `bottom: screenHeight − that edge`, from the overlay's frame.
   The `min` keeps the panel above the keyboard and the home indicator.
2. **No finger (VoiceOver).** `onOpen` has no point. Use the Grip's centre
   (`gripCentre`) as the anchor, so the panel ends at the same place as for a hold.
3. **It does not follow the finger.** The anchor is set once for each open. A
   panel that moves with the finger would move the rows under it. This keeps the
   rule that `keepFromEnd` serves. Only a keyboard change moves the bottom, through `floor`.
4. **The frame a held finger is checked against.** `frame()` now takes `top`
   and `bottom` from the overlay, which is the full screen. It must take them
   from the panel: measure the panel's `Animated.View` with `measureInWindow`,
   as the overlay is measured. Then:
   - A lift below the panel is in the Cancel Zone (`inCancelZone` checks `y > bottom`).
   - `autoScrollSpeed` gets the real list window. The finger starts at the list's
     bottom, in the bottom scroll edge. The list opens at its end, so a scroll down
     does nothing. No change to the rule.
5. **The Cancel Zone's look.** Today the red tint and "Lift here to close" are a
   column at the left of the panel only. With space below the panel, the tint
   covers the whole scrim already (it is the scrim's colour). Keep the label in
   the left column, centred on the panel's height (`top`/`bottom` of the panel),
   not on the screen's.
6. **Docs.** CONTEXT.md › Edge Drawer: "The panel ends at the keyboard's top"
   becomes "The panel ends at the finger that opened it, and above the keyboard".
   D2 chose the fitted panel, so record it in a new ADR 0037 and point to it
   from ADR 0036's D2 history.
7. **Tests.** Put the arithmetic in `navigation/grip.ts` as a pure function
   (`drawerBottom(anchorY, floor)`) with tests in `grip.test.ts`, as for
   `gripCentre`. Extend `e2e/edge-drawer.sh` to check that the last row's
   centre is within a row of the hold point, with the keyboard down and up.

## Decisions

Gleb chose the recommendation for each one: D1 the hold point, D2 (b) fitted
to the list, D3 one rule for the phone and the iPad.

- **D1, the anchor: the hold point or the Grip's centre?**
  The band is 110 pt high, so a hold can be up to 55 pt from the centre.
  _Recommendation: the hold point._ It puts the row at the finger itself. The
  Grip's centre is the fallback for VoiceOver only.
- **D2, the panel's top: the full height, or fitted to the list?**
  (a) Keep `top: PANEL_MARGIN`. The panel is tall, and the header is far above
  a short list, with bare glass between. (b) Fit the panel to its content, up to
  `top: PANEL_MARGIN`. The header sits just above the rows, and a short list is
  a small panel at the finger.
  _Recommendation: (b)._ ADR 0036 D3 makes the list short on purpose, so most
  opens fit. A long list still gets the full height and the automatic scroll.
- **D3, the iPad: the same rule?**
  The iPad's Grip is at 0.75, so the panel above it has ~880 pt, enough for most
  Topics. _Recommendation: yes, one rule for both._ The column has no scrim, so
  with (b) the terminal shows below the panel too.

## Out of scope

- The Grip's place (`gripHeight`) does not change.
- The order of the rows does not change: the attached Session's card stays last.
