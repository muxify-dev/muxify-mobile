# Surface readiness is a promise the Surface keeps, not a timer the app waits

A Pane is painted by writing a remote capture into a Surface, and the Surface is
`expo-libghostty`'s view over a ghostty surface it builds, tears down and
rebuilds on its own schedule. Painting into it was a matter of timing: the app
waited a measured quarter of a second after mounting before its first write,
because bytes written before the ghostty surface existed were dropped, and it
trusted that one grid report meant one surface. Neither held. The library drops
writes whenever it has no surface — including the gap while it rebuilds one —
and reports a resize once per distinct viewport for the life of the view, so a
surface rebuilt at the same size is blank and silent. A Pane could end up
showing nothing, with every write and focus call waiting on a report that
would never come, and only an unrelated layout pass would rescue it.

We decided the Surface has to make two promises, and made it make them in the
local patch rather than working around their absence in the app: **nothing
written to it is lost** — bytes arriving with no sized surface underneath are
held and written when one reports — and **every surface it builds reports its
grid**, once per surface per distinct grid, so a report of a grid already
painted at means the picture underneath is gone. It also stops reporting
ghostty's own default grid, announced from inside surface creation before the
view has a size, which is the "pre-layout grid" every caller had learned to
distrust. On the app side a grid report is therefore always a reason to paint,
the settle timer is gone, the Attach keeps a mounted Surface's record even when
its Pane leaves a Topology, and the Terminal Screen tells whichever Attach is
current what its Surfaces have already said — a Surface speaks once per size,
and which Attach was listening at the time was an accident.

## Considered options

- **Keep the timer, tune it longer.** Rejected: it was measured against one
  symptom of one cause on one device, and a rebuild at the same size is not a
  question of waiting longer — no report was coming.
- **Ask the Surface for its grid on demand.** Would cover a lost report but not
  a lost write, and a caller that has to poll a view for whether it may write to
  it is a caller that has already been given the wrong interface.
- **Detect a blank Pane and repaint on a watchdog.** A crutch over an unknown
  cause; it would also have hidden the causes this work found.

## Consequences

The app depends on the patched library's behaviour, and the patch's hunks say
so in place. A same-grid report now costs one capture, which happens only when
the library has rebuilt a surface. Tests that used to advance the paint timer
assert on the two facts alone. The regressions suite opens a second Session over
the first, the one flow where an Attach is replaced under a Surface that has
already spoken.

Refusing to report before the surface is attached turned out not to be enough
to keep the default grid out. The Log (ADR 0010) showed a fresh Surface saying
49x40, then 32x11, then 49x40 again, all within a millisecond and all after
attach — so the app repainted every new Pane three times, the placeholder
reached the sizing module as a Window grid, and a zero cell once reached the
screen. The placeholder travels ghostty's own resize callback: announced from
inside surface creation with no cell, given the last real cell by the
library's session on the way through, and delivered to the main queue after
the surface has been attached, so no check on the report itself can tell it
from a real grid. That callback now reports nothing. The coordinator's
`terminalDidResize` is computed from the view's own size after the surface
has been given it, carries the cell, and fires for every surface built and
every size the view takes; it is the one report the Surface passes on. Had the
placeholder ever arrived last, the settle window would have believed it and
the Window would have been sized to eleven rows, which is the same failure ADR
0006 measured on a real device.
