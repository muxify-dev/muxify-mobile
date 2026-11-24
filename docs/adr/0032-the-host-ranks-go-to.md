# The Host ranks Go to

ADR 0024 gave the phone a matcher and a visit order for running Sessions.
The Mac ranked those Sessions with Session Paths and Topics. The two lists
could differ on the same Host.

A Host Server that offers `go-to` supplies the list. The phone sends the
field text, the current Session on this Host and any selected Tag. The Host
applies the Mac's Go to… configuration to the Topics and Sessions Sources.
The phone draws the sections and match marks in the order received. Each
pick uses the row's target. A Tag opens a filtered list. The phone still
adds a row for a typed folder.

The Attach reports a Session visit to this Host. The Host records the visit
for the Session, its Topic and its Session Path. Both clients use these
visits. Recent Sessions still help the phone choose a Session for a Topic.

The capability is optional. A Host without it keeps the Go to behavior in
ADR 0024. Folder pickers continue to request Session Paths because they also
offer folders where a Session already runs. Each Host has a cache for the
unfiltered empty-field list and a separate cache for Session Paths. A new
empty-field answer waits if it would move rows under the user's finger.

This changes the ranking decision in [ADR 0024](0024-the-host-screen-has-the-macs-two-views-and-go-to.md).
