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

## Resolved: the group is built, as a menu, and tmux does the encoding

The absence grated, and the answer came back as "three groups, the first one
Meta". So the group exists: one Dock capsule holding a single button that opens
a SwiftUI `Menu` — esc, tab and enter, the four arrows, and submenus for
Control, Option and Move.

The encoding worry above turned out to be the wrong worry, and the fix is the
reason this is worth recording. The ADR assumed a custom group would have to
**compute bytes itself** — `ctrl+A` → `0x01` — because it could no longer
borrow ghostty's `ghostty_key_encoder`. That would have been a real second
input path, and a wrong one: the bytes for a key are not a property of the key.
Measured on tmux 3.6, Up into a shell is `ESC [ A` and Up into anything that
has turned DECCKM on is `ESC O A`. Computing them here would mean tracking each
Pane's cursor-key mode — a second model of tmux's state, which ADR 0006
declined to keep.

So nothing is computed. The menu sends tmux the *name* of the key, and
`send-keys -t %3 Up` lets tmux pick the bytes for whatever that Pane is
currently running. It is the same path typing already takes, the same command
with a different argument, and the Pane's mode is tmux's business rather than
this app's. There is no second input path.

What is genuinely new is the cost of the menu shape: a menu closes when you
pick something, so a key that wants repeating — an arrow, mostly — costs a
reopen each time. That is the trade for having the keys at all without a
permanent second row eating the Surface. If repeating turns out to grate the
way the absence did, the answer is a row that stays up, not a different menu.
