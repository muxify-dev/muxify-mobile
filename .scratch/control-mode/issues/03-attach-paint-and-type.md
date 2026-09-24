# 03 — Attach: paint and type

**What to build:** the cutover. Opening a Session no longer runs `tmux attach`
on a PTY. It resyncs the current Pane onto the Surface, then streams `%output`
into it, and typing goes back through `send-keys`. A Session looks and behaves
as it does today, and the laptop watching the same Session keeps its status
line.

**Blocked by:** 02

**Status:** ready-for-agent

`%output` only carries what happens *next*, so the screen already there has to
be reconstructed first: `capture-pane -pe -N` for the content, with
`#{cursor_x}`, `#{cursor_y}` and `#{alternate_on}` to put the cursor back.
Write that to the Surface before the first streamed byte, and hold streamed
output until it lands or the first frames arrive out of order.

Input is `send-keys -t %pane -H <hex bytes>`, which carries arbitrary bytes and
needs no PTY. Batch a burst into one command rather than one per keystroke.

Switching Window or Pane is now a resync, not a redraw: the same capture-then-
stream path, pointed somewhere else.

- [ ] Attaching shows the Pane as it already is, not an empty screen
- [ ] Typing reaches the Pane, control bytes and UTF-8 alike
- [ ] A laptop attached to the same Session keeps its status line throughout
- [ ] Switching Window and Pane repaints from the new Pane
- [ ] Force-quitting the app leaves the Session exactly as it was found
