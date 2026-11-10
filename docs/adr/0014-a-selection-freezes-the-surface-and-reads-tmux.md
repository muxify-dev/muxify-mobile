# A Selection freezes the Surface and reads its text from tmux

A long press on the Surface starts an iOS text selection: the word under the
finger, two handles, the loupe, and the system menu with Copy and Paste. The
text that is selected does not come from the Surface. It comes from tmux, and
the Pane's picture stays still until the Selection ends.

## Why it is built this way

The Surface draws glyphs with Metal and keeps only the rows on screen. Muxify
has no text model of a Pane, by design (see `paintScreen`): tmux has the
screen and the Scrollback, and the Surface is painted from `capture-pane`. So
the only complete source of a Pane's text is tmux, and a Selection reads it
there.

iOS draws a selection for a view that conforms to `UITextInput`. The Surface's
own `UITextInput` is the keyboard's composition buffer, with one phantom
character behind the caret for the held delete key. It cannot also be the
document that is selected. The **Selection Layer** is a second, read-only
`UITextInput` view, a subview of the Surface. It holds rows of text that
Muxify gives it and maps each one to the cells of the grid.

The two must agree. A row that the Selection Layer has the text of must be the
row that the Surface shows at that place. Two rules make that true:

- **One capture is the picture and the text.** For a frozen Pane, each paint
  comes from one batch of Control Commands: `#{history_size}`,
  `capture-pane -e -N` over the rows, and `capture-pane -J` over the same
  rows. The second is painted. The same reply without its colours is the
  text. The third says which rows tmux wrapped, which no format reports.
- **The Pane is frozen.** While a Selection holds a Pane, its output is
  dropped, as it is when the Pane is scrolled back. tmux keeps the present,
  and the Pane is painted from a capture when the Selection ends.

A row is keyed by its line counted from the first line of the Scrollback
(`history_size` plus tmux's line number). tmux's own numbers count from the
top of the screen, and they change for a row each time a line of output
arrives. The key does not, so a place in a Selection stays on its text while
the user drags the Pane through its Scrollback.

## Considered options

- **Ghostty's own selection.** The Surface has one. It holds only the rows on
  screen, each repaint clears it, and its edit menu needs iOS 17. A selection
  could not go into the Scrollback.
- **A `UITextView` over the Surface.** TextKit lays its text out with its own
  metrics. They drift from the grid ghostty draws, by a point or two a row,
  and a highlight that is not on the glyphs is worse than none.
- **tmux copy-mode.** It selects on the Host, with keys. It is not an iOS
  selection, it has no system menu, and it changes what a laptop attached to
  the same Session shows.
- **The system's own long press on the Selection Layer.** It needs the text
  at the moment the finger has been down for half a second, and the text is
  a round trip away. Muxify uses its own long press instead: the press asks
  for the rows, and the Selection Layer selects the word when they arrive.
  The handles, the loupe and the menu after that are the system's.
- **Keep the Pane live under the selection.** Each line of output moves the
  rows. The handles would then be on text that has gone.

## Consequences

- The Selection Layer takes first responder, as a read-only text view does,
  so the keyboard goes down during a Selection. The Window does not move for
  that: the Slide from before the Selection is kept until it ends. The
  keyboard comes back at the end if the Surface had it at the start.
- While a Selection is open a horizontal drag is not a Pane Swipe, and the
  mouse layer is off, so a program that listens for the mouse gets no click.
  A vertical drag still moves a Pane on the normal screen through its
  Scrollback. On the alternate screen it does nothing: the program would move
  a screen that the Surface no longer follows.
- A Selection ends on a tap outside it, after Copy or Paste, on a key from
  the Key Row, on a change of Pane, Window or Session, and when the Attach is
  lost.
- Copy joins the rows that tmux wrapped and drops the spaces at the end of
  each other row, so a long command comes back as the one line that was
  typed.
- Paste from the system menu, and ⌘V on a hardware keyboard, read the
  clipboard inside the system's own paste action. iOS shows no "Allow Paste"
  prompt for that. The text goes into the Pane as the Shortcut ⌘v sends it:
  through a tmux buffer, with the question first when the program would run
  each line.
- The width of each character comes from a table in `selection-rows.ts`, not
  from tmux. Where the table and tmux differ for a character, the highlight
  is one cell off to the right of that character on that row. The text that
  is copied is still correct.
- A program that draws again at the bottom of the screen changes the text of
  rows the Selection Layer already has. The Layer has the newest text for
  each row it was given, and the copy uses that.
- A line that falls off the top of a full Scrollback moves each key by one.
  A Selection held open across that is one row off. tmux gives no number
  that stays the same there.
