# The phone speaks `board`, and names a Board Session two ways

The Host keeps a Board Session in its state database (muxify ADR 0101, ADR 0102), so a tmux restart leaves its card on the Board as a Dormant card, and a Board Session can be Pinned, take an In Play place or be a Guest. The Host sends Dormant cards only to a client that declares `board`. We decide that the phone declares `board` and requires it, as it required the capabilities before it: a Host CLI without `board` falls to Sessions only, and the phone updates it (ADR 0016). The wire names a live Board Session only by its tmux id (`session` card, target `{session}`, card ref `{lock:{session}}`) and a Dormant one only by its Board Session id (`dormant_session` card, target `{board_session}`, card ref `{board_session:{id}}`). So the phone keeps the two as two kinds of one row, and one function picks the target and the card ref from the row. A wake of a Dormant Board Session attaches to the `session_name` of the Host's answer, because there is no Topic to read.

## Considered Options

- **Declare `board` but do not require it.** Rejected: a second code path for Hosts the phone updates by itself.
- **Read the `environment` subscription's `board_sessions` change for the Board Session id of a live card.** Rejected: the snapshot is the phone's one source, and the Host takes the tmux id for a live card.
