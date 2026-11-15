# Every write to a Pane's input goes through the Outbox

ADR 0019 put typed keys in the Outbox. A paste and a Composer Send went
straight to the Control Connection. That had three faults:

- They could reach the Pane before keys that the user typed earlier and that
  waited in the Lane.
- After a break, the app could not know if they arrived. A paste could arrive
  two times. The Composer showed that it was not sure, and kept Send locked
  until the user looked at the Pane.
- A key typed between the paste of a Send and its Enter landed between them.

## The rule

Every write to a Pane's input goes through the Outbox: typed keys, Key Row
keys, a paste and a Composer Send. Each goes into the Lane of its
Pane, in the order the user made it, under a Seq. The guard of ADR 0019
refuses a copy, and the Lane judges each one after a break.

A new way to write into a Pane is a new kind of Key. Code that writes to a
Pane's input with its own tmux command breaks this rule.

These stay outside the Outbox:

- Split and New Window change a Session, not a Pane's input. The Verb guard
  covers them (ADR 0023).
- A clear still presses `C-l` and drops the Scrollback outside the Outbox.
- Select a Pane or Window, switch Session, Zoom, resize, theme reports and
  reads set or read state. They are safe to run again, or the Attach applies
  them again after a reconnect.
- An upload goes on its own channel (ADR 0011). What reaches the Pane is the
  path, inside the Composer Send.
- Scroll and tap bytes go through the Lane, but they are dropped at a break
  (ADR 0019).

## Writes that are not one key

A paste goes first into a tmux buffer, with one `set-buffer` command for each
2048 code points. The first command has no `-a`, so staging again starts the
buffer again. The buffer name has the Outbox token, the Seq and a random part.
The random part is new for each write, so a late staging command from a lost
Connection cannot add text to the buffer of the next write. Then one guarded
line pastes the buffer (`paste-buffer -p -r -d`) and writes the Seq. The else
branch deletes the buffer. A paste that a mark does not confirm also deletes
its buffer.

A Composer Send is one Batch: the same guarded line pastes, waits 150 ms,
presses Enter and writes the Seq. The wait is `run-shell 'sleep …'` in the
line, so it happens in tmux. Measured on tmux 3.8: the commands after
`run-shell` in a line wait for it. So the two halves arrive together or not
at all, no key can come between them, and the Lane gets no clock. The cost is
that the Control Connection waits 150 ms for each Send, for all Panes.

One case leaves a buffer. If the staging of a write reached tmux and its
guarded line did not, the buffer stays on the server, with the text in it,
until the server ends. No line pastes it, because its name is not used again.

## After a break

The Lane judges these like typed text. Printable text that is fresh is sent
again with the same Seq. These are held:

- a paste with a newline or a control character,
- a Composer Send, because it presses Enter,
- any paste that was written and not confirmed, on tmux below 3.2. There tmux
  cannot refuse a copy.

## The Composer keeps the Draft until the Lane settles the message

A Composer Send gives the message an id. The Draft keeps its text and
Attachments, and takes no edit, until the Lane says what became of the
message:

- tmux confirmed it: the Draft is empty.
- The Lane holds it: the Composer shows why, with Send, Discard and Edit in
  Composer. The card above the Key Row shows the same when the Composer is
  closed.
- The Lane discarded it: the Draft takes edits again and says why it was not
  sent. When the Pane is gone, the card offers Move to Composer, which moves
  the text and Attachments into the Draft of the Pane on screen.

So the text of a message is always in a Draft until the Pane has it.

## Considered and left out

- A paste Batch, then an Enter Batch. A break between them holds the Enter
  alone, and the 150 ms wait needs a clock in the Outbox.
- `run-shell -d`. It needs tmux 3.2 or later. `sleep` works on every tmux
  that Muxify supports.
- Typing the paste with `send-keys -l`, like typed text. tmux then cannot
  bracket it for a program that asked for bracketed paste.
- Clearing the Draft when the message goes into the Lane. A discarded message
  was then lost, and a held one was hidden while the Composer was open.
