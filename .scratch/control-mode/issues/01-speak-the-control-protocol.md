# 01 — Speak the control protocol

**What to build:** a pure module that turns a stream of control-mode bytes into
events, and back. Nothing connects, nothing renders — but a recorded transcript
from a real `tmux -C attach` goes in and the right events come out, which is
what every later ticket stands on.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Events to recognise: `%begin`/`%end`/`%error` (correlated by the id pair, so a
command's reply can be awaited), `%output %pane <escaped>`, `%layout-change`,
`%session-changed`, `%window-add`, `%window-close`, `%window-renamed`,
`%window-pane-changed`, `%unlinked-window-*`, `%exit`, `%client-detached`.
Unknown `%notifications` must be ignored rather than throw — tmux adds them.

tmux octal-escapes backslash and every byte outside printable ASCII in
`%output`. Measured: 1.29x inflation, 571 MB/s to un-escape with a
`charCodeAt` loop on V8. Decode to bytes, never to a JS string — the payload is
not UTF-8 and must not be round-tripped through one.

Capture a transcript with `tmux -C attach` against a throwaway Session and keep
it as a fixture; guessing at this protocol from prose is how it goes subtly
wrong.

- [ ] A fixture transcript from a real tmux drives the tests
- [ ] Command replies are correlated by id, including `%error`
- [ ] `%output` decodes to exact bytes, backslash and high bytes included
- [ ] A line split across two reads is handled, and so is an unknown notification
- [ ] Nothing in the module imports SSH, React, or anything native
