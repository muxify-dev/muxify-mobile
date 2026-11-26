# The Edge Drawer tints the row on screen

## Problem

The Edge Drawer put a checkmark on the active Window and on the active Pane,
from tmux's flags. No screen told it what it showed. So on the Web View the
checkmark was on the terminal's Window and Pane, and never on the Tab that
was on screen. A lift on that Pane row also leaves the page, so the mark
said "here" on a row that goes away from here.

## Decision

Each screen tells the drawer what it shows: the Web View the URL of its Tab,
the Terminal Screen the active Pane (`OnScreen` in `domain/destinations.ts`).
One row at most is the row on screen: the shown Tab of the Window on screen,
else the active Pane when the Panes are listed, else that Window. Gleb chose
each part on the planning page of 26 Nov 2026:

- **D1, the look:** a tinted row, the accent 28 % over a tile
  (`tileHere`), with a bold name. No checkmark. A bar at the leading edge was
  recommended, but it is too like the unread mark of a Pane in Muxify
  desktop. The tint is tried first. The thumb at the right edge covers a
  checkmark there, which is why the checkmark went.
- **D2, a Tab not listed:** no row is marked while the shown Tab is not in
  the list: before the Tabs arrive, after a read fails, or when the Mac
  closed the Tab or moved it to another URL. A mark on the Window would say
  the terminal is on screen.

## Consequences

- On the Terminal Screen, a split Window's row loses its mark: only the
  active Pane has it.
- The tint and the lit row are both fills of the accent. The lit row's fill
  wins while the finger is on the row on screen.
- The drawer writes the row it marks to the log each time it changes while
  it is open, as `the Edge Drawer marks <key> as on screen`. The drawer
  closes at each lift, so the e2e reads the mark there.
