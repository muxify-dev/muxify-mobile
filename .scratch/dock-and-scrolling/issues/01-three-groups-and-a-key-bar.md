# 01 — Three Dock groups, and a Key Bar

**Status:** done

**What to build:** the Dock in three glass capsules — the keys, the pickers,
and Home/Keyboard — with the buttons a little tighter, and the first capsule
holding the keys a phone keyboard does not have.

- [x] Three capsules
- [x] Buttons sit closer together
- [x] A bar of keys: ctrl, esc, tab, arrows, page up/down, alt, home, end
- [x] Three on screen, the rest a sideways swipe away
- [x] ctrl and alt are sticky, and show as held
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

## Comments — the menu was wrong, and the bar replaced it

Built as a `Menu` first, on the reading that "a button that opens something"
meant a dropdown. It was the wrong shape twice over, and both faults are the
same observation: **modifier keys are a state, and a menu has no state.** A menu
closes on every pick, so an arrow cost a reopen each time; and there is nowhere
in a menu to show ctrl as *held*.

So the capsule is a scrolling row instead, and ctrl and alt are sticky: armed by
a tap, spent on whatever comes next. That is the one thing a phone keyboard
cannot do on its own — hold a key down while another is pressed.

**The system keyboard goes through the same path.** With ctrl armed, typing `f`
does not send `0x06`; the first key of the batch is replaced by the name `C-f`
and the rest is typed as it arrived. Only the first, because a modifier is spent
on one key and the Surface batches — a fast typist's ctrl-r arrives with the
search term already behind it.

**One measured hole.** `C-Escape` is not a key tmux knows, and `send-keys` does
not refuse it: it types the eight characters `C-Escape` into the Pane. Found by
running every key on the bar against `C-`, `M-` and `C-M-` on tmux 3.6 and
reading back what a `cat -v` printed. Escape is marked as taking no ctrl; every
other combination on the bar is real, including `M-Escape`.

**This capsule is React Native, and the rest of the Dock is SwiftUI.** Two
things it has to do have no equivalent reachable through `@expo/ui`: scrolling
sideways inside a capsule three keys wide, and drawing the disc behind a held
modifier. It sits on a `GlassView` so it is the same glass as its neighbours.

**Automation can press what is on screen and nothing else.** The off-screen keys
report their content position rather than a clipped one, so pressing one by
label taps wherever that lands — which is how a press on `left` opened the
Sessions sheet. Verified by swiping the bar first and re-reading the positions:
it scrolls a whole key at a time, and Left, Down and Up arrive as
`ESC [ D`, `ESC [ B` and `ESC [ A`.

## Comments — making it sit right

Three separate faults, all found by measuring rather than by looking, because
the accessibility tree said everything was already fine.

**The Dock had no bottom safe-area inset at all.** It sat 8pt off the screen
edge with a 34pt home indicator underneath it. That predates the Key Bar; the
bar only made it obvious. It clears the indicator now, and only when there is
one to clear — with the keyboard up the indicator is behind it, so the Dock
keeps its old gap and sits on the keyboard as before. The Surface pays for it:
one row shorter, 49x40 instead of 49x41 on an iPhone 17 Pro.

**A SwiftUI glass capsule paints about three points above the box it reports.**
Found by reading the painted edges out of a screenshot and comparing them with
the frames the tree reports — the tree had all three capsules at identical
rects while they were visibly out of line. The Key Bar is React Native and
paints exactly on its box, so it is lifted to match, and the Dock's clearance
is measured from where the glass lands rather than where it claims to be.

Two ways of getting that wrong, both worth remembering. The wrapper around the
bar defaulted to a **column**, so the capsule read its `flex` as a height and
shrank to three quarters of its own. And with the row **centred**, lifting the
bar made the row taller, which pushed the other capsules down by half as much
again — the two chased each other a point at a time until the row was
bottom-aligned instead.

**The keys are sized from the capsule, not the other way round.** A fixed key
width leaves a remainder of whatever the other Dock groups happen not to use,
and the remainder shows as a sliver of the fourth key on one side and nothing
on the other — a row that is not centred, differently on every phone. The
capsule takes the width it is given and divides it by three, so the gap at each
end is the same by construction: measured at 4.00pt and 4.00pt.
