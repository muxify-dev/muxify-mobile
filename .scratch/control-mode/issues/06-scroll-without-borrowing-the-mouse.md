# 06 — Scroll without borrowing the mouse

**What to build:** dragging scrolls back through history as it does today,
without setting `mouse on`, and a full-screen application like Claude Code still
scrolls itself.

**Blocked by:** 03

**Status:** done

Two cases, and the split is the same one tmux's own wheel binding makes. On the
alternate screen (`#{alternate_on}`), wheel bytes go in as ordinary input via
`send-keys` and the application scrolls itself — no tmux routing, so nothing has
to be enabled for it. On the normal screen, history comes from `capture-pane`
over a range of the scrollback and is painted onto the Surface; tmux's copy-mode
is not involved at all.

`mouse-wheel.ts` already builds the SGR bytes and knows what a notch is worth.
The `readScrollState` / `stopScrolling` copy-mode machinery goes.

- [x] A drag scrolls a shell's history, and reaches the bottom cleanly
- [x] A drag scrolls Claude Code, vim and less
- [x] The keyboard still only rises on a tap, never on a drag
- [x] `mouse` is never set, and the Session's own value is irrelevant

## Comments

In `pane-view.ts`. `readScrollState` and `stopScrolling` are gone, and so is
every trace of copy-mode.

Three routes, not two, and the third is why: on the alternate screen an
application that asked for the mouse gets SGR wheel bytes, and one that did not
gets cursor keys — `less` and `man` read nothing else, and tmux 3.6 dropped the
`alternate-scroll` option that used to do that translation. `#{mouse_any_flag}`
is what tells them apart, read with the rest of the Pane's state.

On the normal screen the Surface is painted from `capture-pane -S -back -E ...`,
with the cursor hidden — a cursor parked in the middle of old output reads as a
prompt that is not there. Live output is dropped while scrolled rather than
written: the Surface is showing the past and tmux is holding the present, so
jumping back to the bottom is a resync.

Repaints are latest-wins with the round trip as the debounce, so a flick paints
where it ended rather than everywhere it passed.
