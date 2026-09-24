# 03 — Attach: paint and type

**What to build:** the cutover. Opening a Session no longer runs `tmux attach`
on a PTY. It resyncs the current Pane onto the Surface, then streams `%output`
into it, and typing goes back through `send-keys`. A Session looks and behaves
as it does today, and the laptop watching the same Session keeps its status
line.

**Blocked by:** 02

**Status:** done, bar the zoom flag — see Comments

`%output` only carries what happens *next*, so the screen already there has to
be reconstructed first: `capture-pane -pe -N` for the content, with
`#{cursor_x}`, `#{cursor_y}` and `#{alternate_on}` to put the cursor back.
Write that to the Surface before the first streamed byte, and hold streamed
output until it lands or the first frames arrive out of order.

Input is `send-keys -t %pane -H <hex bytes>`, which carries arbitrary bytes and
needs no PTY. Batch a burst into one command rather than one per keystroke.

Switching Window or Pane is now a resync, not a redraw: the same capture-then-
stream path, pointed somewhere else.

- [x] Attaching shows the Pane as it already is, not an empty screen
- [x] Typing reaches the Pane, control bytes and UTF-8 alike
- [x] A laptop attached to the same Session keeps its status line throughout
- [x] Switching Window and Pane repaints from the new Pane
- [~] Force-quitting the app leaves the Session exactly as it was found

## Comments

Split into two modules rather than living in `terminal.tsx`: `pane-screen.ts`
builds the bytes that put a captured screen on the Surface, and `pane-view.ts`
owns what the Surface is showing for one Pane — the resync, the stream after
it, typing, and dragging.

The holding is real and tested: output arriving while the capture is in flight
is buffered and written *after* the repaint, in order. Writing it as it arrives
would put the last second of a Pane's life underneath its own repaint.

The repaint enters or leaves the alternate screen to match the Pane, rather than
only entering it — otherwise moving from vim to a shell leaves the Surface on a
screen the Pane is not on.

Typing batches by round trip, not by timer: the first keystroke goes at once and
everything typed while it is in flight follows as one `send-keys`. Same idea as
the resize scheduler, and for the same reason — a slow Host coalesces harder.

**Not quite met, and named rather than hidden: zoom.** Attaching still runs
`resize-pane -Z`, because a phone is too narrow for two Panes side by side (see
CONTEXT.md, **Zoom**). That is a Window flag, not a Session option — nothing in
`show-options` moves and there is no hook — but every other Client sees it and
it outlives the Connection, so "exactly as it was found" is false by that one
flag. It was true of the attached-client design too; this ticket's wording is
what is new.

Left as it is rather than restored on detach, because the user can turn it off
in the Panes picker and undoing their choice on the way out would be its own
surprise. `e2e/regressions.sh` check 7 now prints the flag so it is visible, and
so that anything *else* appearing there is a regression. Worth a decision:
un-zoom on teardown, or amend the ticket.
