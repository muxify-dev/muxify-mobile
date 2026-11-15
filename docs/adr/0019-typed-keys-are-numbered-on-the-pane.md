# Typed keys are numbered, and the Pane keeps the number

A key typed into a Pane used to be removed from its queue before tmux answered,
and the queue belonged to a Pane view that each reconnect makes again. A key
typed just before or during a break was lost without a sign. The opposite
mistake is worse: a key sent again after a break that had arrived the first
time is typed twice, and that key can be Enter.

The Attach now owns an Outbox that outlives each Connection. Each key, or run
of typed text, goes to tmux as one Batch with a number from one count that only
grows. The same line that types the Batch writes that number to a user option
of the Pane, `@muxify-in-<token>`, and reads it back with the server's pid, the
Pane's pid and its program. A Batch leaves the Outbox only when a reply shows
its number on the Pane.

## What this costs ADR 0006

ADR 0006 says Muxify sets no Session option, and that stays true. This is a
user option of a Pane. tmux and other clients do not read it, it changes no
behaviour, and it ends with the Pane. The token is new for each Attach, so two
phones, or two runs of the app, do not overwrite each other's number. One
option stays on each Pane that was typed into, for each Attach, until the Pane
ends.

## tmux refuses the copy, not only the app

After a reconnect the Outbox reads the number before it sends anything, and
does not send a Batch that the Pane has. That check is not enough: a line that
the dead Connection wrote can reach tmux after the read. So the line is
`if-shell -F '#{e|<:…}'`, and tmux types the key only while the Pane's number
is below the Batch's. The compare needs tmux 3.2. An older tmux gets the line
without the guard, and the Log says so.

A reply count cannot mark the end of that line. Measured on tmux 3.8, the line
gives four reply blocks when it types, two when it is a copy, and three when
the key fails, and an error inside `if-shell` does not stop the rest of the
line. The Control Connection writes a second line that prints a marker, and
takes every block before the marker as the reply.

## What is sent again without a question

Only what cannot do harm twice in a new context: printable text and plain
arrows, typed less than 30 seconds ago, for the same Pane that runs the same
program. Enter, control keys and all other keys are held, and the user sends
them, moves their text to the Composer, or discards them. Keys for a Pane that
is gone, or on a server that started again, are discarded with a notice. Bytes
that a scroll or a tap made are never sent after a break.

When the user takes held keys back, the Outbox writes their number to the Pane
without typing. A late line with those keys is then a copy.

## Considered and left out

- Detaching the previous Client before the new one sends. It works, and it
  does not cover a line that tmux already has.
- Identity from the Topology. The Pane's pid is read on the same line as the
  number, so the two cannot disagree.
- Keeping the Outbox across an app restart. The Seq count and the token would
  have to be stored with it.

## Every Pane input

ADR 0022 makes this the way for every write to a Pane's input. A paste, a
Composer Send are Keys of the Lane too, each under one Seq. They
follow the rules above. A paste with a newline and every Composer Send is held
after a break, like Enter.
