/**
 * The bytes a terminal sends for the mouse, in SGR (1006) form.
 *
 * Both of the things a finger can mean to a full-screen application: turning
 * the wheel, and pressing where it is pointing.
 */

/** Which way the wheel turned. Up is back into the past. */
export type WheelDirection = 'up' | 'down';

/** SGR button codes for the two wheel directions (1006 extended mouse mode). */
const BUTTON = { up: 64, down: 65 } as const;

/**
 * The bytes a terminal sends when a mouse wheel turns, in SGR (1006) form.
 *
 * Only ever sent to a Pane on the alternate screen, where the application is
 * scrolling itself. On the normal screen a drag is a `capture-pane` over the
 * Scrollback instead, so these bytes never go anywhere near tmux's own wheel
 * binding — which is why the `mouse` option is not set and does not need to be.
 * See ticket 06.
 *
 * They go in as ordinary input, through `send-keys`, exactly as a keystroke
 * does. An application that asked for the mouse acts on them; one that did not
 * would ignore them entirely, and gets cursorKeys below instead.
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
 * The bytes for a left click at one cell: press, then release.
 *
 * Both halves, together, because an application waits for the release before
 * it acts — a press on its own leaves a button held down for ever, and the
 * next tap reads as a drag.
 *
 * This is what makes a tappable thing in a full-screen application tappable
 * here: Claude Code's "Jump to bottom", vim's status line, a file in a picker.
 * Without it a tap only ever raised the keyboard, which is the one thing the
 * user did not ask for by tapping a button.
 *
 * Coordinates are 1-based cells, as SGR has them, and must land inside the
 * Pane — tmux drops an event pointing outside one.
 */
export function clickSequence(column: number, row: number): string {
  const x = Math.max(1, Math.trunc(column));
  const y = Math.max(1, Math.trunc(row));
  return `\u001b[<0;${x};${y}M\u001b[<0;${x};${y}m`;
}

/**
 * How many lines one notch of the wheel moves.
 *
 * tmux's own copy-mode binding is `send-keys -X -N 5 scroll-up`, so five is
 * what a notch buys in a shell. Matching it here is what makes the Scrollback
 * travel at the speed of the finger rather than five times it.
 */
export const LINES_PER_NOTCH = 5;
