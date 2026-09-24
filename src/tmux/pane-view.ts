import type { Clock, Timer } from '@/lib/clock';
import { systemClock } from '@/lib/clock';
import { clickSequence, cursorKeys, LINES_PER_NOTCH, wheelSequence } from '@/lib/mouse-wheel';

import { asciiBytes, clampBack, paintScreen, scrollbackRange } from './pane-screen';
import { sameGrid, type Grid, type PaneState } from './tmux-client';

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
   * Told rather than asked, and told every time: the view decides which of
   * them is worth painting at. A Surface reports its grid before it has been
   * laid out, and a Pane painted at that one is a Pane eleven rows tall whose
   * resync wrapped away to nothing.
   */
  reportGrid(grid: Grid): void;
  /**
   * Whether this is the Pane the keyboard and the Dock are about.
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
   * The Key Bar's path. A name rather than the bytes for it, because which
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
   * Whether the Surface is showing the past rather than the present.
   *
   * What a tap means depends on it: a tap on a Pane that has been dragged back
   * spends itself returning to the bottom, and is not the tap that also wanted
   * the keyboard.
   */
  scrolledBack(): boolean;
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
 * How long a newly mounted Surface is given before anything is written to it.
 *
 * Measured rather than cautious. A Surface that has just mounted reports its
 * grid before it will accept anything written to it: the resync ran, the bytes
 * went out, and the Pane stayed blank — while the Surface that had been on
 * screen all along, the one the split grew out of, painted perfectly. Whatever
 * the library is still doing at that moment, it is done well inside this.
 *
 * Exported so the test that holds it to its value can name it.
 */
export const PAINT_SETTLE_MS = 250;

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
 * as facts, paints when it has both and the library has had its moment, and
 * reads the grid at the moment it paints rather than when the wait began.
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
  options: { clock?: Clock } = {},
): PaneView {
  const clock = options.clock ?? systemClock;

  let disposed = false;
  let paused = false;

  /** Where the bytes go, or null while this Pane has no Surface. */
  let surface: PaneSurface | null = null;
  /**
   * Which Surface a repaint was started for, so one that lands after the
   * Surface was swapped does not paint the new one with the old one's screen.
   */
  let generation = 0;
  /** When the current Surface mounted, which is what the settling waits from. */
  let mountedAt = 0;
  let paintTimer: Timer | null = null;

  /** The grid the Surface last reported, and the one it was last painted at. */
  let grid: Grid | null = null;
  let paintedGrid: Grid | null = null;
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
   * burst of them coalesces into one `send-keys -H`. A Key Bar key is a
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

  function report(error: unknown): void {
    if (!disposed) events.onError?.(error);
  }

  /** The one way anything reaches the Surface. */
  function write(bytes: Uint8Array): void {
    if (disposed || paused) return;
    surface?.write(bytes);
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

  /**
   * Reads what the Pane is doing, but no more often than it can change in a
   * way that matters. A Control Command per frame of a drag is what made
   * dragging feel like it was catching on something.
   */
  function refreshState(): void {
    if (clock.now() - stateReadAt < STATE_STALE_MS) return;
    stateReadAt = clock.now();
    void reader
      .paneState(paneId)
      .then((next) => {
        if (disposed || !next) return;
        state = next;
        announce();
        announceMouse();
      })
      .catch(report);
  }

  /** Paints whatever the Pane should be showing right now. */
  async function repaint(): Promise<void> {
    const mine = generation;
    if (surface === null) return;

    if (back > 0) {
      const { start, end } = scrollbackRange(back, rows);
      const lines = await reader.captureScrollback(paneId, start, end);
      if (disposed || mine !== generation) return;
      // No cursor: a view of the Scrollback has none in it, and one parked in
      // the middle of old output reads as a prompt that is not there.
      write(paintScreen({ lines, alternate: false }));
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
      if (disposed || mine !== generation) return;
      if (next) {
        state = next;
        stateReadAt = clock.now();
        announceMouse();
      }
      write(
        paintScreen({
          lines,
          alternate: next?.alternate ?? false,
          // Where it is, and whether it is drawn, are two different questions:
          // an unattended Pane's cursor still moves with its output.
          cursor: next ? { column: next.cursorColumn, row: next.cursorRow } : undefined,
          cursorVisible,
        }),
      );
      if (!paused) events.onPainted?.();
    } finally {
      // Written after the repaint and in the order it arrived, so the last
      // second of the Pane's life lands on top of it rather than under it.
      if (held === buffer) held = null;
      if (!disposed && mine === generation) for (const bytes of buffer) writeOutput(bytes);
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
   * Allowed means: a Surface, a grid, and the library's settling period since
   * that Surface mounted. The grid is read when the timer fires rather than
   * when it was set, which is what keeps the pre-layout value out of the
   * paint: by then the real one has arrived and replaced it.
   */
  function armPaint(): void {
    if (disposed || paused || surface === null || grid === null) return;
    if (paintTimer !== null) return;
    if (paintedGrid !== null && sameGrid(grid, paintedGrid)) return;

    const due = Math.max(0, mountedAt + PAINT_SETTLE_MS - clock.now());
    paintTimer = clock.after(due, () => {
      paintTimer = null;
      if (disposed || paused || surface === null) return;
      const latest = grid;
      if (latest === null) return;
      if (paintedGrid !== null && sameGrid(latest, paintedGrid)) return;
      paintedGrid = latest;
      rows = Math.max(1, Math.floor(latest.rows));
      schedule();
    });
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
   * One named key, from the Key Bar.
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
      clock.cancel(paintTimer);
      paintTimer = null;
      // Everything in flight for the Surface that is going belongs to it.
      generation += 1;
      surface = next;
      held = null;
      // A Surface arrives blank, so what it is showing is nothing rather than
      // wherever the last one had been dragged back to.
      back = 0;
      paintedGrid = null;
      if (next === null) return;
      mountedAt = clock.now();
      armPaint();
    },

    reportGrid(next: Grid): void {
      if (disposed) return;
      if (grid !== null && sameGrid(next, grid)) return;
      grid = { cols: next.cols, rows: next.rows };
      // A later grid is a resize. tmux redraws every Pane it resizes, so the
      // bytes are on their way already — but the capture is what makes a Pane
      // that was never painted at its real size right, and the rows are what
      // a Scrollback capture is cut to.
      armPaint();
    },

    setActive(active: boolean): void {
      if (disposed || active === cursorVisible) return;
      cursorVisible = active;
      write(asciiBytes(active ? '\u001b[?25h' : '\u001b[?25l'));
    },

    focusKeyboard(): void {
      if (!disposed) surface?.focus();
    },

    async toggleKeyboard(): Promise<void> {
      const current = surface;
      if (disposed || !current) return;
      // Asked of the Surface rather than of a global keyboard listener: React
      // Native's registry never heard of this view — the Surface is a native
      // text input it never registered — so the only honest answer to "is the
      // keyboard up on *this* Pane" is the Surface's own. A listener that saw
      // the keyboard rise over the other half of a split says yes, and
      // toggling on that answer blurs a Surface that was not focused.
      const focused = await current.isFocused();
      if (disposed || surface !== current) return;
      if (focused) current.blur();
      else current.focus();
    },

    keyboardFocused: () => surface?.isFocused() ?? Promise.resolve(false),

    setPaused(next: boolean): void {
      if (disposed || next === paused) return;
      paused = next;
      if (next) {
        clock.cancel(paintTimer);
        paintTimer = null;
        return;
      }
      // What arrived while nobody was looking is not worth replaying; the
      // capture is the truth, exactly as it is after any resync.
      paintedGrid = null;
      armPaint();
    },

    receive(bytes: Uint8Array): void {
      if (disposed || paused) return;
      if (held !== null) {
        held.push(bytes);
        return;
      }
      // Output is the only sign that what the Pane is running may have
      // changed — starting `vim` or Claude Code turns mouse tracking on by
      // writing to its own screen, and no notification says so. Throttled to
      // the same staleness as a drag's, so a chatty Pane costs one command a
      // second and a quiet one costs nothing.
      refreshState();

      // Dropped rather than written while the Pane is scrolled away: the
      // Surface is showing the past, and tmux is holding the present.
      if (back > 0) return;
      writeOutput(bytes);
    },

    click(column: number, row: number): boolean {
      if (disposed) return false;
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

    scroll(lines: number, size: Grid): void {
      if (disposed || lines === 0) return;

      // A gesture starting after a pause may be the first since the Pane began
      // running something else entirely, and what a scroll should become
      // depends on that.
      refreshState();

      if (state?.alternate) {
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
      disposed = true;
      clock.cancel(paintTimer);
      paintTimer = null;
      surface = null;
      outgoing = [];
      held = null;
    },
  };
}
