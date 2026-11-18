# One Host Problem per Host

When the phone could not reach a Host, one fault showed as two or three
errors, each with its own Retry. On the Host Screen, one Connection that
could not be held set two states: the Listing and the Topics. Each tab drew
a red row for them, with the same text and a Retry that did the same
thing. On the Terminal Screen, a lost link showed the Cover
card with Reconnect. The Title Sheet then showed the Topic's failure with a
Retry, and its Topics list showed the Host's failure with another. Each reader
caught the same failure and showed it, because no one part owned the fault.
Two functions also gave the same failure its words: one for the Attach and
one for the screens.

## Decision

The fault of a Host has one owner and one presenter on each screen.

- **The Connections own the Host Problem.** Every use of a Host goes
  through the app's Connections, one for each Host. A connect that fails
  (for an Attach, a hold, a read, a write or a Host Server request), a
  refused Host key, and a read that fails on its Connection two times record
  the reason for that Host. Any connect that reaches the Host clears it. Screens subscribe to it, as they do to the
  Host CLI install.
- **One classifier.** `reasonForConnectFailure` gives every connection
  failure its kind and its words. `describeConnectionFailure` is its
  `detail`. A use that cannot reach the Host throws `HostProblem`, which
  carries the reason. So the Attach still tells a refused sign-in from a
  Host that did not answer.
- **Readers say nothing about it.** The Listing and the Topics have a
  `host-problem` state with no text. A refusal from a Host that
  answered stays a `failed` state with the Host's words, shown by the screen
  that asked.
- **One presenter for each screen.** The Host Screen puts one row at the top
  of the tab. The Title Sheet has one notice. Its Try again reads the Host
  and the Topic again, and reconnects the Attach when the Cover would offer
  the same. The Cover still owns why the Attach stopped.
- **A screen follows the Host Problem.** When the Host Problem clears, from
  any use, a Host Screen that could not hold the Host holds it again, and a
  Title Sheet read that met it reads again.
- **Labels.** Reconnect for a lost link, Try again for any other connect or
  read, and Retry only for a Host Write, which sends a change again.

## Considered

- **Fix the two screens only.** The Sessions tab drops the second row, and
  the Title Sheet merges its two errors. This is small, but the next screen
  that reads a Host gets the same bug, and the two classifiers stay.
- **One connection state for the whole app.** One machine for Typing, the
  cold-start reconnect and the Host Problem, with one Banner for every
  screen. It mixes scopes: a Host that the user only looks at could stop a
  Terminal on another Host. It also replaces the Cover, which works.

## Consequences

- A new reader of a Host gets the Host Problem without code of its own. It
  must not show a connection failure itself: the error it gets is a
  `HostProblem`.
- A Host Write still shows its own outcome (see the Host Write in
  CONTEXT.md). A write that cannot reach the Host also sets the Host
  Problem, so the Host Screen and the write agree.
- The line of trouble on the Terminal Screen goes away when the Attach's
  Connection ends. The Cover then says what went wrong.
