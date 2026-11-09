# One SSH Connection per Host, held by the app

Muxify will hold at most one SSH Connection per Host. The Attach and every
screen that asks a Host something use that Connection. A screen does not
connect by itself any more.

This changes one point of ADR 0007. "One SSH Connection at a time" becomes "one
SSH Connection per Host". It also closes the gap that ADR 0007 left open:
"Routing the listing down the Attach when there is one would close the gap and
is left for its own change." ADR 0007 needed a rule for a Host that is not the
attached one. With one Connection per Host, each Host has its own, and that
rule is not necessary.

"One Attach at a time" does not change.

## Why it changes

**Each read is a new login.** Today each screen read goes through
`withHostTransport`: TCP, the SSH handshake, the key check, the sign-in, one
exec, and a disconnect. The Host Screen, the Topic Screen, New Session, New
Topic, Edit Topic and Add a Session each do this on each visit. On cellular the
handshake is most of the wait. The Host's auth log gets one login for each
screen. A visit Host Screen → Topic Screen → Session → Home → Topic Screen is
five logins today.

**The probe for `muxify` runs again on each visit.** `createMuxifyCli` keeps
the path it found for as long as the screen lives. Each new screen starts again,
and the probe can be up to three execs before the read.

**A dead Connection is found late.** `connectToHost` does not set the library's
keepalive, so the library uses its defaults: 15 000 ms × 3. A Connection that
nothing reads from is found dead after about 45 s.

## The rules

**Who holds it.** An app-level registry holds at most one Connection for each
Host id. The Attach and the screens ask the registry for a Connection. They do
not call `connectToHost`.

**Sharing.** SSH carries many channels on one Connection. The Attach opens its
control channel on the Host's Connection, as it does now on its own. A screen
opens an exec channel on it for each command.

**Life.** A Connection stays open while an Attach uses it. Without an Attach, it
stays open for 60 s after the last screen read ends. When neither is true, the
registry closes it.

**Keepalive.** `connectToHost` sets `keepaliveIntervalMs` to 5 000 and
`keepaliveMax` to 3. After three keepalives with no answer, the library calls
`onDisconnected`. The registry then drops the Connection at once, and the next
request connects again. A dead Connection is thus found in about 15 s, also when
nothing reads.

**Deadline.** Each screen exec has a deadline of 8 s. After the deadline, the
Connection is suspect:

- If no Attach uses it, the registry drops it and connects again.
- If an Attach uses it, the registry tells the Attach, and the Attach decides.
  The Attach runs its existing check of the transport. If the transport is lost,
  the Attach reconnects as ADR 0007 says, with the Reconnecting Banner.

A read is sent again one time, on the new Connection. A write is never sent
again automatically: it can have reached the Host. The sheet shows the error,
and the user decides.

**The Attach's rules stay.** ADR 0007's policy for a lost transport, the
foreground check, "once per source" and "a reconnect is a replacement" do not
change. When the Attach replaces its Connection, it gives the old one back to
the registry and asks for a new one. The screens then use the new one. When the
Attach closes, it gives its Connection back; it does not disconnect it. The
registry closes it when the 60 s are over.

**Background.** iOS suspends the app, and keepalives stop. When the app comes
back to the foreground, the registry drops each Connection that no Attach uses.
The next read connects again. A Connection that an Attach uses is the Attach's
to check, with its existing foreground check.

**Host key.** The key is checked one time, when the Connection opens, with the
same rules as today. A key seen for the first time is recorded when the sign-in
succeeds. A changed key does not block a screen read, and the Attach shows the
changed-key Banner. The registry keeps the verdict with the Connection. A caller
that asks about the key, as the reconnect's Session list does, gets the stored
verdict before it uses the Connection. If it refuses the key, the registry
closes that Connection.

**`muxify` path.** The registry keeps the path that the probe found for the life
of the Connection. A read is then one exec, not up to four.

## Names

The registry is code, not a new thing that the user sees. **Connection** in
`CONTEXT.md` changes from "Muxify holds one at a time" to "Muxify holds at most
one per Host, and the Attach and the screens share it". No new term goes into
`CONTEXT.md`.

In the code, the module is `src/ssh/host-connections.ts`, and its Log lines
start with `connections:`.

## Considered and rejected

- **Send screen reads down the Attach's Control Connection.** This is what ADR
  0007 suggested. Rejected: it helps only the Host that is attached, and a read
  in control mode waits behind Pane output. An exec channel on a shared
  Connection helps every Host and has no queue.
- **Keep a Connection open for each Host that the user has opened.** Rejected:
  this is a set of Connections that the user cannot account for, which ADR 0007
  rejected for Attaches. The 60 s idle close keeps only the Hosts in use.
- **A shorter deadline, with no retry.** Rejected: 8 s holds a slow cellular
  round trip, and one retry hides a Connection that died without a keepalive
  miss yet. A write gets no retry because it is not safe to do it two times.

## Consequences

**A screen read on an open Connection is one exec.** The Host Screen, the Topic
Screen and the sheets answer faster. The visit above is one login, not five.

**`withHostTransport` goes.** All its callers move to the registry in one
change: `hosts/[id].tsx`, `topic.tsx`, `topic-edit.tsx`, `topic-form.tsx`,
`topic-add-session.tsx`, `session-form.tsx` and the reconnect's Session list in
`terminal.tsx`.

**The Attach's `OpenConnection` seam stays.** The registry gives the Attach a
`HostConnection`, the shape it takes now. The Attach tests keep their fake.

**The registry is testable on the fake transport**, as the Attach is: two reads
share one Connection; the Attach and a screen share one; the idle close; a
silent Connection, its deadline, one retry for a read and none for a write;
`onDisconnected`, then a new Connection on the next read; the return from the
background; an Attach that reconnects, then the screens on the new Connection.

**An idle Connection stays up for 60 s after the user leaves a Host.** This is
the cost. It is short, and the Host Screen already shows the Host the user is
on.

## What shipped, where it differs

**The Attach discards a Connection; it does not give it back.** The rule above
says that the Attach gives the old Connection back when it replaces it. A
Connection that the Attach lost must not go to the next request, so the Attach
discards it: the registry closes it for everyone, and the next request opens a
new one. The Attach discards after every end that is not a close on purpose,
also when tmux ends the Session over a Connection that still works. That costs
the screens one new Connection, and it keeps one rule.

**A read that passed its deadline under an Attach is sent again on the same
Connection** when the Attach finds the link open. The keepalive closes that
Connection within about 15 s if it is dead.

**Measured on the simulator, against the e2e sandbox.** The visit Host Screen →
Topic Screen → Session → Home → Topic Screen (`e2e/topic-screen.sh`) made one
login in the sandbox's sshd log. The code before this change made three before
it reached Home. With the sandbox's sshd frozen under an open Connection, the
registry closed it after 18 s ("the keepalive found it dead"), and the next read
opened a new one.
