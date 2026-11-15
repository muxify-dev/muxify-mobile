# A Request id goes with each Host CLI write

The phone runs each Host CLI command over SSH and waits 8 seconds for the
answer. When the answer was lost after the Host made the change, the phone
said "Could not …", and a second tap made the change a second time: a second
Topic with `-2`, a second Session, a card that moved two places. The phone did
not send a write again, because it could not know if the first send arrived.

The Host CLI now takes `--request <uuid>` and applies one id one time (desktop
Muxify, ADR 0083). The phone sends a Request id with each Host CLI write. With
the id, a second send is safe, and it is also the only way to learn what the
Host did.

## One id for one thing the user asked for

The caller makes the id when the action starts, outside the work that the
Connections run, so a second send has the same id.

- A tap on a menu order, a drop, Reopen, Start Fresh: one id for each tap.
- Edit Topic: one id for each field write of one Save. The ids are made
  before the Save goes to the Connections, so the second send of the Save
  sends each field with its first id, and a field that the Host already
  changed gets its first answer.
- New Topic: the id stays while the title and the Tags stay. A change makes a
  new id, because the Host refuses an id that comes with other arguments
  (exit status 3). A refusal makes a new id, because the Host keeps a refusal
  with its id for 24 hours and would give it again to a corrected Save.
- Add a Session: the id and the picked Session name stay while the folder
  stays, with the same two rules.

A read never has an id. The Host refuses `--request` on a read.

## The capability decides

`environment show --json` has a `capabilities` list. The phone sends
`--request` only when the list has `request`, because the Host CLI in a Mac's
app bundle can be older than the phone. Each Connection's Host CLI caller
keeps the list. Each read of the Topics brings it up to date. A write that
comes before a read asks one time. A Host CLI without the capability gets the
command with no id, and the Log says one time for each Connection that the
Host CLI is too old for Request ids.

## One second send

A write with `--request` whose exec ends with no answer, by the 8 second
deadline or by a lost Connection, is sent one more time with the same id. The
deadline closes a Connection that no Attach holds, so the second send dials a
new one. A Connection that an Attach holds is the Attach's to close, so the
second send can go out on that one. The Host lets one id run in one process at
a time, so both cases are safe.

The second send goes out with the id or not at all. If the Host CLI of the
new Connection does not offer the capability, the phone sends nothing.

A write without an id is not sent again. That rule of ADR 0012 stays for it.

## "It may have reached the Host"

A write has three ends, not two: changed, refused, and unknown. ADR 0020
already gives each Host Write these ends: done, failed and unsure. This ADR
adds two ways to be unsure and changes no state.

- A write that went out and got no answer after the second send, or a write
  without an id that got no answer, ends unsure, as before. The reason says
  when the second send got no answer either.
- Exit status 4, where the Host says that the Request changed its records and
  did not finish, ends unsure at any step, with the Host's words. Only a verb
  that is not safe to run again, such as a move of one place or a trade, can
  give it.

A dial that fails is not unknown: nothing went out, and the write ends failed.

Unsure is still checked and not sent again by a tap: a sheet offers Check and
a card reads the Listing again (ADR 0020). A wake from a Dormant Topic's card
also offers Open Topic, which reads the Topic again and opens it if it has a
Session. When Check finds that the write did not reach the Host, the write is
failed, and Retry in New Topic and Add a Session sends the same Request: the
Host applies it one time, also if the first send reached it after the check.

## The phone picks the Session name

`topic add-session` without `--name` gives a second Session `+2` on a second
run, so the Host cannot run it again. With `--name <name>` the Session is
`<name>/<slug>` and a second run finds it. But the Host also finds a Session
of the same Topic that was there before, and makes nothing. So the phone must
pick a name that the Topic does not have. On the tap, it reads the Topics and
picks by the Host's own rule (`SessionNaming.available`): the name of the
folder's Session Path, or the last part of a typed folder as tmux takes it,
then `+2`, `+3` when a Session of the Topic has the name. It picks one time
for each Request.

## The two writes that are not Host CLI writes

- New Session is a plain `tmux new-session`, which has no Request id. Its
  Check lists the Sessions (ADR 0020). When "duplicate session" follows a
  create of the same name that got no answer, the write fails with words that
  say the Session can be the one that the user made, and Retry Attach opens
  it with no second write.
- An Attachment has an id from the time it is staged, and its upload writes
  the folder with that id. A second upload writes the same folder, so no
  second copy stays on the Host.

## Considered and left out

- Sending a write again without an id. It is the fault this ADR removes.
- More than one second send. One covers a lost answer. A Host that does not
  answer two times is not reachable, and the user must know.
- A queue of writes that waits for the Host, and writes that stay after an
  app restart. The user would not know which changes are still to come.
- Composer Send and paste, which go through tmux and not the Host CLI, and
  the split and New Window verbs. They are later work.
- A read of the Topics before each write, to make the write absolute. The
  Request id already covers a move that is sent again.
