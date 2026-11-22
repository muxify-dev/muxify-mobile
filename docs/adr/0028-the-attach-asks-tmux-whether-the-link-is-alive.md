# The Attach asks tmux whether the link is alive

ADR 0012 relied on the SSH library's keepalive to find a dead Connection in about 15 s. The library sends keepalives only when the link is idle, and a Connection under an Attach is never idle: the Attach sends tmux commands every few seconds. On 2026-11-22 a Connection stopped answering at 12:38 and stayed in use for minutes: the library still said it was connected, the Attach kept it, and Try again reused it.

So the Attach no longer trusts the library's flags to say that a link is alive. When a screen read passes its deadline, when the app comes back from the background, or when a tmux command waits past the deadline with no reply, the Attach sends tmux one no-op command over the control channel. An answer within 8 s (`EXEC_DEADLINE_MS`) keeps the link. No answer ends the Attach with transport-lost and discards the Connection, so the next use dials again. The flags still count when they say the link is closed.

## Considered Options

- **Fix the keepalive in the library.** It is a prebuilt binary we do not own.
- **A shorter deadline.** It finds a dead link sooner, but it ends healthy Attaches on slow mobile links.

## Consequences

- ADR 0012's statement that a read sent again after a deadline is safe "because the keepalive closes a dead Connection within about 15 s" now holds through the probe, not the keepalive, while an Attach holds the Connection.
- "A Connection is the app's, not a screen's" said that the foreground check asks the transport only, and sends nothing, because a round trip that asks whether a round trip is possible hangs when the answer is no. The foreground check now sends the probe. The deadline answers that reason: the probe cannot hang, because 8 s with no data from tmux ends it.
- Any data from tmux counts as a sign of life, Pane output too, so a slow link that still brings data is kept. The probe and the watch on waiting commands end the Attach only after 8 s with no data at all.
