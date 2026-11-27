# A Host Read shows that it runs from the tap

## Problem

The phone asks a Host many questions: the Go to list, the hold of the Host
Screen, the Tags, the folders and the open Topics. Each screen ran its read
in its own way, with attempt counters, Symbol turns, revision numbers and
refs. Between the tap and the answer, the user often saw no change:

- A keystroke in Go to cleared the rows. For one render the list said
  "Nothing matches.", because the read started in an effect after the render
  of the keystroke.
- A failed Go to read showed its reason with no Try again.
- Try again on the Host Screen did not change the refused row or the Host
  Problem row until the Host answered. A user who saw no change tapped again,
  and each tap started the hold again.
- No one-shot read cancelled its request on the Host Server. The Host did the
  work of a replaced read, and only the phone ignored the answer.

Host Writes do not have this problem. ADR 0020 gives them one state machine
and one row.

## Decision

The user chose the base of the API, when the progress line shows, how the
kept rows look, what Return does and what the Host Writes share, on the
planning page (decisions D1 to D5). The rest is the design of this change.

- **A Host Read is one state machine.** `src/domain/host-read.ts` holds the
  states and the transitions, with no React. One hook,
  `src/hooks/use-host-read.ts`, runs it. It is the read-side twin of the Host
  Write.
- **The screen owns each read.** One screen can own several Host Reads, such
  as the Go to list and the hold. Each read has its own `isPending`. No flag
  is shared across the app or across reads.
- **`isPending` is true in the render of the tap or keystroke.** A screen asks
  from its event handler, not from an effect. The progress line shows at
  once, with no delay. A debounce delays the send. It never delays the
  feedback.
- **The last answer stays.** The read keeps its last answer, and the key that
  the answer is for, until a current answer replaces them. The kept rows look
  the same and the user can tap them, because each one is still a real Topic,
  Session or folder on the Host. The progress line stands above them. A
  screen that must not move rows under the finger can hold the new answer.
  Each open of Go to is a new search with no rows (ADR 0041): the last
  answer stays only inside one search.
- **The newest ask wins.** Each ask gets a ticket. A new ask, a cancel, an
  unmount or a loss of focus aborts the request in flight, and the read calls
  `cancel()` on its Host Server call. The machine drops an answer or an error
  whose ticket is old, also when the cancel did not reach the Host in time.
  A read changes nothing on the Host, so a cancel cannot leave a change half
  done.
- **Every read has the same Try again.** Try again asks the last key again
  with no debounce. The reason stays on screen next to the spinner as
  "Trying again…". The button is off until the result, so a second tap does
  nothing.
- **A read shows the Host Problem only where nothing else does.** The
  Connections keep it. On the Host Screen, the Host Problem row says it one
  time (ADR 0026), so Go to does not say it again. A sheet has no Host
  Problem row, so its read says the reason with Try again.
- **Return in Go to waits for the new answer.** While the read runs, Return
  waits, then picks the first row of the new answer. A later keystroke drops
  the waiting pick. When the read fails, Return picks nothing. A row that the
  user chose with the List Keys is not a best match: Return opens it at once.
- **Host Writes share only `isPending` and the row.** `host-write.ts` gets
  `isPending(write)`, so each screen asks the same question in the same way.
  The writes do not move onto the hook. The unsure state of a write and its
  rule never to send again blind do not apply to a read. The cancel and the
  replacement of a read do not apply to a write.
- **VoiceOver hears the result of a slow read.** The progress line and Try
  again have labels. When a read that took more than 1 s ends, the screen
  announces the result one time. A faster read announces nothing, so typing
  does not make VoiceOver speak on each key.

## Considered Options

- **TanStack Query.** It gives `isFetching` for each key, kept data and
  cancel through a signal. Rejected: its cache is a second cache next to the
  device caches and the pushed Listing, the held answer of Go to needs custom
  code, and its retry defaults must be turned off.
- **React `useTransition` and `useActionState`.** They give `isPending`, but
  no cancel and no kept answer, so the hook still needs most of its own code.
- **The progress line after 300 ms.** Rejected: every Go to read waits at
  least the 150 ms debounce, and a read of 310 ms shows a spinner for 10 ms.
- **Dimmed kept rows.** Rejected: iOS shows a dimmed row as disabled, and
  these rows work.
- **Hidden kept rows, as before.** Rejected: the list blinks on each
  keystroke.
- **Return picks the highlighted kept row.** Rejected: a fast typist gets
  the match for an old query.
- **Return does nothing while a read runs.** Rejected: on a slow link the
  key seems broken.
- **One hook for reads and writes.** Rejected: the hook needs a mode that
  turns off cancel and Try again for writes, which is two machines in one
  file.

## Consequences

- The progress line moves the rows down one line, one time for each read.
- The kept rows show the match marks of the old query. This tells the user
  that the rows are old.
- Attach switches and tmux verbs are not Host Reads: a Session row, a pick in
  the Title Sheet or the Edge Drawer, New Window and Split. They follow the
  same rule, and each one shows its own `isPending` from the tap.
- Each screen moves to the hook in its own change. Until then, a screen keeps
  its own read code.
- The hold of the Host Screen is not a read with an answer: it lasts while
  the screen has the focus. It does not use the hook. It keeps a flag from
  the tap on Try again until the hold ends, and follows the same rules.
  Move to Topic holds the Host the same way, so it cannot wait for ever for
  a Listing that no Connection pushes.
