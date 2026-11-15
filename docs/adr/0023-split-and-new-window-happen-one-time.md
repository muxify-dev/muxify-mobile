# Split and New Window happen one time

Split and New Window went to tmux one time. When the Connection broke after
the line left the phone, the app could not know if tmux ran it. The Alert said
that the verb failed, and a second tap could make a second Pane or Window.

These verbs change a Session, not the input of a Pane. So they do not go
through the Outbox (ADR 0019), but they get the same kind of guard.

## The Op

The Attach has a Verb guard with its own token and one count that only grows.
Each verb gets the next number, its Op. The Session keeps the highest Op it
took in the user option `@muxify-op-<token>`. tmux and other clients do not
read it, it changes no behaviour, and it ends with the Session.

The verb line is `if-shell -F` on the compare of ADR 0019: tmux runs the verb
and writes the Op only while the Session's Op is below this one. The same
chain then reads the Op back. The verb is done when the read shows the Op.

## Across a break

The guard keeps one unconfirmed verb. When the Connection breaks before tmux
answers, the tap ends with no Alert, and the Log says that the verb waits. On
the next Connection the guard reads the Session's Op, after the Outbox and
before Zoom:

- At or above the Op: tmux ran it. Nothing is sent.
- Below: the guard sends the same line again, with the same Op. If a late line
  of the lost Connection already ran it, the guard in tmux refuses the copy.
- The Session is gone, or the tmux server started again: the verb is dropped,
  with a Log line. A new server can give a new Session the old id, and the verb
  must not go there.

A tap made while no Connection is up does nothing. A verb is not a queue: it
is one tap that the user made while the Connection was up.

Each Attach that runs a verb leaves its own `@muxify-op-<token>` option on
the Session, and nothing removes it. A user option changes nothing, so the
options are left there. They show in `tmux show-options`.

On tmux below 3.2 there is no compare. The verb runs without the guard, and a
verb with no answer is dropped at the break, never sent again.
