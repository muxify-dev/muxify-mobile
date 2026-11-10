# The keyboard does not resize the normal screen

The normal screen keeps this policy. The alternate-screen exception below
allows full-screen programs to fit above the keyboard.

Muxify reflows the remote Window every time the keyboard opens or closes: the
Dock lifts, the container shrinks to the strip above the keys, the Surface
reports a smaller grid, and `refresh-client -C` tells tmux to lay the Window out
for it — and back again on the way down. It will stop. The Window keeps the
height it has with the keyboard down, the container clips it, and it is slid up
under the keys just far enough for the row being typed on to clear them.

## Why it changes

A resize is where a terminal's text moves, and tmux's rules for that are the
same as every terminal's. Shrinking pushes the top rows into the Scrollback.
Growing adds rows **at the bottom** and pulls them back from the Scrollback —
`min(needed, history)` of them — and blanks the rest, leaving the text where it
was. Measured against tmux 3.6 with `resize-window` and no client involved.

That is unremarkable on a laptop, where a window is resized once an hour. Here
the keyboard resized the Window several times a minute, and `clear` sends
`\e[3J`, which takes the Scrollback with it. Fill a keyboard-height screen after
a `clear`, close the keyboard, and the text sat halfway up the phone with
seventeen blank rows under it. Every toggle was also a remote round trip, a
`SIGWINCH` to whatever the Pane was running, and a laptop attached to the same
Session squeezed to twenty-four rows for as long as the phone's keyboard was up
(ADR 0006 already names that squeeze as the cost of `refresh-client -C`).

## Considered options

- **Keep resizing, grow only as far as the Scrollback can fill.** Tried and
  reverted. It held the Window at the keyboard's height after a `clear` and
  pinned the Surface to the bottom of the screen, so the text did end at the
  bottom — and then grew the Window back one step per burst of output as the
  Scrollback refilled. Every step was a Surface resize, a remote resize and a
  repaint: it flickered, visibly, exactly when the user was reading output.
  A limit that lifts itself is a resize that keeps happening.
- **Keep resizing, and anchor the text to the bottom by repainting it there.**
  Rejected without trying: the Surface's grid would no longer be tmux's, and
  every absolute cursor move in the Pane's output would land on the wrong row.
- **Slide the Window under the keyboard.** Chosen. No resize, so nothing
  reflows, nothing is stranded and no round trip is made; the text is exactly
  where the terminal put it, with the keyboard up or down.

## Consequences

- While the keyboard is up, a full-screen application shows its bottom rows and
  not its top ones. `vim`'s status line is visible and its first lines are
  above the status bar; `less` likewise. This is the trade, and it is the same
  one a small terminal window with a tall scrollback makes.
- The slide follows the cursor as tmux reports it, which is read with the rest
  of the Pane's state after output settles rather than parsed out of the byte
  stream. When output carries the cursor from above the fold to below it, the
  Window follows a beat later — once per screen-fill after a `clear`, and not
  at all while the screen is full, because the cursor stays on the last row.
- The Window's full height comes from the Terminal Screen's bounds, minus
  the visible Key Row and resting safe area. Rotation and physical keyboard
  changes update that height even while the software keyboard is up. The
  software keyboard and Composer do not change the normal-screen height.
- Every e2e helper that used the grid changing as its signal that the keyboard
  had moved is wrong now, and reads the Dock's position instead.


## Alternate-screen exception

A program on the alternate screen has no Scrollback to preserve. The Client
now uses the visible height above the keyboard while the active Pane uses
that screen. Vim and similar programs redraw at this height, so their first
row and status line are both visible. The normal screen still uses the full
height and the Slide. The Composer does not change this height policy.

The active Pane decides the policy for the whole Window. In a split, the
other Panes resize too. A laptop Client that shows the same Window sees the
smaller Window while the phone is typing. This is an accepted cost, along
with a remote resize and a SIGWINCH for each height change.

Exiting the alternate screen restores the full height at once, even when the
keyboard stays up. Before this change, a sandbox probe on tmux 3.8 filled a
28-row normal screen, opened vim, shrank it to 12 rows, exited, and restored
28 rows. The shell prompt returned to row 28 with no blank rows below it.
This differs from resizing a normal screen after `clear`, which remains the
reason to keep the Slide there.

A Selection holds both the Window size and the Slide while its keyboard is
hidden. The top clip edge covers the remainder of a partial row without
moving the last row under the keyboard. The Topic Header uses two lines. The
native Header owns its height, and the Surface measures the content area below it.
