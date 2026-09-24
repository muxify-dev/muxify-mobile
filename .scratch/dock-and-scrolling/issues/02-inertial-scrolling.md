# 02 — Scrolling that carries on

**Status:** done

**What to build:** a flick keeps moving after the finger has gone, and slows to
a stop.

- [x] A flick coasts, wherever the finger was taken
- [x] It moves smoothly rather than in steps
- [x] A new touch catches it, as every scroll view does

## Comments

**Half of it already worked, which is why it was confusing.** The terminal
library ends its own pan by decaying the velocity on a display link and
reporting the deltas, so the Surface's gesture always coasted. The layer that
takes the finger whenever an application is listening for the mouse — which on a
phone is most of the time, because that is what Claude Code and vim do — had
nothing of the kind, and a flick there stopped dead. Same constants now, out of
the vendored source rather than guessed: velocity times 0.92 a frame, stop below
50 points a second.

**Velocity has to be measured over a window.** Read off the last move event it
is noise: a drag arrives as sixty events, the last of them covering a couple of
points in a couple of milliseconds. Measured on the simulator, that gave 222
points a second for a flick worth thousands — a coast of about one line, which
is why the first attempt looked like it had done nothing.

**Scrolling moves in lines now, not wheel notches.** A notch is five lines, so
however smoothly the finger travelled the Scrollback went in five-line jumps —
and a flick slowing to a stop *stepped* rather than slowed. The view is now told
lines and decides what a line is for the Pane it is looking at: a position in
the Scrollback, a cursor key, or a fifth of a notch of the wheel, with the
remainder carried rather than dropped.

**Not verified by automation.** `agent-device swipe` plays every swipe out at
about 313 points a second whatever duration it is given, so it cannot produce a
flick. What was verified is that the arithmetic holds: at that speed the coast
is worth one notch, and one extra notch is exactly what arrived after the finger
lifted. The parts that can be tested without a finger — `coast`, `isFlick`, the
velocity tracker, and the line-to-notch carry — are unit-tested.
