# 03 — A tap in a mouse-tracking Pane should raise the keyboard too

**Status:** done

**What to build:** tapping the screen in Claude Code raises the keyboard, as
tapping a terminal always has.

- [x] A tap sends the click *and* raises the keyboard
- [x] A tap that only escapes the Scrollback does not

## Comments

The cost of the mouse layer, finally paid. That layer takes the touch away from
the Surface whenever an application is listening for the mouse — which is what
makes Claude Code's "Jump to bottom" tappable at all — and the Surface is what
used to raise the keyboard. So the Pane you most want to type in was the one
Pane you could not type in: clickable, and mute.

A tap on a terminal means both things at once, so it now does both. The
exception is a tap on a Pane dragged back through its Scrollback: that tap is
already spoken for, spending itself returning to the present, and raising the
keyboard on the way would cover the screen the user was trying to look at.

Dismissing is still the Dock's job. A tap that toggled the keyboard would mean
every click in a full-screen application flickered it.
