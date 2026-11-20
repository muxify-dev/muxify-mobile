# A Theme for each Appearance, reported to tmux

> **Status: changed in part by [ADR 0026](0026-the-screen-in-use-writes-the-themes-colours.md).**
> The rule that a Pane is told the Theme's colours once per Client and per
> colours no longer applies: the screen whose user acted last writes them.
> The rest of this decision still applies.

The user chooses an Appearance (System, Light or Dark), a Light theme and a
Dark theme. One pure function, `resolveTheme`, gives the Theme in use from
these settings and the phone's own light or dark setting. The app chrome, the
Surface and the colours that the app reports to tmux all come from that one
answer. Before this decision, one Theme setting decided everything, and the
phone's setting had no effect.

## The kind is part of the Theme

Each Theme says whether it is light or dark. The Light theme setting can hold
only a light Theme, and the Dark theme setting only a dark one. The types make
the wrong pairing impossible, and the settings parser refuses it in a file.

## A change applies at once

A Theme change repaints the Surface of a Session that is already on screen.
Before this decision, the Terminal Screen kept the Theme of the Attach until
the next Attach, because a repainted Surface showed colours that the Host did
not send. With System, the phone changes the Theme at sunset with no action
from the user, so to wait for the next Attach is not acceptable.

## The Theme's colours go to tmux

A program such as NeoVim asks the terminal for its background (OSC 11) to
choose between its light and dark look. tmux answers for the Pane. The app is a
control client, and the Surface's own answers do not go to tmux (see
`withoutTerminalReplies`). Before this decision, tmux answered black, and
NeoVim was always dark.

Now the app sends `refresh-client -r '<pane>:<OSC 10 or 11 reply>'` for each
Pane of the Session: at Attach, for each Pane that appears later, and for all
of them again when the Theme changes. The Attach reports the whole Session, not
only the Window on screen, because a program reads the colours when it starts.

Measured on tmux 3.8, on a throwaway server:

- After the report, tmux answers the Pane's OSC 10 and OSC 11 queries with the
  reported colours.
- A program that turned on mode 2031 (`ESC[?2031h`) gets `ESC[?997;2n` when
  the background changes to light and `ESC[?997;1n` when it changes to dark.
  A NeoVim that uses mode 2031 can change its look while it runs.

## Consequences

**The report belongs to the Pane, not to the Client.** tmux keeps the reported
colours on the Pane. A desktop client that views the same Session sees the
phone's colours in a program that asks after the phone reported them. The
report stays on the Pane after the phone detaches.

**A tmux without `refresh-client -r` is not an error.** The app ignores a
refused report, and the Session works as before, with black as the answer.

**Nothing goes to tmux while the app is in the background.** A Theme change
while the app is in the background is reported when the app is active again
and the Connection is still open.

## Considered and rejected

- **One Theme setting that is also the light/dark switch.** This was the design
  before. It cannot follow the phone, and a user who wants a light Theme by day
  and a dark Theme by night has to change it two times each day.
- **Let the Surface answer OSC 11 itself.** The app strips the Surface's
  answers on purpose: tmux answers queries, and the Surface's answers would
  go into the Pane as typed input.
