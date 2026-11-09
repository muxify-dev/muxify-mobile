/**
 * Putting a Pane's screen onto the Surface.
 *
 * `%output` only ever carries what happens *next*, so a Surface that has just
 * attached — or just been pointed at another Pane, or just been dragged back
 * through the Scrollback — has nothing on it until something moves. This is the
 * missing half: `capture-pane` says what is already there, and this turns that
 * into the bytes that put it on screen.
 *
 * Pure. Bytes in, bytes out, no client and no transport.
 */

/** What a paint has to say, beyond the lines themselves. */
export interface ScreenPaint {
  /** The captured screen, one entry per row, as `capture-pane -e -N` gave it. */
  lines: Uint8Array[];
  /**
   * Where to leave the cursor, zero-based as tmux reports it. Undefined for a
   * view of the Scrollback, which has no cursor in it — and showing one parked
   * in the middle of old output reads as a prompt that is not there.
   */
  cursor?: { column: number; row: number };
  /**
   * Whether the Pane draws its cursor. False for a Pane of a split that is not
   * the one being typed into, and for a Pane whose application hid it — a
   * repaint that showed it anyway gave Claude Code a second, blue cursor
   * beside the one it draws itself.
   *
   * Separate from `cursor` on purpose, because a cursor that is not drawn is
   * still *somewhere*: output arriving in an unattended Pane moves it, and the
   * Surface can only follow that if the repaint left it where tmux had it. Put
   * nowhere, a Pane tapped later showed its cursor wherever the repaint
   * stopped — the bottom-left corner.
   */
  cursorVisible?: boolean;
  /**
   * Whether the Pane is on the alternate screen.
   *
   * Set either way rather than only on: the Surface follows the Pane, so
   * moving from vim to a shell has to leave the alternate screen as surely as
   * the other direction enters it.
   */
  alternate: boolean;
}

/**
 * The bytes that make the Surface show this screen.
 *
 * Deliberately a full repaint rather than a diff. The Surface has no idea what
 * the Pane looked like a moment ago — there is no model of it anywhere in this
 * app, by design — so the only honest instruction is "this, from the top".
 */
export function paintScreen(paint: ScreenPaint): Uint8Array {
  const parts: Uint8Array[] = [];
  const write = (text: string) => parts.push(asciiBytes(text));

  // Hidden for the whole repaint: a cursor that walks down the screen as each
  // line lands is the flicker every terminal multiplexer has to suppress.
  write('[?25l');
  write(paint.alternate ? '[?1049h' : '[?1049l');
  // Attributes first: whatever the last screen left set would otherwise colour
  // the first cell of this one.
  write('[0m[H[2J');
  // Autowrap off while the lines land, so a line wider than the Surface is cut
  // at its edge instead of wrapping onto the row below and pushing every row
  // after it down. A capture is wider than the Surface while another Client
  // has the Window at its own size.
  write('[?7l');

  paint.lines.forEach((line, at) => {
    // No newline after the last line. A terminal at the bottom row scrolls on
    // one, which would push the top line off the screen that was just painted.
    if (at > 0) write('\r\n');
    parts.push(line);
  });

  write('[0m[?7h');

  if (paint.cursor) {
    // tmux counts from zero and terminals count from one.
    write(`[${paint.cursor.row + 1};${paint.cursor.column + 1}H`);
    if (paint.cursorVisible !== false) write('[?25h');
  }

  return concat(parts);
}

/**
 * How far back a drag may go.
 *
 * tmux is the only one who knows where the Scrollback runs out —
 * `history-limit` bounds it and old lines fall off the top — so the count
 * comes from tmux and is clamped against it here rather than tracked
 * independently. A number that is quietly wrong is worse than no number.
 */
export function clampBack(back: number, scrollbackLines: number): number {
  return Math.max(0, Math.min(Math.round(back), Math.max(0, scrollbackLines)));
}

/**
 * Which lines to capture to show the screen `back` lines above the live bottom.
 *
 * tmux numbers the visible screen from 0 downwards and the Scrollback
 * negatively, so the window is simply shifted up by `back`. Asking for
 * `rows` of them keeps the Surface exactly as full as it is when live.
 */
export function scrollbackRange(back: number, rows: number): { start: number; end: number } {
  const height = Math.max(1, Math.floor(rows));
  const shift = Math.max(0, Math.floor(back));
  const start = shift === 0 ? 0 : -shift;
  return { start, end: start + height - 1 };
}

/**
 * A run of ASCII as bytes.
 *
 * Only for escape sequences, which are ASCII by construction — so no encoder
 * is needed and none is reached for.
 */
export function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at) & 0xff;
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const all = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}
