# 02 — A Control Connection

**What to build:** one SSH channel running `tmux -C attach -t <session>`, fed
into the parser from 01, exposing `command(text)` that resolves with the reply
lines. Every read Muxify does today on its own exec channel — list sessions,
list windows, read the layout — goes down this one channel instead and returns
the same thing.

**Blocked by:** 01

**Status:** ready-for-agent

Verifiable on its own: point it at the dev Host, ask for the Session list, and
get what the exec-channel path returns today. Nothing renders yet.

Two things the exec path did not have to think about. Commands are serialised —
tmux answers them in order on one stream, so a second command must not be
written until the first has its `%end`. And a command can fail with `%error`
while the channel stays perfectly healthy, which is a rejected promise, not a
dead Connection.

Control mode needs no PTY. Do not request one: that is the whole reason the
Session's options stay untouched.

- [ ] `command()` resolves with reply lines and rejects on `%error`
- [ ] Concurrent callers are serialised, not interleaved
- [ ] The Session list matches what the exec-channel path returns
- [ ] `show-options` on the Session afterwards lists nothing Muxify set
- [ ] A dropped channel rejects everything outstanding
