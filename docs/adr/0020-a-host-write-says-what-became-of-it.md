# A Host Write says what became of it

A change that the user asks of a Host is a Host Write: New Topic, Edit Topic,
New Session, Add a Session, and the menu orders, drops and wakes of a Topic
card. Each screen used to run its write in its own way. A sheet showed a grey
"Saving…" in the top bar and put every error under the first field, a
Connection failure too. A card showed nothing while it ran. Wake had its own
30 s timer. ADR 0012 does not send a write again by itself, because it may have
reached the Host. But a write past the 8 s exec deadline may have reached the
Host too, and a user who taps Save again can make a second Topic.

We decide that every Host Write is one state machine, `src/domain/host-write.ts`,
run by one hook, `src/hooks/use-host-write.ts`.

- **Four states.** Idle; running, at a step; failed, with its reason; and
  unsure. The steps are connecting (no command has left the phone), sending (a
  command may reach the Host), checking, and attaching (the write reached the
  Host and the Attach opens what it made).
- **The step decides failed or unsure.** A break while connecting or attaching
  is failed: nothing was sent, or the write is done. A break while sending or
  checking is unsure: the Host may have it. The 8 s deadline can only end an
  exec, so it is always unsure. A refusal from the Host is failed.
- **One write at a time for each target.** A second tap while it runs is
  ignored. For a sheet the target is the sheet. For a card it is the Topic.
- **Unsure is checked, never sent again.** Send is off while a write is unsure.
  A sheet offers Check, which reads the Host: New Topic looks for an Empty
  Topic with the title, Edit Topic compares the Topic with the edit, New
  Session lists the Sessions, and Add a Session looks for a Session that the
  Topic did not have when the sheet opened. What Check finds is done, or a
  failed write that the user can send again. A card reads the Listing again
  after every write, so that read is its check.
- **Failed keeps the input.** The fields stay as typed. A reason about one
  field shows under that field. Every other reason shows in the row.
- **Two views.** A sheet has a row at the top of its form: a spinner and what
  runs, with the seconds after 5 s; the reason and Retry; or the unsure
  sentence and Check. Its fields and Save are off while the write runs or is
  unsure, and Cancel is off while it runs. A card has a spinner while its write
  runs, and an alert for a failed or unsure end.

Reads, reconnect, Composer uploads, the Outbox (ADR 0019) and the Host CLI
install (ADR 0016) are not Host Writes.

## Considered Options

- **Send again after the deadline.** Rejected: ADR 0012's reason holds, and a
  second `topic new` makes a second Topic. ADR 0021 later sends a write again
  one time, only when it has a Request id.
- **A longer deadline for writes.** Rejected: it waits longer to say the same
  thing, and the deadline is how the registry finds a dead Connection.
- **An idempotency key on each write.** The Host CLI would have to keep and
  compare keys. It is the right fix if Check is not enough, and it belongs to
  muxify-shell. Taken later, as the Request id of ADR 0021.
- **The error under the first field, as before.** Rejected: a Connection
  failure is not about the title, and the user edits a field that is correct.
