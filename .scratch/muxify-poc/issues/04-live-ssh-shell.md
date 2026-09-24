# 04 — Live SSH shell on the phone

**What to build:** A working remote shell. The app opens a Connection to a
hardcoded Host, opens a Shell Channel, and renders its output in the Surface.
Typing on the phone reaches the remote shell and the response comes back.

This is the ticket the whole probe rests on. If the SSH library and the terminal
library cannot be composed, that is the finding, and it should be reported
rather than worked around.

Bytes must cross in their base64 form in both directions. The Surface's input
event also exposes a decoded-text form; it will corrupt multi-byte characters
that split across network chunk boundaries and must not be used.

**Blocked by:** 03

**Status:** needs-info

> Blocked: this ticket connects to a real Host, and no SSH
> credentials are available to the agent. Needs an address, port, user and
> either a password or a key to proceed — ideally a throwaway box with a
> tmux Session already running.

- [ ] The SSH library is installed at an exact pinned version
- [ ] A Connection authenticates to a hardcoded Host and opens a Shell Channel
- [ ] Shell Channel output renders live in the Surface
- [ ] Keystrokes typed on the device reach the remote shell and echo back
- [ ] Bytes cross as base64 in both directions, never as decoded text
- [ ] Output containing multi-byte characters renders without corruption
- [ ] Leaving the screen closes the Connection cleanly
