# 01 — Three Dock groups, and a Meta menu

**Status:** done

**What to build:** the Dock in three glass capsules — Meta, the pickers, and
Home/Keyboard — with the buttons a little tighter, and the Meta button opening
a menu of the keys a phone keyboard does not have.

- [x] Three groups, each its own capsule
- [x] Buttons sit closer together
- [x] Meta opens a native menu: esc, tab, enter, arrows, Control, Option, Move
- [x] A key pressed there reaches the Pane that has the keyboard
- [x] The bytes are right for what the Pane is running

## Comments

**tmux does the encoding, and that is the whole design.** ADR 0003 warned that a
custom key group would have to compute bytes itself — `ctrl+A` → `0x01` — and
that this would be a second input path to keep consistent. It would also have
been wrong: the bytes for a key are not a property of the key. Measured on tmux
3.6, `Up` into a shell is `ESC [ A` and `Up` into anything that has turned
DECCKM on is `ESC O A`. So the menu sends the *name* and `send-keys -t %3 Up`
lets tmux pick. Same command typing already uses, different argument.

**One queue, two kinds of thing.** A named key cannot be merged into the
`send-keys -H` batch that typed bytes coalesce into, so sending it straight out
would put an arrow pressed mid-burst *before* the letters typed ahead of it.
Typed bytes and named keys now share one outgoing queue.

**The menu is the system's own.** A SwiftUI `Menu`, so the panel is glass,
placed by iOS and dismissed like every other menu on the phone. Nothing here
draws it. A `ControlGroup` inside it lays its children out side by side, which
is how the arrows take one line rather than four — but iOS wraps after three, so
the arrows go two and two.

**Automation cannot press a menu row.** The items are in the accessibility tree
with the right labels, but every one of them reports the same frame, so
`agent-device press` taps the panel rather than the row it asked for. Verified
instead against a real tmux in `e2e/control-mode.test.ts`: every key pressed in
turn into a `cat -v`, which prints back exactly what arrived, and `C-c` ending
it. That is a better test than the device one would have been.

**The regressions suite had to be narrowed.** Check 2 caught the library's
Accessory Bar coming back by looking for `[button] "Control"`, `"Escape"`,
`"Tab"`, `"Command"` or `"Option"`. Three of those are now the Meta menu's own,
so the check reads `Escape` and `Command` only — the bar's full-word spelling
and the one key Muxify has no use for.
