# 02 — A Control Connection

**What to build:** one SSH channel running `tmux -C attach -t <session>`, fed
into the parser from 01, exposing `command(text)` that resolves with the reply
lines. Every read Muxify does today on its own exec channel — list sessions,
list windows, read the layout — goes down this one channel instead and returns
the same thing.

**Blocked by:** 01

**Status:** done

Verifiable on its own: point it at the dev Host, ask for the Session list, and
get what the exec-channel path returns today. Nothing renders yet.

Two things the exec path did not have to think about. Commands are serialised —
tmux answers them in order on one stream, so a second command must not be
written until the first has its `%end`. And a command can fail with `%error`
while the channel stays perfectly healthy, which is a rejected promise, not a
dead Connection.

Control mode needs no PTY. Do not request one: that is the whole reason the
Session's options stay untouched.

- [x] `command()` resolves with reply lines and rejects on `%error`
- [x] Concurrent callers are serialised, not interleaved
- [x] The Session list matches what the exec-channel path returns
- [x] `show-options` on the Session afterwards lists nothing Muxify set
- [x] A dropped channel rejects everything outstanding

## Comments

`control-connection.ts`, on a transport seam that now opens a channel with
`term: ''` — the SSH library's way of asking for no PTY.

Two departures from the body above, both because tmux turned out to be more
helpful than assumed.

**Commands are pipelined, not one at a time.** The body says a second command
must not be written until the first has its `%end`. tmux answers in the order it
read them, which is what makes correlation possible at all — so the connection
keeps a queue and hands each reply to the caller at its head. Writing a batch
together is what makes a picker's previews one round trip rather than one per
Pane. `runAll` is that, and a command that fails does not take its neighbours
with it (tested).

**The attach answers first, unprompted.** Every capture shows a `%begin`/`%end`
pair arriving before anything is sent. That is the readiness signal: no command
is written until it lands, and an `%error` there is a Connection that never
opened rather than a command that failed. Without this the first command sent
would eat the attach's reply and put every later one out of step.

`show-options` was measured after attaching and after `refresh-client -C`: only
`default-size`, which `new-session -x/-y` had set. Nothing of ours.
