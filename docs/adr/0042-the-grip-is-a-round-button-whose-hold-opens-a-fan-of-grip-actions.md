# The Grip is a round button whose hold opens a Fan of Grip actions

## Problem

The Grip was a glass line, 6 × 48 points, at the right edge, and its hold
opened one thing: the Edge Drawer (ADR 0036). The thumb reached nothing else
there. Compose and Options sat in the Header, far from the thumb. A line does
not say that it holds more than one thing.

Gleb asked for a round, clear Liquid Glass button with several operations:
drag from the button to a drawer icon, and the drawer then works as today.
ADR 0036 records that a round button was once too visible, and went back to a
line. This change keeps the line's place, and the button is small and
quiet at rest.

## Decision

The Grip is a round button, and a hold on it opens the Fan: four Grip
actions round the button. Gleb chose each part on the planning page of
27 Nov 2026. He took the recommendation for all nine.

- **D1, the look:** a circle drawn 36 points wide, with its centre 22 points
  from the right edge, at the height of the old line: the middle of a phone,
  three quarters down an iPad. It sits low enough that the Fan's highest slot
  is inside the screen's area. The touch is a square of 44 points round it
  (React Native cannot test a touch against a circle). It replaces the band of
  28 × 110 points.
- **D9, how transparent it is at rest:** two hairline rings, a light one
  inside a dark one, and no glass, so the content under it is as it is and the
  ring shows on the terminal and on a white page. At the touch the glass
  animates to the clear style and the button fills with the accent colour
  over the hold. When the Fan opens it glows. With no glass API it is the
  rings and the fill.
- **D2, the layout:** a quarter fan. Four slots, drawn as 40 point circles of
  clear glass, 100 points from the button's centre, at 12, 11, 10 and 9
  o'clock. The finger picks a slot by direction once it is more than 44
  points from the centre, and the nearest slot wins. It lights nothing below
  the horizontal line, nor right of vertical by more than half a step (15
  degrees). The lit slot shows its name, and each change to a slot gives a
  light tick.
- **D3, the hold:** 250 ms, in place of the 400 ms of ADR 0036 D5. The drift
  allowance stays 20 points. A hold and a slide to the drawer take about as
  long as the old hold alone (an estimate on the planning page, not a measure).
- **D4, the handoff:** the 12 o'clock slot is always Destinations, which opens
  the Edge Drawer. The moment it lights, the Fan closes and the drawer opens
  under the finger, with no wait. From there the held-drawer flow of ADR 0036
  runs as it did: light rows, the Cancel Zone, the Lift Lane, the automatic
  scroll. A slide down past the drawer's panel closes the drawer and opens
  the Fan again, with nothing lit (amended 28 Nov 2026, after use: Gleb
  asked for a way back to the other actions). Destinations does not light
  again until the finger points at another slot or comes back to the dead
  centre, so the drawer does not open again under a finger on its way down.
  The Cancel Zone is no longer tinted red, and the area below the panel is
  not part of it. A lift on another lit slot
  runs that Grip action. A lift in the dead centre, on a slot that is dimmed,
  or on no slot runs nothing. Each lift closes the Fan, and so does a touch
  that the system takes, with nothing run.
- **D5, the other three slots:** Settings chooses them as it does the Key Row
  quick actions. The catalog has Go to, Compose, Options, Keyboard, Title
  Sheet, Host Screen, Split right, Split down, New Window, Zoom Pane, Paste and
  Copy Pane text. An empty slot stays empty, an action cannot sit in two
  slots, and the defaults are Go to, Compose and Options. A screen that cannot
  run an action draws its slot dimmed. The slots never move between screens.
- **D6, a tap:** it does nothing. Each Grip action is a hold, a slide and a
  lift.
- **D7, the Pane Swipe:** a move of 20 points before the hold ends is a drag,
  and on the Terminal Screen a sideways drag is the Pane Swipe, as before.
- **D8, a phone on its side:** it has no Grip.

The rest is the design of this change.

- **The anchor of the drawer is the point where the finger lit Destinations.**
  ADR 0037 D1 said the point where the finger held the Grip. The finger is now
  about 44 points above the button, so the rule that the last row is level
  with the finger would put the panel below it. The rule is the same, and only
  the anchor moves. VoiceOver has no finger and still uses the Grip's centre.
- **The Terminal Screen runs most Grip actions from its Options table.** A lift
  on Compose, Keyboard, Zoom Pane, New Window, Split or Copy Pane text does
  what the same item of the ⋯ menu does, and the slot is dimmed while that item
  is disabled. Compose says "Close composer" while the Composer is open.
- **The Web View runs Go to, the Title Sheet and the Host Screen.** It has no
  Pane, no Composer and no Options table, so the rest of its slots are dimmed.
- **Options opens a sheet, not the ⋯ menu.** The header's ⋯ is a native
  `Stack.Toolbar.Menu`, which is a UIKit bar button with a menu. Expo Router
  gives it no ref and no call to open it, and UIKit has no public call to
  present the menu of a bar button. So the Options action shows the same
  `OptionsItem` table in a sheet, with the same groups and submenus, through
  one function that groups the table for both. A verb added to the table shows
  in both. The sheet counts as a sheet: the Grip is off while it is open, and
  it holds the keyboard away from the Pane. The entry that the user picks runs
  once the sheet has gone, so an Alert or the keyboard does not fight the
  dismissal.
- **The Fan holds input while it is open,** as the drawer does (ADR 0039). A
  clear layer under it takes every other touch, on a phone as well as on an
  iPad. A Selection or a sheet that opens under the Fan closes it.
- **A slot that is dimmed still lights and ticks,** and its name shows
  dimmed. A lift on it runs nothing.
- **VoiceOver:** the label is "Grip actions". Activate opens the Edge Drawer at
  once, and the drawer stays open, as before. Each other Grip action that the
  screen can run is a custom action.

## Consequences

- Replaced parts of ADR 0036: "A Grip at the right edge opens the Edge
  Drawer" (it opens the Fan, and the drawer is its Destinations action), D5
  (the hold), the look of the Grip in D2, and two consequences (the band, and
  the tap in the band). The rest of ADR 0036 stays: the drawer, the pick, the
  scope, the Tabs and the old switchers. ADR 0037 D1 is amended, and its other
  parts stay. ADR 0038 stays.
- The touch is a square of 44 points, so a corner of it is a dead spot for the
  Surface and for a page, as the old band was. It is smaller than the band.
- A page in the Web View does not scroll from the button's square. A tap on it
  does nothing, and does not raise the keyboard.
- The slide to the drawer is one more move than the old hold. The Fan's
  highest slot needs 120 points above the button, so the Grip's centre cannot
  be nearer the top of its area than that.
- A trackpad click on the button does not open the Fan at once, as for the
  drawer. A pointer press is a touch to React Native, so it must be held.
- agent-device draws straight lines only, and the slide to a row bends: up to
  Destinations, then left. `e2e/edge-drawer.sh` slides along one line from the
  button's lower right corner that crosses the dead centre just left of
  straight up, where Destinations lights, and goes on to the row. That line
  reaches only rows that are high enough above the finger, so the suite adds
  Windows below the rest. The bend itself is tried on a device.
