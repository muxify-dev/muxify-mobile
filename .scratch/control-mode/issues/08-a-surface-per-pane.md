# 08 — A Surface per Pane

**What to build:** a Window with two Panes shows two Panes, each live, laid out
where tmux says they are. Tapping one makes it the Pane that takes the keyboard.

**Blocked by:** 03, 04

**Status:** done — picked up on a phone after all, on request

This was not part of the migration and nothing above depended on it. It was
written down because control mode is what makes it possible, and because a
phone-shaped decision should not quietly become an iPad-shaped limitation —
which is exactly how it came to be picked up.

Verified on the simulator while writing ADR 0006: two `TerminalView`s mount and
render at once, each with its own grid, cursor and palette, against the one
shared `ghostty_app_t`. Nothing native is in the way.

The shape is the one remux ships as `GhosttyCompositeViewportView` — "hosts
every visible pane in the active tmux window at its authoritative grid rectangle
using one shared, unscaled cell metric". The Layout string already parsed by
`layout.ts` gives each Pane a cell rect; one cell metric, shared because the
font is app-wide on the shared controller, turns that into points. Each Pane
gets the `%output` for its own id, which control mode delivers separately —
this is the thing an attached client cannot give, since its byte stream is one
composited Window.

Three things to settle when it is picked up:

- **Zoom.** Muxify attaches zoomed because a phone is too narrow for two Panes.
  On an iPad the default should probably invert, which makes zoom a real
  setting rather than a constant.
- **Cost.** N Panes is N renderers. Two is proven; four is not measured.
- **Focus.** Only the active Pane takes input, and `send-keys` already targets
  a Pane by id, so this is a tap target and a highlight, not a new input path.

- [x] A two-Pane Window renders both Panes at their Layout rectangles
- [x] Output lands in the right Pane, and resizing keeps the rectangles honest
- [x] Tapping a Pane moves the keyboard to it, and tmux agrees which is active
- [~] Four Panes on an iPad hold a usable frame rate, or the ceiling is recorded

## Comments

Four Panes were driven on an iPhone 17 Pro, each live, each painting its own
resync and streaming its own `%output`. No frame rate was measured, so the
ceiling above four is still unrecorded — hence the `~`.

**Zoom is tmux's, not Muxify's.** What is on screen follows
`#{window_zoomed_flag}`, and the setting only says what a Session should arrive
as and what the switch asks for. Reading the Window's own flag is what makes an
unzoom from the laptop show the split here. It arrives in `%layout-change`'s
flags, which is the only place it arrives at all: the Layout describes the
arrangement zoom is *hiding*, so the rectangles are identical either way.

**The separator cell is shared, not left empty.** tmux keeps one cell between
neighbours for a separator it would draw for a client that renders one. Leaving
it showed a strip of ground between the Panes. Each neighbour takes half, which
closes the seam and leaves both Surfaces a whisker under their own cell count —
taking the whole cell would round them a column *wider* than the Pane, and then
nothing would wrap where tmux wrapped it.

**One cursor.** Every Surface draws its own, so a split showed one per Pane —
several places to type, only one of them real. A view is told whether it is the
Pane with the keyboard, and remembers it, so a repaint does not bring it back.

A cursor that is not drawn is still *somewhere*, and that is the half this
missed at first. A repaint of an unattended Pane left the cursor wherever the
last blank row was painted, so the Pane tapped next showed its cursor in the
bottom-left corner instead of on its prompt. Where it is and whether it is drawn
are now two separate questions — see `ScreenPaint.cursorVisible`.

**One line between the Panes, and none anywhere else.** A rectangle drawn per
Pane gave a rule along the bottom of the Window and another along the top,
neither of which divides anything, and every seam doubled because both sides
drew their own. A Pane that does not start at the Window's edge has a neighbour
there, so that is where the line goes and the Pane on the far side draws
nothing. It falls in the separator cell the two share half each.

**A tap moves the active Pane here first, then asks.** A `select-pane` is a
round trip and `%window-pane-changed` arrives after it; a cursor that waits for
either lands a beat after the finger. `TopologyStore.activate` makes the move,
the notification agrees with it, and a refusal from the Host throws the guess
away. The same call is what keeps the Panes sheet right, since its rows are
drawn from the Topology.

**The mouse layer covers the active Pane, not the screen.** While something is
listening for the mouse the finger belongs to it — but a layer over the whole
container sent a tap on the *other* half of a split into the application in this
one, so the only way to change Panes while Claude Code was running was the
sheet.

Three things that cost real time and are worth knowing:

- A Surface that has just mounted **reports its grid before it will accept
  anything written to it**. The resync ran, the bytes went out, and the Pane
  stayed blank — while the Surface the split grew out of painted perfectly.
  PAINT_SETTLE_MS is the wait, and it is measured rather than cautious.
- A ref callback written inline is a **new callback every render**, so React
  unregisters and re-registers the Surface constantly. A resync finishing
  during one of those gaps wrote to nothing.
- Pane *edges* are rounded, not widths. A Pane a third of a point short of 24
  cells is a Pane of 23, and then every line tmux wrote for 24 wraps.

What the proportions are is tmux's business: the Panes are drawn at the
rectangles the Layout gives them, so a Window whose splits are uneven in tmux
is uneven here. `select-layout tiled` is what evens it.
