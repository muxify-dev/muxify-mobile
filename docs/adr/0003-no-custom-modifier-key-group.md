# No custom modifier-key group in the Dock

The original brief asked for three Dock groups, the first being ctrl/esc/tab —
mirroring `remux`. We dropped it. `expo-libghostty` already ships an Accessory
Bar with esc, tab, ctrl, alt, command, arrows and symbols, including sticky
modifiers (tap arms, double-tap locks), and exposes **no prop to hide or
configure it**. A custom group would therefore sit directly beneath a native bar
showing the same keys.

Reusing the Accessory Bar also keeps key encoding correct: it runs through
ghostty's own `ghostty_key_encoder`, so DECCKM and the kitty keyboard protocol
work without us reimplementing escape sequences.

## Consequences

The Accessory Bar is a *keyboard* accessory — it exists only while the keyboard
is up, whereas remux's group is always visible. **With the keyboard hidden there
is no way to send ctrl-C**, which makes the Dock's keyboard toggle load-bearing.
This is accepted for the probe, and how much it grates is itself a finding.

Note also that `write()` feeds the Surface's display grid and cannot inject
synthetic key events. So if a custom group is ever added, its buttons must
compute bytes themselves (`ctrl+A` → `0x01`) and send them straight to the Shell
Channel, bypassing the Surface — a second input path to keep consistent.

## Superseded in part: the Accessory Bar is now hidden

The premise above — that the library "exposes **no prop to hide or configure
it**" — was true of the published API and not of the view underneath.
`UITerminalView.inputAccessoryView` already returns nil when
`inputAccessoryItems` is empty, and that property is `open` with a `didSet` that
reloads the input views. The local patch exposes it as an `accessoryBar` prop,
and Muxify sets it to `false` at the user's request.

So the reason for this decision is gone. What is left is a choice rather than a
constraint, and the consequences change shape:

- There are now **no modifier keys at all**: no ctrl, esc, tab or arrows, with
  the keyboard up or down. Previously the gap was only ctrl-C while the keyboard
  was hidden.
- The note about key encoding still stands and matters more. A custom group
  cannot borrow ghostty's `ghostty_key_encoder` through the Accessory Bar any
  more, so it would have to compute bytes itself (`ctrl+A` → `0x01`) and write
  them to the Shell Channel, bypassing the Surface — the second input path this
  ADR warned about.

The decision to revisit is therefore whether to build that group, not whether
the bar can be hidden. Left open deliberately: the brief asked for ctrl/esc/tab,
the user has asked for the bar to go "for now", and how much its absence grates
is worth finding out before building a replacement.

## Resolved: the group is built, and tmux does the encoding

The absence grated, and the answer came back as "three groups, the first one
the keys". So the group exists: a Key Bar in its own glass capsule at the left
of the Dock — ctrl, esc, tab, the four arrows, page up and down, alt, home and
end. Three are on screen and the rest are a sideways swipe away, so the bar
costs the Surface nothing as it grows.

**A menu was tried first and was the wrong shape.** It closed on every pick, so
an arrow cost a reopen each time it was pressed, and there is nowhere in a menu
to show a modifier as *held*. Both are the same observation: modifier keys are
a state, and a menu has no state.

**The encoding worry above turned out to be the wrong worry**, and the fix is
the reason this is worth recording. The ADR assumed a custom group would have
to compute bytes itself — `ctrl+A` to `0x01` — because it could no longer borrow
ghostty's `ghostty_key_encoder`. That would have been a real second input path,
and a wrong one: the bytes for a key are not a property of the key. Measured on
tmux 3.6, `Up` into a shell is `ESC [ A` and `Up` into anything that has turned
DECCKM on is `ESC O A`. Computing them here would mean tracking each Pane's
cursor-key mode — a second model of tmux's state, which ADR 0006 declined to
keep.

So nothing is computed. Every key is sent by *name*: `send-keys -t %3 Up`, and
tmux picks the bytes for whatever that Pane is running. It is the same command
typing already uses with a different argument, so there is no second input path.

This holds for the modifiers too, which is the part that is not obvious. ctrl
and alt are **sticky** — a phone keyboard cannot hold one key down while
pressing another — so ctrl is armed with a tap and spent on whatever comes
next, whether that is another bar key (`C-Left`) or a letter typed on the system
keyboard (`C-f`). Both end up as one tmux key name. The system keyboard's bytes
are not transformed; the first key of the batch is replaced by a name and the
rest is typed as it arrived.

One measured hole, recorded because nothing warns about it: `C-Escape` is not a
key tmux knows, and `send-keys` does not refuse it — it types the eight
characters `C-Escape` into the Pane. So Escape is marked as taking no ctrl and
the modifier is dropped for it. Every other key on the bar takes both.

## The Key Row replaces the Key Bar

The Dock is gone, and the Key Row takes the Key Bar's place in three groups:
esc, ctrl, opt and tab at the left; pair keys that scroll in the middle; the
small arrows, Panes, ⌘ and the keyboard key at the right. Page up, page down,
home and end left the row. The decision above does not change. Every key still
goes to tmux by name, and ctrl and opt are still sticky.

Three facts are new:

- **⌘ never reaches tmux.** It arms like ctrl, and the next key is a phone
  Shortcut: c copies, v pastes, k clears.
- **ctrl goes only to symbols that have a control code**: `- _ / | \ ~ [ ] { }`
  and the backtick. Measured on tmux 3.8, `C-:` arrives as `;`, and `C-*`,
  `C-&`, `C-$` and `C-#` are typed as text. So ctrl is dropped for the other
  symbols, as it is for Escape.
- **Clear does not use `send-keys -R`.** Measured on tmux 3.8, `-R` turns
  bracketed paste off for a program that asked for it, and a multi-line paste
  after it runs line by line. Clear sends `C-l`, waits 250 ms, and then runs
  `clear-history`. Without the wait, the lines came back into the Scrollback.

## Three groups in one capsule, and one arrow key

The three groups are now three sections of one glass capsule, split by thin
dividers. Three capsules read as three toolbars, and the gaps between them
cost the pairs width. Only the pairs scroll. Each end of the pairs fades
while there are more pairs past it, so the row shows that it scrolls. The
fade is a mask on the pairs and not a gradient painted over them, because the
glass behind them has no one colour to paint.

The four arrows are now one key that works like a joystick. Four arrows in
the width of one and a half keys were too small to hit, and ▲ did not sit
over ▼. One key frees half a key for the pairs, which now fit three across on
a 393 pt phone. A touch sends nothing. A drag of 12 pt sends the arrow on the
axis the finger moved further along, and a hold repeats it after 400 ms,
about 12 a second. The cost is that the key does not show it is four keys,
and VoiceOver needs an action for each arrow.

The decision above does not change. Each arrow is still a tmux key name from
`ARROW_KEYS`, and an armed ctrl or opt goes with the first arrow of a drag and
not with its repeats.

## The iPad shortcut bar is hidden too

On iPad, iOS shows a second bar over the keyboard: the shortcut bar, with
undo, redo and Paste. It is the first responder's `inputAssistantItem`, not
the library's view, and iOS leaves it out when its button groups are empty.
The local patch exposes this as a `shortcutBar` prop next to `accessoryBar`,
and Muxify sets it to `false`. The patch empties the groups of the terminal
view and of the Selection layer, because both become first responder, and
the bar would come back during a selection.

The bar took about 55 pt over the keyboard for three commands, and the Key
Row sits there now. Paste stays available: in the Selection menu, as ⌘ v from
the Key Row, and as ⌘ v on a hardware keyboard.
