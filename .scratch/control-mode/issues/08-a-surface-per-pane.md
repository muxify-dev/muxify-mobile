# 08 — A Surface per Pane

**What to build:** a Window with two Panes shows two Panes, each live, laid out
where tmux says they are. Tapping one makes it the Pane that takes the keyboard.

**Blocked by:** 03, 04

**Status:** not scheduled — wanted on iPad, not needed on a phone

This is not part of the migration and nothing above depends on it. It is written
down because control mode is what makes it possible, and because a phone-shaped
decision should not quietly become an iPad-shaped limitation.

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

- [ ] A two-Pane Window renders both Panes at their Layout rectangles
- [ ] Output lands in the right Pane, and resizing keeps the rectangles honest
- [ ] Tapping a Pane moves the keyboard to it, and tmux agrees which is active
- [ ] Four Panes on an iPad hold a usable frame rate, or the ceiling is recorded
