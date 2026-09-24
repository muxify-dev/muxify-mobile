/**
 * tmux's Window layout string, which is the only honest account of where the
 * Panes are.
 *
 * `#{pane_left}` and friends describe where a Pane is *being drawn*, and a
 * zoomed Pane is drawn over the whole Window: tmux reports it at the Window's
 * full size while its neighbours keep the coordinates they had. Muxify zooms by
 * default, so reading those variables makes every Pane overlap the active one.
 *
 * `#{window_layout}` is documented as the layout "ignoring zoomed window panes"
 * — the arrangement that will come back when zoom is turned off, which is the
 * one a preview of the Window should draw.
 *
 * The grammar is small:
 *
 *   layout := checksum "," cell
 *   cell   := WxH "," X "," Y ( "," paneId | "{" cells "}" | "[" cells "]" )
 *   cells  := cell ( "," cell )*
 *
 * `{}` holds Panes side by side and `[]` holds them stacked, but nesting is
 * arbitrary and the coordinates inside are already absolute — so nothing here
 * has to care which bracket it is inside, only that they balance.
 */

/** Where one Pane sits in its Window, in cells. */
export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The Panes a layout string describes, by tmux's Pane id (`%3` reads as 3).
 *
 * Pane id rather than index: the layout names Panes by id, and indexes shift
 * as Panes come and go. Returns nothing at all for a layout it cannot read,
 * because a half-parsed layout would place some Panes and pile the rest on top
 * of each other — which is the bug this exists to prevent.
 */
export function parseWindowLayout(layout: string): Map<number, PaneRect> {
  const comma = layout.indexOf(',');
  if (comma < 0) return new Map();

  const rects = new Map<number, PaneRect>();
  const cursor = { at: comma + 1 };
  if (!readCell(layout, cursor, rects)) return new Map();
  if (cursor.at !== layout.length) return new Map();
  return rects;
}

const CELL = /^(\d+)x(\d+),(\d+),(\d+)/;
const PANE_ID = /^,(\d+)/;

/** Reads one cell and everything under it, advancing the cursor past it. */
function readCell(
  layout: string,
  cursor: { at: number },
  rects: Map<number, PaneRect>,
): boolean {
  const cell = CELL.exec(layout.slice(cursor.at));
  if (!cell) return false;
  cursor.at += cell[0].length;

  const rect: PaneRect = {
    width: Number(cell[1]),
    height: Number(cell[2]),
    left: Number(cell[3]),
    top: Number(cell[4]),
  };

  const open = layout[cursor.at];
  if (open === '{' || open === '[') {
    const close = open === '{' ? '}' : ']';
    cursor.at += 1;
    for (;;) {
      if (!readCell(layout, cursor, rects)) return false;
      if (layout[cursor.at] !== ',') break;
      cursor.at += 1;
    }
    if (layout[cursor.at] !== close) return false;
    cursor.at += 1;
    return true;
  }

  const id = PANE_ID.exec(layout.slice(cursor.at));
  if (!id) return false;
  cursor.at += id[0].length;
  rects.set(Number(id[1]), rect);
  return true;
}
