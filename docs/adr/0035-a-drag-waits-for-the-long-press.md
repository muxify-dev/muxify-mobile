# A drag waits for the long press

## Problem

A long press on a Pane starts a Selection after 0.35 s. Before then, the
finger belongs to no gesture yet, and a drag could take it:

- **The Surface.** Its one-finger pan, the Pane Swipe and the Scrollback
  scroll, began after about 10 points of travel. The long press failed at 10
  points, the iOS default. A finger that drifted while it was held became a
  swipe or a scroll, and no Selection opened.
- **The Mouse Layer.** In a Pane that listens for the mouse, the layer chose
  an axis after 10 points, stopped its long-press timer, and sent each move
  before that as a wheel event to the program.

When a Selection is open, these gestures already stay off (ADR 0014).

## Decision

- **The Surface's pan waits for the long press.** It requires the Selection
  Layer's long press to fail (`require(toFail:)`). The long press allows 20
  points of movement. So a finger that drifts less than 20 points in 0.35 s
  opens a Selection, and a finger that moves more is a Pane Swipe or a scroll
  as before.
- **The Mouse Layer does the same.** It chooses an axis only past 20 points,
  and sends no wheel event before then. The drift is spent when the drag
  turns out to be a scroll. A finger that drifts inside the slop and lifts
  before 0.35 s is not a tap. The long press starts where the finger is when
  it fires, as on the Surface.
- **The Pane Swipe and the Back Swipe do not change.** The axis lock, the
  commit point and the flick speed stay. A slow drag still changes the Pane.
  The left edge still goes back (ADR 0034).

## Considered

- **A minimum speed for a Pane Swipe.** A slow sideways drift would not be a
  swipe. But a slow, deliberate drag would no longer change the Pane
  (`e2e/pane-swipes.sh` step 4 checks that one does), the number has to be
  tuned by hand on a device, and it does nothing for a vertical drift.
- **No Back Swipe on the Terminal Screen.** It was built and tried on a
  phone. The user wants the left edge to go back here too, as on every other
  screen.

## Consequences

A scroll or a swipe begins after 20 points of travel, not 10, so the first
line of a scroll comes a little later.

A press in the edge band that drifts right can still start the Back Swipe
before the Selection opens: the stack's pop does not wait for the long press.

`e2e/pane-swipes.sh` step 8 checks that a press that drifts opens a
Selection and changes no Pane or Scrollback.
