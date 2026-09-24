# 06 — Scroll without borrowing the mouse

**What to build:** dragging scrolls back through history as it does today,
without setting `mouse on`, and a full-screen application like Claude Code still
scrolls itself.

**Blocked by:** 03

**Status:** ready-for-agent

Two cases, and the split is the same one tmux's own wheel binding makes. On the
alternate screen (`#{alternate_on}`), wheel bytes go in as ordinary input via
`send-keys` and the application scrolls itself — no tmux routing, so nothing has
to be enabled for it. On the normal screen, history comes from `capture-pane`
over a range of the scrollback and is painted onto the Surface; tmux's copy-mode
is not involved at all.

`mouse-wheel.ts` already builds the SGR bytes and knows what a notch is worth.
The `readScrollState` / `stopScrolling` copy-mode machinery goes.

- [ ] A drag scrolls a shell's history, and reaches the bottom cleanly
- [ ] A drag scrolls Claude Code, vim and less
- [ ] The keyboard still only rises on a tap, never on a drag
- [ ] `mouse` is never set, and the Session's own value is irrelevant
