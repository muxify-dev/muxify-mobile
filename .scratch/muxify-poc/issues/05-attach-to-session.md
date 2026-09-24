# 05 — Attach to a Session, correctly sized

**What to build:** The Shell Channel runs tmux's attach command against a
hardcoded Session name instead of a plain login shell, so opening the app drops
straight into work that was already running. Resizing the Surface — rotating the
device, or showing and hiding the keyboard — resizes the remote terminal to
match, so full-screen programs draw at the right dimensions.

Muxify only ever attaches. It does not create, rename or kill a Session.

**Blocked by:** 04

**Status:** done, bar one criterion

- [x] The Shell Channel attaches to an existing Session by name
- [x] The attached Session renders correctly, including colour and cursor position
- [x] Surface resize events resize the remote terminal
- [x] A full-screen program such as an editor draws at the correct size
- [ ] Rotating the device and toggling the keyboard both reflow the remote terminal (blocked: app is orientation-locked to portrait and the iOS keyboard overlays rather than resizes the Surface — see findings.md)
- [x] Detaching and re-attaching returns to the same Session state

**Notes:** `top` was run in the attached Session and drew correctly at 38x32 —
header, inverse-video column row, process list, no wrapping — which closes the
full-screen criterion.

Keyboard reflow is now proven in both directions (`e2e/regressions.sh` asserts
the Surface and the tmux Window agree with the keyboard up and down, and that
no padding reaches the screen). Rotation stays unticked: the app is locked to
portrait, so there is nothing to rotate, and unlocking it is a change this
probe did not need.
