import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import type { Clock, Timer } from '@/lib/clock';
import { systemClock } from '@/lib/clock';
import { clickSequence, cursorKeys, LINES_PER_NOTCH, wheelSequence } from '@/lib/mouse-wheel';

import { asciiBytes, clampBack, paintScreen, scrollbackRange } from './pane-screen';
import type { SelectionRows } from './selection-rows';
import type { Grid, PaneState, SelectionCapture } from './tmux-client';

/**
 * The slice of TmuxClient one Pane's view needs.
 *
 * Narrow on purpose: this is the whole of what showing a Pane involves, and
 * keeping it small keeps that visible.
 */
export interface PaneReader {
  paneState(paneId: string): Promise<PaneState | undefined>;
  capturePane(paneId: string): Promise<Uint8Array[]>;
  captureScrollback(paneId: string, startLine: number, endLine: number): Promise<Uint8Array[]>;
  captureSelection(paneId: string, startLine: number, endLine: number): Promise<SelectionCapture>;
  sendKeys(paneId: string, bytes: Uint8Array): Promise<void>;
  sendKey(paneId: string, key: string): Promise<void>;
}

/**
 * The Surface this Pane is painted on, as the view needs it.
 *
 * Two implementations and that is what justifies the seam: the
 * `expo-libghostty` view in production, and a recording fake in the tests
 * below. Bytes rather than base64 — the library's wire format is the adapter's
 * business, not this module's, and everything above here has always dealt in
 * bytes because a multi-byte character split across two reads survives byte
 * handling and does not survive text decoding.
 */
export interface PaneSurface {
  write(bytes: Uint8Array): void;
  /** Takes the keyboard. */
  focus(): void;
  /** Gives it up. */
  blur(): void;
  /**
   * Whether this Surface is the one the keyboard is talking to.
   *
   * A promise because the library's answer crosses to the native side, and
   * the honest shape of a question asked across that boundary is one that has
   * to be waited for.
   */
  isFocused(): Promise<boolean>;
  /**
   * Gives the Selection Layer the text of these rows, and says which line the
   * Surface's first row is. `press` is where a long press landed: the Layer
   * starts a Selection there, or offers Paste where there is no text.
   */
  showSelection(rows: SelectionRows, press: SurfacePoint | null): void;
  /** Closes the Selection Layer's selection. */
  endSelection(): void;
}

/** A place on the Surface, in points from its top left. */
export interface SurfacePoint {
  x: number;
  y: number;
}

/** How far back through its Scrollback a Pane is being viewed. */
export interface ScrollPosition {
  /** Lines above the live bottom. Zero when live. */
  back: number;
  /** How long the Scrollback is, which is what tmux's `history-limit` allows. */
  scrollbackLines: number;
}

export interface PaneViewEvents {
  /** Where the Pane is in its Scrollback, or null at the live bottom. */
  onScroll: (position: ScrollPosition | null) => void;
  /**
   * Whether the application in the Pane is asking for mouse events.
   *
   * The Terminal Screen needs this to decide what a tap means: a click to send
   * on, or the keyboard to raise. Nothing in the control protocol announces it
   * — an application turns mouse tracking on by writing an escape sequence to
   * its own screen — so it is read with the rest of the Pane's state and
   * reported when it changes.
   */
  onMouseTracking?: (wanted: boolean) => void;
  /**
   * The row of the Pane the keyboard must not cover, when it changes.
   *
   * What the Terminal Screen slides the Window by when the keyboard covers
   * part of it — see windowSlide. Read with the rest of the Pane's state,
   * because that is where tmux keeps it; nothing in the byte stream says where
   * the cursor ended up without parsing the stream, and parsing it is the
   * Surface's job. See rowInSight.
   */
  onRowInSight?: (row: number) => void;
  /** A repaint landed on the Surface. What clears a line of trouble. */
  onPainted?: () => void;
  /** Something went wrong. Best effort; never fatal to the view. */
  onError?: (error: unknown) => void;
}

export interface PaneView {
  /** The Pane this view is for. Fixed at creation. */
  paneId(): string;
  /**
   * The Surface to paint on, or null when there is none.
   *
   * A view outlives its Surface: the Terminal Screen unmounts on Home and
   * mounts again on return while the Attach, and the views it holds, stay up.
   * Losing one stops every write; gaining one starts a fresh resync, exactly
   * as a first paint does, because the capture on return is the truth.
   */
  setSurface(surface: PaneSurface | null): void;
  /**
   * A grid the Surface reported.
   *
   * Told rather than asked, and painted at every time: the Surface speaks once
   * per grid per surface underneath it, so a report is always news — a new
   * size, or the same size on a surface the library has rebuilt blank.
   */
  reportGrid(grid: Grid): void;
  /**
   * Whether this is the Pane the keyboard and the Key Row are about.
   *
   * Owns the cursor: only one Pane of a split has the keyboard, and a cursor
   * in each of the others reads as several places to type.
   */
  setActive(active: boolean): void;
  /** Raises the keyboard on this Pane, whatever it was doing. */
  focusKeyboard(): void;
  /** Raises it if it is down and dismisses it if it is up. */
  toggleKeyboard(): Promise<void>;
  /** Whether this Pane's Surface has the keyboard right now. */
  keyboardFocused(): Promise<boolean>;
  /**
   * Whether the app is in the background.
   *
   * A suspended app draws nothing: output is dropped rather than written, and
   * no repaint is scheduled. Coming back resyncs, because what arrived while
   * nobody was looking is not worth replaying — the capture is.
   */
  setPaused(paused: boolean): void;
  /** Bytes tmux pushed for this Pane. */
  receive(bytes: Uint8Array): void;
  /** Bytes the user typed. */
  type(bytes: Uint8Array): void;
  /**
   * One key by tmux's name for it: `Up`, `Escape`, `Tab`, `C-c`, `M-b`.
   *
   * The Key Row's path. A name rather than the bytes for it, because which
   * bytes are right depends on what the Pane is running — see sendKeyCommand.
   */
  press(key: string): void;
  /**
   * A scroll gesture, in whole lines. Positive is back into the past. The grid
   * is only for the coordinates a wheel event has to carry.
   *
   * Lines rather than wheel notches, because a finger is not a wheel. A notch
   * is five lines, so a drag measured in notches moved the Scrollback in
   * five-line jumps however smoothly the finger travelled — and a flick
   * coasting to a stop stepped rather than slowed. What a line becomes for the
   * Pane being looked at is this view's business: a position in the
   * Scrollback, a cursor key, or a fraction of a notch of the wheel.
   */
  scroll(lines: number, grid: Grid): void;
  /**
   * A tap at one cell, 1-based as SGR counts them.
   *
   * Answers whether it was sent as a click. `false` means the application is
   * not listening for the mouse and the tap belongs to whoever asked — on a
   * phone, to the keyboard.
   */
  click(column: number, row: number): boolean;
  /** Back to the live bottom, and a repaint to prove it. */
  jumpToLatest(): void;
  /**
   * Repaints from a fresh capture. For a Window that changed size: what is on
   * the Surface was drawn for the old width, and output alone does not redraw
   * all of it.
   */
  resync(): void;
  /**
   * Whether the Surface is showing the past rather than the present.
   *
   * What a tap means depends on it: a tap on a Pane that has been dragged back
   * spends itself returning to the bottom, and is not the tap that also wanted
   * the keyboard.
   */
  scrolledBack(): boolean;
  /**
   * A long press on the Surface: the Pane freezes and its text goes to the
   * Selection Layer.
   *
   * Frozen means output is dropped, as it is in the Scrollback, and each paint
   * comes from the capture that also gives the text. So the rows the Layer
   * selects are the rows on the Surface. A drag still moves a frozen Pane
   * through its Scrollback, and each new position gives the Layer its rows.
   * See ADR 0014.
   *
   * Answers whether the Pane froze. False for a Pane with no painted Surface,
   * and for one that a Selection holds already.
   */
  beginSelection(press: SurfacePoint): boolean;
  /** The Selection is over: the Layer closes, and the Pane is live again. */
  endSelection(): void;
  /** Nothing more is wanted from this view. Releases the Surface. */
  dispose(): void;
}

/**
 * How long a reading of what the Pane is doing stays good enough to route a
 * scroll by. A drag that follows `less` starting should be routed by the
 * second notch, not the second drag.
 */
const STATE_STALE_MS = 1500;

/**
 * How long a Pane has to stay quiet before it is read one last time.
 *
 * Long enough that output arriving in chunks is one burst rather than a dozen,
 * short enough that a cursor carried under the keyboard is followed before the
 * eye has finished looking for it. A judgment, not a measurement; see
 * readWhenSettled.
 */
export const OUTPUT_SETTLE_MS = 300;

/**
 * One Pane, on the Surface it is painted on.
 *
 * Owns four things that used to be spread between the Terminal Screen and
 * tmux's own state: the repaint that makes an Attach show something, the
 * stream of output after it, what a drag does, and — the reason this module
 * was deepened — *when it may paint at all*.
 *
 * **Both halves are needed and neither can be waited for.** A Surface arrives
 * as a ref and reports a grid, in either order: one Pane of a split had its
 * grid before its ref and so was never painted at all. So the view takes both
 * as facts and paints the moment it has both.
 *
 * **Every grid report is a reason to paint.** The Surface reports once per
 * distinct grid *per surface underneath it*, and a surface the library has
 * rebuilt at the same size is a blank one — so a report of the grid already
 * painted at is not a repeat, it is news that the picture is gone. There used
 * to be a wait here as well, a quarter of a second after mounting before the
 * first write, measured against a Surface that dropped what was written to it
 * too early. The Surface holds those bytes itself now, so the wait — and the
 * pre-layout grid it was quietly also protecting against — is gone with it.
 *
 * **Attaching shows the Pane as it is.** `%output` carries only what happens
 * next, so the screen already there is read with `capture-pane` and written
 * first. Output arriving while that is in flight is held rather than dropped —
 * and rather than written, which would put the last second of a Pane's life
 * *under* its own repaint.
 *
 * **Scrolling borrows nothing.** tmux's copy-mode is not involved and the
 * `mouse` option is never set. On the normal screen the Scrollback comes from
 * `capture-pane` over a range of it and is painted here; on the alternate
 * screen the gesture becomes input and the application scrolls itself, exactly
 * as it would under any terminal.
 *
 * **One cursor, in the Pane with the keyboard.** Told whether it is the active
 * Pane, the view hides or shows its cursor and keeps it hidden after every
 * chunk — an unattended Pane is still running something, and anything that
 * redraws ends by asking for the cursor back.
 */
export function createPaneView(
  paneId: string,
  reader: PaneReader,
  events: PaneViewEvents,
  options: { clock?: Clock; log?: Log } = {},
): PaneView {
  const clock = options.clock ?? systemClock;
  const say = speakingAs(options.log ?? silentLog, `pane ${paneId}`);

  let disposed = false;
  let paused = false;

  /** Where the bytes go, or null while this Pane has no Surface. */
  let surface: PaneSurface | null = null;
  /**
   * Whether output has already been dropped for want of a Surface, so the Log
   * hears about a stretch of dropping once rather than once per chunk.
   */
  let droppedWithoutSurface = false;
  /**
   * Which Surface a repaint was started for, so one that lands after the
   * Surface was swapped does not paint the new one with the old one's screen.
   */
  let generation = 0;
  /** The one reading taken after a burst of output stops; see readWhenSettled. */
  let settleTimer: Timer | null = null;

  /** The grid the Surface last reported. */
  let grid: Grid | null = null;
  let rows = 24;

  /** What the Pane was last seen doing, and when that was read. */
  let state: PaneState | undefined;
  let stateReadAt = 0;
  /**
   * The last value reported, so the Screen hears only about changes — and
   * false to begin with, because "no mouse tracking" is the state every Pane
   * starts in and is not news.
   */
  let reportedMouse = false;
  /** The row in sight last reported, so only a move is announced. */
  let reportedRow: number | null = null;

  /** How far above the live bottom the Surface is showing. */
  let back = 0;

  /**
   * Lines scrolled on the alternate screen that have not yet made a notch.
   *
   * A wheel has notches and a finger does not. Dropping the remainder would
   * mean a slow drag over `less` moving nothing at all, and a flick's last
   * frames — which are the small ones — counting for nothing.
   */
  let wheelCarry = 0;

  /** Output arriving mid-repaint, to be written once the repaint lands. */
  let held: Uint8Array[] | null = null;

  /**
   * What is on its way into the Pane, and whether a send is in flight.
   *
   * Two kinds, because there are two ways in. Typed input is bytes, and a
   * burst of them coalesces into one `send-keys -H`. A Key Row key is a
   * *name*, which tmux turns into the right bytes for whatever the Pane is
   * running — and which therefore cannot be merged with the bytes either side
   * of it. One queue rather than two, so a key pressed mid-burst still arrives
   * where it was pressed.
   */
  type Outgoing = { bytes: number[] } | { key: string };
  let outgoing: Outgoing[] = [];
  let sending = false;

  /** A repaint in flight, and the position asked for behind it. */
  let painting = false;
  let wanted = false;

  /** Whether this Pane draws a cursor. False for a Pane nobody is typing in. */
  let cursorVisible = true;

  /**
   * The Selection that holds this Pane frozen, or null.
   *
   * `press` is the long press that has not reached the Selection Layer yet.
   * `known` is the run of lines the Layer has the text of, and how long the
   * Scrollback was when the last of them was read.
   */
  let selection: {
    press: SurfacePoint | null;
    known: { first: number; last: number; history: number } | null;
  } | null = null;

  function report(error: unknown): void {
    if (!disposed) events.onError?.(error);
  }

  /** The one way anything reaches the Surface. */
  function write(bytes: Uint8Array): void {
    if (disposed || paused) return;
    if (surface === null) {
      if (!droppedWithoutSurface) say(`dropping output: no Surface (${bytes.length} bytes first)`);
      droppedWithoutSurface = true;
      return;
    }
    surface.write(bytes);
  }

  /**
   * Pane output, with the cursor kept down if this Pane is not the one being
   * typed into.
   *
   * Telling the Surface once is not enough. An unattended Pane is still
   * running something, and anything that redraws ends its redraw by asking for
   * the cursor back — a TUI, a shell drawing its prompt, `clear`. So the
   * answer is repeated after every chunk rather than given once, which is what
   * makes "one cursor, in the Pane with the keyboard" hold over time rather
   * than only at the moment the Pane changed.
   */
  function writeOutput(bytes: Uint8Array): void {
    write(bytes);
    if (!cursorVisible) write(asciiBytes('\u001b[?25l'));
  }

  function announce(): void {
    if (disposed) return;
    events.onScroll(back === 0 ? null : { back, scrollbackLines: state?.scrollbackLines ?? back });
  }

  function announceMouse(): void {
    const asked = state?.wantsMouse ?? false;
    if (disposed || asked === reportedMouse) return;
    reportedMouse = asked;
    events.onMouseTracking?.(asked);
  }

  function announceRowInSight(): void {
    if (disposed || !state) return;
    const row = rowInSight(state);
    if (row === reportedRow) return;
    reportedRow = row;
    events.onRowInSight?.(row);
  }

  /**
   * Reads what the Pane is doing, but no more often than it can change in a
   * way that matters. A Control Command per frame of a drag is what made
   * dragging feel like it was catching on something.
   *
   * `force` is for the one reading taken *after* the output stops; see
   * readWhenSettled for why the throttled ones are not enough on their own.
   */
  function refreshState(force = false): void {
    if (!force && clock.now() - stateReadAt < STATE_STALE_MS) return;
    stateReadAt = clock.now();
    void reader
      .paneState(paneId)
      .then((next) => {
        if (disposed || !next) return;
        state = next;
        announce();
        announceMouse();
        announceRowInSight();
      })
      .catch(report);
  }

  /**
   * Reads the Pane once more when its output stops.
   *
   * The throttled readings above are all taken *before* the chunk that
   * prompted them is written, so the last one of a burst describes the Pane as
   * it was before the burst finished — and with nothing arriving afterwards,
   * nothing ever asks again. Harmless for mouse tracking, which a burst does
   * not change; not harmless for the cursor, which is exactly what a burst
   * moves. Thirty lines of output would carry the cursor under the keyboard,
   * and the Window would not follow it until the next thing the Pane printed.
   *
   * Restarted by every chunk, so a chatty Pane costs one extra Control Command
   * when it finally stops rather than one per chunk.
   */
  function readWhenSettled(): void {
    clock.cancel(settleTimer);
    settleTimer = clock.after(OUTPUT_SETTLE_MS, () => {
      settleTimer = null;
      if (!disposed && !paused) refreshState(true);
    });
  }

  /**
   * Paints a frozen Pane and gives the Selection Layer the text of the paint.
   *
   * The capture reaches as far as the lines the Layer already has, so a flick
   * past a whole screen leaves no lines without text between two it can
   * select.
   */
  async function repaintFrozen(held: NonNullable<typeof selection>): Promise<void> {
    const mine = generation;
    const view = scrollbackRange(back, rows);
    const known = held.known;
    const below = known ? known.last - known.history + 1 : view.start;
    const above = known ? known.first - known.history - 1 : view.end;
    const start = Math.min(view.start, below);
    const end = Math.max(view.end, above);
    let shot: SelectionCapture;
    try {
      shot = await reader.captureSelection(paneId, start, end);
    } catch (error) {
      if (selection === held) endSelection();
      throw error;
    }
    if (disposed || mine !== generation || selection !== held) return;

    const skipped = view.start - start;
    write(
      paintScreen({
        lines: shot.lines.slice(skipped, skipped + view.end - view.start + 1),
        alternate: state?.alternate ?? false,
      }),
    );
    const captured = shot.rows(grid?.cols ?? state?.width ?? 80);
    const last = shot.top + captured.length - 1;
    held.known = {
      first: Math.min(known?.first ?? shot.top, shot.top),
      last: Math.max(known?.last ?? last, last),
      history: shot.top - start,
    };
    const press = held.press;
    held.press = null;
    surface?.showSelection({ top: shot.top + skipped, rows: captured }, press);
    say(`painted ${captured.length} lines for the Selection, ${back} back`);
    announce();
  }

  /** Paints whatever the Pane should be showing right now. */
  async function repaint(): Promise<void> {
    const mine = generation;
    if (surface === null) return;

    if (selection) {
      await repaintFrozen(selection);
      return;
    }

    if (back > 0) {
      const { start, end } = scrollbackRange(back, rows);
      const lines = await reader.captureScrollback(paneId, start, end);
      if (disposed || mine !== generation) return;
      // No cursor: a view of the Scrollback has none in it, and one parked in
      // the middle of old output reads as a prompt that is not there.
      write(paintScreen({ lines, alternate: false }));
      say(`painted Scrollback ${back} back, ${lines.length} lines`);
      announce();
      return;
    }

    // This repaint's own buffer, not merely "the" buffer: two repaints can
    // overlap when a Surface is swapped twice quickly, and the first one
    // finishing must not release the second one's held output.
    const buffer: Uint8Array[] = [];
    held = buffer;
    try {
      // Both go down the Connection together, so the screen and where its
      // cursor is cost one round trip rather than two.
      const [next, lines] = await Promise.all([
        reader.paneState(paneId),
        reader.capturePane(paneId),
      ]);
      if (disposed || mine !== generation) {
        say(`repaint discarded: the Surface changed while the capture was out`);
        return;
      }
      if (next) {
        state = next;
        stateReadAt = clock.now();
        announceMouse();
        announceRowInSight();
      }
      write(
        paintScreen({
          lines,
          alternate: next?.alternate ?? false,
          // Where it is, and whether it is drawn, are two different questions:
          // an unattended Pane's cursor still moves with its output.
          cursor: next ? { column: next.cursorColumn, row: next.cursorRow } : undefined,
          cursorVisible: cursorVisible && (next?.cursorShown ?? true),
        }),
      );
      say(
        `painted ${lines.length} lines at ${rows} rows` +
          (next
            ? `, cursor ${next.cursorColumn},${next.cursorRow}${next.alternate ? ', alternate screen' : ''}`
            : ', Pane state unread') +
          (paused ? ', while paused' : ''),
      );
      if (!paused) events.onPainted?.();
    } finally {
      // Written after the repaint and in the order it arrived, so the last
      // second of the Pane's life lands on top of it rather than under it.
      if (held === buffer) held = null;
      if (!disposed && mine === generation) {
        if (buffer.length > 0) say(`wrote ${buffer.length} chunks held during the repaint`);
        for (const bytes of buffer) writeOutput(bytes);
      }
    }
    announce();
  }

  /**
   * Repaints, with the newest position winning.
   *
   * A flick asks for a dozen positions before the first capture is back. Only
   * the last one is worth painting, and the round trip is the debounce — so a
   * slow Host coalesces harder and a fast one barely at all.
   */
  function schedule(): void {
    if (painting) {
      wanted = true;
      return;
    }
    painting = true;
    void repaint()
      .catch(report)
      .finally(() => {
        painting = false;
        if (!wanted) return;
        wanted = false;
        if (!disposed) schedule();
      });
  }

  /**
   * Paints as soon as it is allowed to, and not before.
   *
   * Allowed means a Surface and a grid, and nothing else: whichever of the two
   * arrives last does the painting, and a grid arriving again paints again.
   * See schedule for why two of these in quick succession cost one capture
   * and a follow-up rather than two in flight.
   */
  function armPaint(): void {
    if (disposed || paused || surface === null || grid === null) {
      say(
        `not painting yet: ${
          disposed ? 'disposed' : paused ? 'paused' : surface === null ? 'no Surface' : 'no grid'
        }`,
      );
      return;
    }
    rows = Math.max(1, Math.floor(grid.rows));
    say(`repainting at ${grid.cols}x${grid.rows}`);
    schedule();
  }

  /** Sends the next thing on its way in, as one command. */
  function flushTyped(): void {
    if (sending || outgoing.length === 0) return;
    const next = outgoing.shift() as Outgoing;
    sending = true;
    const sent =
      'key' in next
        ? reader.sendKey(paneId, next.key)
        : reader.sendKeys(paneId, Uint8Array.from(next.bytes));
    void sent.catch(report).finally(() => {
      sending = false;
      // Whatever was typed during the round trip goes in the next one, which
      // is what turns a burst of keystrokes into one command rather than
      // thirty.
      if (!disposed) flushTyped();
    });
  }

  function endSelection(): void {
    if (!selection) return;
    selection = null;
    say('Selection ended');
    surface?.endSelection();
    schedule();
  }

  function jumpToLatest(): void {
    if (back === 0) return;
    back = 0;
    schedule();
  }

  function type(bytes: Uint8Array): void {
    if (disposed || bytes.length === 0) return;
    // Nobody types into the past on purpose. The key spends itself getting
    // back to the bottom and is not forwarded: it would otherwise land in a
    // Pane the user is not looking at.
    if (back > 0) {
      jumpToLatest();
      return;
    }
    const last = outgoing[outgoing.length - 1];
    if (last && 'bytes' in last) {
      for (const byte of bytes) last.bytes.push(byte);
    } else {
      outgoing.push({ bytes: Array.from(bytes) });
    }
    flushTyped();
  }

  /**
   * One named key, from the Key Row.
   *
   * Queued behind anything already typed rather than sent past it, so an
   * arrow pressed in the middle of a burst of keystrokes arrives where it was
   * pressed. Same rule as typing about the Scrollback: a key pressed while
   * looking at the past spends itself getting back to the present.
   */
  function press(key: string): void {
    if (disposed) return;
    if (back > 0) {
      jumpToLatest();
      return;
    }
    outgoing.push({ key });
    flushTyped();
  }

  return {
    paneId: () => paneId,

    setSurface(next: PaneSurface | null): void {
      if (disposed || next === surface) return;
      // Everything in flight for the Surface that is going belongs to it — and
      // so does the grid it reported. The next Surface reports its own, and
      // is painted then; a grid that arrived before there was any Surface is
      // for the one about to arrive, and is kept.
      generation += 1;
      // The Selection was on the Surface that is going.
      selection = null;
      if (surface !== null) grid = null;
      surface = next;
      held = null;
      droppedWithoutSurface = false;
      // A Surface arrives blank, so what it is showing is nothing rather than
      // wherever the last one had been dragged back to.
      back = 0;
      if (next === null) {
        say('Surface left');
        return;
      }
      say('Surface arrived');
      armPaint();
    },

    reportGrid(next: Grid): void {
      if (disposed) return;
      say(`grid ${next.cols}x${next.rows} reported`);
      grid = { cols: next.cols, rows: next.rows };
      // A later grid is a resize, and the same grid again is a Surface that
      // has been rebuilt blank underneath — see the docblock. Either way the
      // capture is what makes the Pane right, and the rows are what a
      // Scrollback capture is cut to. tmux redraws what it resizes, so for a
      // resize the bytes are on their way as well; the capture lands on top.
      armPaint();
    },

    setActive(active: boolean): void {
      if (disposed || active === cursorVisible) return;
      cursorVisible = active;
      // Shown only if the application shows it: one that hid its cursor would
      // otherwise get a second one back the moment its Pane took the keyboard.
      const shows = active && state?.cursorShown !== false;
      say(active ? `active: cursor ${shows ? 'shown' : 'left hidden, as the application has it'}` : 'inactive: cursor hidden');
      write(asciiBytes(shows ? '\u001b[?25h' : '\u001b[?25l'));
    },

    focusKeyboard(): void {
      if (disposed) return;
      say(surface ? 'keyboard: focus' : 'keyboard: focus asked with no Surface');
      surface?.focus();
    },

    async toggleKeyboard(): Promise<void> {
      const current = surface;
      if (disposed || !current) {
        say('keyboard: toggle asked with no Surface');
        return;
      }
      // Asked of the Surface rather than of a global keyboard listener: React
      // Native's registry never heard of this view — the Surface is a native
      // text input it never registered — so the only honest answer to "is the
      // keyboard up on *this* Pane" is the Surface's own. A listener that saw
      // the keyboard rise over the other half of a split says yes, and
      // toggling on that answer blurs a Surface that was not focused.
      const focused = await current.isFocused();
      if (disposed || surface !== current) {
        say('keyboard: toggle dropped, the Surface changed meanwhile');
        return;
      }
      say(`keyboard: toggle, Surface ${focused ? 'has it → blur' : 'lacks it → focus'}`);
      if (focused) current.blur();
      else current.focus();
    },

    keyboardFocused: () => surface?.isFocused() ?? Promise.resolve(false),

    setPaused(next: boolean): void {
      if (disposed || next === paused) return;
      paused = next;
      say(next ? 'paused' : 'resumed');
      if (next) {
        clock.cancel(settleTimer);
        settleTimer = null;
        return;
      }
      // What arrived while nobody was looking is not worth replaying; the
      // capture is the truth, exactly as it is after any resync.
      armPaint();
    },

    resync(): void {
      if (disposed) return;
      say('resync asked for');
      armPaint();
    },

    receive(bytes: Uint8Array): void {
      if (disposed || paused) return;
      if (held !== null) {
        held.push(bytes);
        return;
      }
      // Dropped while a Selection holds the Pane: the rows on the Surface are
      // the rows the Selection Layer has the text of, and tmux has the rest.
      if (selection) return;
      // Output is the only sign that what the Pane is running may have
      // changed — starting `vim` or Claude Code turns mouse tracking on by
      // writing to its own screen, and no notification says so. Throttled to
      // the same staleness as a drag's, so a chatty Pane costs one command a
      // second and a quiet one costs nothing.
      refreshState();
      readWhenSettled();

      // Dropped rather than written while the Pane is scrolled away: the
      // Surface is showing the past, and tmux is holding the present.
      if (back > 0) return;
      writeOutput(bytes);
    },

    click(column: number, row: number): boolean {
      if (disposed || selection) return false;
      // Only an application that asked for the mouse can do anything with a
      // click; sending one to a shell would paste a `[<0;…M` into the prompt.
      if (!state?.wantsMouse) return false;
      // A tap while scrolled back means the screen under the finger is not the
      // screen the application has, so the click would land somewhere else
      // entirely. Going back to the bottom is what the tap gets to mean.
      if (back > 0) {
        jumpToLatest();
        return true;
      }
      type(asciiBytes(clickSequence(column, row)));
      return true;
    },

    type,
    press,
    jumpToLatest,
    scrolledBack: () => back > 0,

    beginSelection(press: SurfacePoint): boolean {
      if (disposed || selection || surface === null || grid === null) return false;
      say(`Selection asked for at ${Math.round(press.x)},${Math.round(press.y)}`);
      selection = { press, known: null };
      schedule();
      return true;
    },

    endSelection,

    scroll(lines: number, size: Grid): void {
      if (disposed || lines === 0) return;

      // A gesture starting after a pause may be the first since the Pane began
      // running something else entirely, and what a scroll should become
      // depends on that.
      refreshState();

      if (state?.alternate) {
        // A frozen Pane sends its program nothing: the program would move a
        // screen that the Surface no longer follows.
        if (selection) return;
        if (state.wantsMouse) {
          // Back into notches, with the remainder carried rather than lost.
          wheelCarry += lines;
          const notches = Math.trunc(wheelCarry / LINES_PER_NOTCH);
          if (notches === 0) return;
          wheelCarry -= notches * LINES_PER_NOTCH;
          // Aimed at the middle of the Surface: a mouse event whose
          // coordinates fall outside the Pane is discarded, and the middle is
          // inside whichever Pane is filling the Window.
          const text = wheelSequence(
            notches > 0 ? 'up' : 'down',
            Math.abs(notches),
            Math.max(1, Math.round(size.cols / 2)),
            Math.max(1, Math.round(size.rows / 2)),
          );
          if (text !== '') type(asciiBytes(text));
          return;
        }
        // An application that never asked for the mouse would ignore a wheel
        // event entirely, so it gets the keys it does read — one per line.
        const text = cursorKeys(lines > 0 ? 'up' : 'down', Math.abs(lines));
        if (text !== '') type(asciiBytes(text));
        return;
      }

      const next = clampBack(back + lines, state?.scrollbackLines ?? 0);
      if (next === back) return;
      back = next;
      schedule();
    },

    dispose(): void {
      if (!disposed) say('disposed');
      disposed = true;
      clock.cancel(settleTimer);
      settleTimer = null;
      surface = null;
      selection = null;
      outgoing = [];
      held = null;
    },
  };
}

/**
 * The row the keyboard must not cover: the cursor's, except on the alternate
 * screen.
 *
 * A shell after a `clear` has its text at the top and the row being typed on
 * under it, so following the cursor keeps that text in sight. A full-screen
 * program puts its status line at the bottom, under its cursor: Claude Code
 * types on a row with three rows of footer below it, and vim's status line is
 * under the text being edited. So on the alternate screen the last row is the
 * one kept in sight, as ADR 0008 says.
 */
function rowInSight(state: PaneState): number {
  return state.alternate ? state.height - 1 : state.cursorRow;
}
