/**
 * The text of a Pane, as the Selection Layer needs it.
 *
 * The Surface draws glyphs and keeps no text that can be asked for, so a
 * Selection reads its text from tmux, the same place the picture came from.
 * One capture gives both: the rows with their colours are painted, and the
 * same rows without them are the text. A second capture with the wrapped rows
 * joined says which rows tmux wrapped, which nothing else reports.
 *
 * Pure. Captures in, rows out.
 */

/** One row of a Pane, as the Selection Layer shows and copies it. */
export interface SelectionRow {
  /**
   * tmux's line, counted from the first line of the Scrollback. Counted from
   * there, and not from the top of the screen, so that a row keeps its number
   * while output arrives below it.
   */
  line: number;
  /** The row's text. Trailing spaces are kept only on a row that wraps. */
  text: string;
  /**
   * The cell each UTF-16 unit of `text` starts at, and the row's width in
   * cells last. Absent when each unit is one cell wide.
   */
  cells?: number[];
  /** Whether tmux wrapped this row onto the next one, so a copy joins them. */
  wraps: boolean;
}

/** The rows of one capture, and which of them the Surface's first row is. */
export interface SelectionRows {
  /** The line of the Surface's first row. */
  top: number;
  rows: SelectionRow[];
}

/**
 * What `capture-pane -e` puts between the characters: SGR colours, OSC 8
 * hyperlinks, and the shift in and out of the line-drawing set.
 */
const SEQUENCES = /\u001b\[[0-9;:]*m|\u001b\]8;[^\u001b\u0007]*(?:\u001b\\|\u0007)|[\u000e\u000f]/g;

/**
 * Rows for the Selection Layer from one capture.
 *
 * `painted` is `capture-pane -e -N` decoded, one entry per row. `joined` is
 * `capture-pane -J` over the same lines. `cols` is the Surface's width: a row
 * wider than that is cut there, as the paint cuts it.
 */
export function selectionRows(
  painted: string[],
  joined: string[],
  top: number,
  cols: number,
): SelectionRow[] {
  const plain = painted.map((row) => row.replace(SEQUENCES, ''));
  const wraps = wrappedRows(plain, joined);
  return plain.map((text, at) => rowOf(top + at, text, wraps[at], cols));
}

/**
 * Which rows tmux wrapped onto the next one.
 *
 * tmux ends a joined line where a row does not wrap, so a joined line that is
 * longer than the row it starts with continues on the next row. Lengths, not
 * contents: `-J` and `-N` do not agree on the spaces after the last character,
 * but a row that wraps is full, and a full row is the same in both.
 *
 * All false when the two captures do not have the same line ends. Then they
 * were not taken from the same screen, and a copy with each row on its own
 * line is the safe answer.
 */
function wrappedRows(rows: string[], joined: string[]): boolean[] {
  const wraps: boolean[] = [];
  let line = 0;
  let rest = joined[0] ?? '';
  for (const row of rows) {
    if (rest.length > row.length) {
      wraps.push(true);
      rest = rest.slice(row.length);
    } else {
      wraps.push(false);
      line += 1;
      rest = joined[line] ?? '';
    }
  }
  const ends = wraps.filter((wrapped) => !wrapped).length;
  const lastWraps = wraps[wraps.length - 1] === true;
  if (ends + (lastWraps ? 1 : 0) !== joined.length) return rows.map(() => false);
  return wraps;
}

function rowOf(line: number, captured: string, wrapped: boolean, cols: number): SelectionRow {
  const cells: number[] = [];
  let cell = 0;
  let end = 0;
  let clipped = false;
  for (const character of captured) {
    const width = cellWidth(character.codePointAt(0) ?? 0, cell);
    if (cell + width > cols) {
      clipped = true;
      break;
    }
    for (let unit = 0; unit < character.length; unit += 1) cells.push(cell);
    cell += width;
    end += character.length;
  }
  let text = captured.slice(0, end);
  const wraps = wrapped && !clipped;
  if (!wraps) {
    text = text.replace(/ +$/, '');
    cells.length = text.length;
  }
  const width = text.length === end ? cell : (cells[text.length - 1] ?? -1) + 1;
  const plain = cells.every((start, unit) => start === unit) && width === text.length;
  return plain ? { line, text, wraps } : { line, text, cells: [...cells, width], wraps };
}

/**
 * How many cells tmux gives a character.
 *
 * An approximation of the width table tmux uses. A character this gets wrong
 * moves the selection one cell off the glyphs to its right on that row.
 */
function cellWidth(code: number, cell: number): number {
  if (code === 0x09) return 8 - (cell % 8);
  if (code < 0x300) return 1;
  if (inRanges(code, ZERO_WIDTH)) return 0;
  if (inRanges(code, WIDE)) return 2;
  return 1;
}

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([first, last]) => code >= first && code <= last);
}

const ZERO_WIDTH = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0x1f3fb, 0x1f3ff],
  [0xe0100, 0xe01ef],
] as const;

const WIDE = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
] as const;
