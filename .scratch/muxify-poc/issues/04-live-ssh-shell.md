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

**Status:** ready-for-agent

- [x] The SSH library is installed at an exact pinned version
- [x] A Connection authenticates to a hardcoded Host and opens a Shell Channel
- [x] Shell Channel output renders live in the Surface
- [x] Keystrokes typed on the device reach the remote shell and echo back
- [x] Bytes cross as base64 in both directions, never as decoded text
- [x] Output containing multi-byte characters renders without corruption
- [x] Leaving the screen closes the Connection cleanly
