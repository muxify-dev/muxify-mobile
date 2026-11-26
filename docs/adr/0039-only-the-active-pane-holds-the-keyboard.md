# Only the active Pane holds the keyboard

## Problem

After Split, New Window or a Session made on the phone, the user wanted to type
in the new Pane. The keyboard stayed on the old Pane. Keys typed meanwhile went
to the old Pane, and a split of a zoomed Window could drop the keyboard. The
keyboard had no owner: a rule for a hardware keyboard, and a rule that gave it
back after Typing stopped, each asked the Surface of the active Pane, which on
a split is the new Surface that never had it. No part knew that the user
wanted the keyboard up.

## Decision

The user chose the goal and the rules of the intent on the planning page
(decisions D1 to D5). The rest is the design of this change.

- **The Attach holds the Keyboard Intent**, `up` or `down`. It lives as long
  as the Attach, so it stays through a split, a Pane change, a Composer and a
  trip to the Host Screen. Only a user act changes it. One pure function,
  `keyboardTarget`, turns the intent and the facts into the Surface that
  holds the keyboard: the active Pane's, none, or "elsewhere" when the
  Composer, a Selection, a sheet, the Edge Drawer or another screen has
  input. It replaces the two rules before it.
- **A Pane that the phone makes sets the intent `up`** when tmux has made it,
  not at the tap. A refused split leaves the keyboard where it was. This is
  true for Split, New Window, and each Session that the phone makes.
- **A tap on the Pane is heard natively.** The patch of `expo-libghostty` sends
  `onKeyboardTap { focused }` when a tap raises or dismisses the keyboard.
  The app cannot tell that tap from its own focus and blur, and a timer to
  guess it is a rule that ADR 0009 rejects.
- **Only the active Pane's Surface holds the keyboard.** A key from any other
  Surface goes to the active Pane. It keeps the modes of the Surface that
  sent it, such as the arrow keys of the old Pane, which is acceptable for a
  late key. A scroll or a tap is not a key and is not moved. The Composer
  Send is addressed to its Draft's Pane and is not moved.
- **A make hold keeps the keys typed while a Pane is made.** It is one hold
  for each tap, in the order tapped, and the newest hold gets the keys. It
  lives in the Attach and outside the Outbox, because the Outbox cannot
  address a Pane that does not exist (a new Lane reads the Pane at once, and
  an unknown Pane reads as gone, which discards the keys). When the verb ends
  as made, the keys go first into the new Pane's Lane. A key typed before the
  Topology lists that Pane goes there too, so a key is never typed into the old
  Pane in that gap. When it ends as refused or dropped, the keys go to the Lane
  of the old Pane as Held keys, with the reason `verb-refused`.
- **The new Lane event is `parked`.** It does not touch a Batch in flight: the
  answer to that Batch still belongs to the Lane (ADR 0022). The Lane asks the
  user when nothing is in flight.
- **The keyboard does not wait for the first paint of the new Pane.** Before
  the paint, tmux takes keys (see Typing), and a keyboard that waited would
  drop and come back on each split.

## Consequences

- A zoomed split removes the old Surface, and the system keyboard can drop for
  a moment before the new Surface takes it. This needs a check on a device.
- The Edge Drawer counts as input elsewhere: the rule does not move the
  keyboard while the drawer is open.
- A Composer that closes with the intent `up` gives the keyboard back to the
  Pane. A user who wants it down dismisses it first.
- A key typed after a Connection loss, while Typing is not open, is dropped as
  before. The make hold keeps only the keys typed while Typing was open.
- A hardware keyboard that leaves while the Pane holds the keyboard sets the
  intent `up`, because the system keyboard comes up on it. It can show for a
  moment as down and up again.
