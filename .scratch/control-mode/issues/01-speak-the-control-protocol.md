# 01 — Speak the control protocol

**What to build:** a pure module that turns a stream of control-mode bytes into
events, and back. Nothing connects, nothing renders — but a recorded transcript
from a real `tmux -C attach` goes in and the right events come out, which is
what every later ticket stands on.

**Blocked by:** None — can start immediately.

**Status:** done

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

- [x] A fixture transcript from a real tmux drives the tests
- [x] Command replies are correlated by id, including `%error`
- [x] `%output` decodes to exact bytes, backslash and high bytes included
- [x] A line split across two reads is handled, and so is an unknown notification
- [x] Nothing in the module imports SSH, React, or anything native

## Comments

Two fixtures, both captured from tmux 3.7c on a throwaway socket:
`__fixtures__/control-session.txt` is a Session's life — attach, list, a failed
command, splits, renames, a Session switch, detach — and
`__fixtures__/control-all-bytes.txt` is all 256 byte values written out of a
Pane and read back.

The escaping rule in the body above is wrong, and the fixture is why we know.
tmux escapes bytes **below 0x20** and backslash, as three octal digits; it does
*not* escape anything above 0x7f. `printf` of `\xff\x80` came back as those
bytes, raw. Measured inflation is 1.26x, close enough to ADR 0006's 1.29x.

One thing the prose would not have given: a reply line may begin with `%`. A
`capture-pane` of a zsh prompt does. So only a `%end`/`%error` carrying the
open command's own id closes a block.
