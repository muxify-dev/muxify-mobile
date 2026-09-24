# A Connection is the app's, not a screen's

Muxify tears the Connection down the moment the Terminal Screen is left and
re-establishes it on return. It will stop. One Attach is held at the app's
root: going Home leaves the Session attached, backgrounding leaves it attached,
and coming back to the foreground asks the transport whether the link survived
and restores it once if it did not.

This supersedes the sentence in the Terminal Screen's teardown effect that
"Connections are ephemeral by design; leaving the screen tears this down and
returning re-attaches, which tmux makes cheap", and the `CONTEXT.md` **Connection**
entry that said the same.

## Why it changes

Two reasons, and the second one is the one that forced it.

**It is not cheap, and it is not invisible.** Coming back from the Hosts list
is a full Attach: TCP, the SSH handshake, key verification, a settled grid,
`tmux -C attach`, size, Zoom, Topology, Session list, and a `capture-pane` per
Pane. On a phone on cellular that is a visible Connecting banner every time the
user glances at the Host Screen, and a new SSH connection in the Host's auth
log for each glance. `remux`, the native app this project probes, does not do
it: its root model keeps every attached Session in a collection and leaving to
the library changes what is *on top*, not what is connected.

**The suspension case has no answer inside a screen.** iOS suspends a
backgrounded app without saying whether its sockets survived. Muxify's Terminal
Screen stays mounted across that, so its teardown never runs and its Connection
is neither closed nor checked — the user comes back to a Surface that looks
connected and is not, or to one that was fine and is showing a "closed" banner
it did not need. Answering that means asking the transport a question at a
moment no screen is told about, and acting on the answer for as long as it
takes. A component's effect cannot own that. This is what made the change
necessary rather than merely worthwhile.

The friction was found by the architecture review of 16 September 2026, whose
crutch ledger records the Terminal Screen's twenty checks of a `disposed` ref
and the `background()` sink for orphaned rejections as one entry: a Connection
lifecycle expressed as a `start()` inside a component, cancelled by a ref that
every async step has to remember to consult. Those checks are what a screen
owning a Connection costs. Moving the Connection out replaces all of them with
one `close()`.

## What Muxify copies from `remux`

Read from `remux`'s root model, its screen model and its reconnect-source and
runtime-state types on 16 September 2026.

- **Home does not disconnect.** Disconnect is an explicit verb on the Session's
  row, and navigation is navigation.
- **Background does not disconnect.** On the background phase the Attach
  cancels in-flight preview and Session-list reads and stops writing to
  Surfaces. It begins no background task and sends nothing to keep the link
  alive.
- **Foreground asks whether the link survived.** On becoming active the Attach
  asks the transport whether the control channel is still open. If it is, it
  carries on; if it is not, it reports a lost transport with a foreground
  source and the policy restores it once. A Session that was already
  disconnected when the app came back is treated as the same opportunity.
- **Transport loss while active reconnects once**, labelled "Reconnecting"
  where a foreground restore is labelled "Restoring".
- **Once per source, reset on connected.** Each automatic source — foreground,
  transport loss — gets one attempt, and the record clears the next time the
  Session is connected. A failed attempt leaves the reason and a manual
  Reconnect.
- **Only a lost transport is retried.** Authentication, a Host key, an
  unreachable Host, a missing tmux, a Session that ended and a close the user
  asked for never reconnect on their own.
- **A reconnect is a replacement, not a repair.** The SSH Connection, Control
  Connection, Client and Topology store are closed and remade and the Pane
  views re-created; `remux` makes a new runtime with a new instance id for the
  same reason, so updates from the old one are recognised as stale and dropped.
  Muxify uses a generation counter inside one Attach, so to a subscriber it is
  a phase change rather than a new object.
- **The labels.** Connecting, Connected, Restoring, Reconnecting, and a short
  label per disconnect reason. The same words in the Terminal Screen's banner
  and on the Host Screen's row.

## What it deliberately does not copy

- **Several Attaches at once.** `remux` holds a collection; Muxify holds one.
  Opening a Session while one is attached closes it first, as user-closed. One
  is enough for a probe, and it is the difference between a Connection the user
  can account for and a set of them they cannot. The holder is a slot, so a
  collection could replace it later without the Attach module changing at all.
- **Anything to keep the link alive in the background.** No background task, no
  extra keepalives beyond the SSH library's own. `remux` does neither, and the
  foreground check is the design: a suspended Muxify should be a Muxify the
  Host has forgotten about.

## Considered options

- **Keep tearing down on unmount.** The status quo. It answers Home
  acceptably — tmux really does make re-attaching cheap — and answers
  suspension not at all, because the screen stays mounted and nothing runs.
  The reconnect-after-suspension logic would have to live somewhere anyway, and
  once it does, tearing down on unmount is a second lifecycle contradicting the
  first.
- **Keep the link alive in the background**, with a background task or a
  tighter keepalive. Rejected: iOS grants a background task for seconds, not
  for the length of a coffee, so it buys a slightly longer window and not a
  guarantee — and the foreground check is needed regardless, which makes the
  keepalive pure cost to the Host and the battery. `remux` reached the same
  conclusion.
- **Hold several Attaches, as `remux` does.** Rejected for now, on scope: it
  needs a Sessions-in-progress surface of its own to be usable, and every one
  of them is a Connection the user has to remember they left open. The slot is
  shaped so this stays reachable.
- **Keep the Connection in a React context but still tie it to the Terminal
  Screen's mount.** Rejected as the worst of both: the ownership moves and the
  lifecycle does not, so the `disposed` checks stay and the suspension case is
  still nobody's.

## Consequences

**A Session left attached is a Connection the user has to remember to end.**
This is the real cost, and it is paid by the user rather than by the code. It
is mitigated rather than removed: the Hosts list marks the Host that has the
attached Session and says which one, the Host Screen's row for it shows its
phase and carries Disconnect, and opening any other Session closes it. It is
still true that walking away from the app leaves an SSH connection up until iOS
kills the process.

**The Terminal Screen stops being where anything lives.** No `useRef` to a
Connection, a Control Connection, a Client or a store; no `disposed` ref, no
`background()` sink, no `start()`. It subscribes on mount, unsubscribes on
unmount, and asks the root to open a Session when it arrives with none. What is
left is layout, gestures and chrome.

**The lifecycle policy is testable.** Background, foreground with a live
channel, foreground with a dead one, a second dead foreground, transport loss,
a reason that forbids a retry and a user close are all unit tests against a
fake transport, and the real-tmux harness kills a child process and watches the
restore. None of it needs a phone. That is the point of moving it.

**The Host Screen still opens a Connection of its own to list Sessions**, and
can now do so while an Attach is up — which it could not before, because
leaving the Terminal Screen used to take the Connection with it. It is
short-lived and borrows nothing (ADR 0006's exec channel), so "one Attach at a
time" is still true, but "one SSH Connection at a time" is not. Routing the
listing down the Attach when there is one would close the gap and is left for
its own change: it needs a rule for what the Host Screen shows about a Host
that is *not* the attached one.

**The transport seam gains one question** — whether the control channel is
still open — answered by the SSH adapter from the library's `isConnected` and
`isOpen` flags and by the local-process adapter from whether the child is
alive. Nothing is sent to ask it; a round trip to find out whether a round trip
is possible is a round trip that hangs when the answer is no.

**`CONTEXT.md` changes with it.** **Connection** no longer says it is torn down
when the Terminal Screen is left, and **Attach** says it is what the app holds.

## What shipped, where it differs

*(Written before ticket 07 landed, and corrected here once it had, as ADR 0006
was. Filled in below.)*

**tmux's stderr did not survive the control parser, and had to be made to.**
The spec flagged this as a loose end to settle in passing; it turned out to be
load-bearing for the classification this ADR rests on. A shell channel with no
pty keeps stderr separate and the SSH adapter merges it into the control
stream, but the parser dropped every line outside a reply block that did not
start with `%` — so a `tmuxExecutablePath` pointing at nothing closed the
channel saying nothing at all, and the ending was classified as a lost
transport and *retried*. The parser now emits those lines as a `notice`, and
the Control Connection keeps them until the attach is answered. A missing tmux
now reads as "tmux unavailable" in the shell's own words and is not retried.
Measured against tmux 3.7c in `e2e/control-mode.test.ts`.

**A dead Connection found on foreground is one source, not two.** The first
cut let the closure that reports it consume the transport-loss attempt on the
way past, so the user saw "Reconnecting" where `remux` says "Restoring" and the
foreground source was never spent. The source is now decided by whoever noticed
the ending rather than by the ending itself.

**A replacement had to re-create the Pane views, and nothing was doing it.**
The views belong to the Connection and are let go with it; the Surfaces belong
to the screen and do not move. The first cut disposed the views and waited for
the screen to hand a Surface over again — which on a reconnect it never does,
because nothing re-mounted. A reconnect therefore ended `connected` with every
Pane blank. The Attach now keeps each Pane's Surface *and the last grid it
reported*, and builds a view over both whenever the Topology says the Pane is
still there. Both halves, or the new view waits forever for a grid that was
thrown away with the old one — the same bug the Pane view was deepened to
close, one level up.

**"Cancel the in-flight reads" means dropping the answer, not only declining
to ask.** A preview or Session-list read already on the wire when the app is
suspended still resolves; what makes it cancelled is that nothing is published
from it. Both the start and the landing are guarded.
