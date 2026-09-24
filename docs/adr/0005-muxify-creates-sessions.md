# Muxify creates Sessions

Until now Muxify only ever attached. `attach-session`, never `new-session -A`;
no rename, no kill. The rule was written into `CONTEXT.md`, into
`attachSessionCommand`, and into the Host Screen, which could only offer what
tmux was already running.

The Host Screen now has a **+** that makes a Session, and the rule is lifted for
that one verb.

## Why it was there

Muxify borrows a Host and gives it back. It takes the Session's `status` and
`window-size` and restores both on teardown, because a phone attaching for five
minutes should leave nothing behind. Creating Sessions is the opposite kind of
act: it leaves something running after the app is closed, on a machine the user
is not looking at.

Refusing also kept the app honest about what it was — a *client*, not a manager.
Everything it did was a view onto state somebody else made.

## Why it is lifted

The refusal made the first Session impossible. A Host with no tmux server shows
an empty list and no way forward: the user has to reach the machine some other
way, start a Session there, and come back. For an app whose whole argument is
"reach your work from a phone", that is the one moment it cannot help.

Attaching to a Session you made a second ago is the same code path as attaching
to one from last week — so this adds a command, not a mode.

## What is *not* lifted

Rename and kill stay refused, and Attach still never creates. Specifically:

- `new-session -d`, always detached. A Control Command runs on its own exec
  channel with no terminal to hand a foreground Session, and creating one
  attached would hang the channel. The Shell Channel attaches a moment later by
  the ordinary path.
- **Never `-A`.** A name already taken must fail loudly. `-A` would silently
  hand back somebody else's Session, which is exactly the confusion the old rule
  existed to prevent, and the one case where being wrong is worst.
- The teardown contract is unchanged: borrowed settings are still restored.

## Consequences

Muxify can now leave something on a Host that outlives the app, which it could
not before. A Session created by accident stays until somebody kills it, and
Muxify offers no way to do that — the user must reach the Host another way.
That asymmetry is deliberate for now: creating is the gap that blocks the first
use, killing is not.

`CONTEXT.md`'s **Attach** entry no longer says Muxify never creates Sessions.
