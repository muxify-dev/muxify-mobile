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
