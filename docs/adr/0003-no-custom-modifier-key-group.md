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
