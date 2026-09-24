/** Which way the wheel turned. Up is back into the past. */
export type WheelDirection = 'up' | 'down';

/** SGR button codes for the two wheel directions (1006 extended mouse mode). */
const BUTTON = { up: 64, down: 65 } as const;

/**
 * The bytes a terminal sends when a mouse wheel turns, in SGR (1006) form.
 *
 * This is how scrolling reaches tmux without a Control Command: the sequence
 * goes down the Shell Channel that is already open, costing no round trip at
 * all, where `send-keys -X scroll-up` costs a whole new exec channel — which is
 * what made dragging feel like it was catching on something.
 *
 * It is also the only form that works for a full-screen application. tmux's own
 * wheel binding routes on what the Pane is doing: history for a shell, and the
 * event passed straight through for anything on the alternate screen or asking
 * for the mouse. So Claude Code, vim and less each scroll themselves, and none
 * of that routing has to be repeated here.
 *
 * The coordinates are where the pointer is taken to be. They are 1-based and
 * must land inside the Pane, because tmux drops an event pointing outside one.
 */
export function wheelSequence(
  direction: WheelDirection,
  notches: number,
  column: number,
  row: number,
): string {
  const count = Math.max(0, Math.trunc(notches));
  if (count === 0) return '';
  // Clamped away from zero: a coordinate of 0 is off the screen, and tmux
  // discards the event rather than reading it as the first cell.
  const x = Math.max(1, Math.trunc(column));
  const y = Math.max(1, Math.trunc(row));
  return `\u001b[<${BUTTON[direction]};${x};${y}M`.repeat(count);
}

/**
 * The cursor keys a terminal sends in place of a wheel, for a full-screen
 * application that never asked for the mouse.
 *
 * One key per line, because that is what the application will move for each.
 * The plain form rather than the application-cursor form: `less` and `man`
 * both read it, and guessing DECCKM wrong sends letters into the buffer.
 */
export function cursorKeys(direction: WheelDirection, lines: number): string {
  const count = Math.max(0, Math.trunc(lines));
  if (count === 0) return '';
  return `\u001b[${direction === 'up' ? 'A' : 'B'}`.repeat(count);
}

/**
 * How many lines one notch of the wheel moves.
 *
 * tmux's own copy-mode binding is `send-keys -X -N 5 scroll-up`, so five is
 * what a notch buys in a shell. Matching it here is what makes the history
 * travel at the speed of the finger rather than five times it.
 */
export const LINES_PER_NOTCH = 5;
