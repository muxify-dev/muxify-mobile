# 05 — Attach to a Session, correctly sized

**What to build:** The Shell Channel runs tmux's attach command against a
hardcoded Session name instead of a plain login shell, so opening the app drops
straight into work that was already running. Resizing the Surface — rotating the
device, or showing and hiding the keyboard — resizes the remote terminal to
match, so full-screen programs draw at the right dimensions.

Muxify only ever attaches. It does not create, rename or kill a Session.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The Shell Channel attaches to an existing Session by name
- [ ] The attached Session renders correctly, including colour and cursor position
- [ ] Surface resize events resize the remote terminal
- [ ] A full-screen program such as an editor draws at the correct size
- [ ] Rotating the device and toggling the keyboard both reflow the remote terminal
- [ ] Detaching and re-attaching returns to the same Session state
