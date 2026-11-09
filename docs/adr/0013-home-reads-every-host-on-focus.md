# Home reads every Host when it comes into focus

Home shows a section for each Host, and each section has real rows: Topics,
Recent Sessions or Sessions, the first 5 of what the Host Screen would show.
Those rows come from a Listing, so Home asks every saved Host for its Listing
each time it comes into focus. This is the same read that the Host Screen does
for one Host.

This follows ADR 0012 and changes no rule of it. The registry holds at most one
Connection per Host, and a screen opens an exec channel on it for each read.

## The cost

**One Connection per Host, not one per section.** Each section reads its own
Host through `appConnections().read`. Two reads of one Host, as when Home comes
into focus twice in a row, share its Connection. N Hosts open at most N
Connections. The visit Home → Host Screen → Home → Host Screen is one login for
each Host, because the Connection stays open for 60 s after the last read.

**Launch opens a Connection to every Host.** A cold start opens Home, so it
reads all the Hosts at once. This is the cost the user accepts for rows that are
ready to tap. A Host that is off, or on a Tailscale address with the phone off
that network, is one SSH time-out in the background. The other sections do not
wait for it, because each section reads and draws on its own.

**A Connection stays up 60 s after Home.** Home reads every Host, so after it
every Host's Connection stays open for 60 s, not only the Host the user then
opens. This is the same idle rule as ADR 0012, applied to more Hosts.

**Each focus is a read of every Host.** Coming back from the Host Screen, from
Settings or from the Terminal Screen reads them all again. The read is invisible
(see Listing in `CONTEXT.md`): a section keeps its last answer on screen until a
better one arrives, so the dot does not go orange again and the rows do not
blink.

## A Host that cannot be reached

A refusal belongs to its section only. The section drops its rows and shows the
reason and **Retry**, as the Host Screen's refused row does, and its dot is red.
Remembered Sessions are not shown under a refusal: a Home that lists Sessions of
a Host that is down reads as a Host that is up. The Host Screen still shows
them, for the user who goes there on purpose.

While the first read is in flight, the section shows what the user last opened
on that Host (fail open, as the Host Screen does), with an orange dot. A Host
that never answers ends in the refusal when the Connection's own time-out ends,
and Retry asks again.

**Retry** is the section's own. It reads that one Host again and leaves the
others as they are.

## Considered and rejected

- **Read only the Host the user last used.** Rejected: Home would then be one
  Host with the others as names, and that is the Hosts list again.
- **Read the Hosts one after another, to limit the Connections.** Rejected: one
  slow Host would hold every Host after it, and the order of the Hosts is the
  user's, not a queue.
- **Keep Home's last answer between visits and read only on a pull.** Rejected:
  Home must show what the Host has now, as the Host Screen does, and the read is
  one exec on a Connection that is usually open already.

## Consequences

**`useHostReading` is the one read.** The Host Screen and each Home section read
a Host through it, and `hostScreen` takes a `limit` that Home sets to 5. Home
does not build its rows another way, so a row is drawn and opened in Home as on
the Host Screen.

**Home's tree stays under a pushed screen.** A Session or Topic row on Home is
also on the Host Screen over it, so for a moment after a push both are on
screen to the accessibility tree. The e2e flows wait for the push to settle.
