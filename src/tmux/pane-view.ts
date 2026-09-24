import { clickSequence, cursorKeys, LINES_PER_NOTCH, wheelSequence } from '@/lib/mouse-wheel';

import { asciiBytes, clampBack, paintScreen, scrollbackRange } from './pane-screen';
import type { Grid, PaneState } from './tmux-client';

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
}

/** How far back through its Scrollback a Pane is being viewed. */
export interface ScrollPosition {
  /** Lines above the live bottom. Zero when live. */
  back: number;
  /** How long the Scrollback is, which is what tmux's `history-limit` allows. */
  scrollbackLines: number;
}

export interface PaneViewEvents {
  /** Bytes for the Surface. */
  write: (bytes: Uint8Array) => void;
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
  /** Something went wrong. Best effort; never fatal to the view. */
  onError?: (error: unknown) => void;
}

export interface PaneView {
  /** The Pane currently on screen, or '' before the first one. */
  paneId(): string;
  /** Points the Surface at a Pane and paints what is already on it. */
  show(paneId: string, rows: number): Promise<void>;
  /** Bytes tmux pushed for a Pane. Anything but the current one is dropped. */
  receive(paneId: string, bytes: Uint8Array): void;
  /** Bytes the user typed. */
  type(bytes: Uint8Array): void;
  /**
   * A scroll gesture, in wheel notches. Positive is back into the past. The
   * grid is only for the coordinates a wheel event has to carry.
   */
  scroll(notches: number, grid: Grid): void;
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
   * The Surface is a different height now.
   *
   * Only Scrollback captures care: the live view is repainted by tmux itself,
   * which redraws the Pane when the Client's size changes.
   */
  resize(rows: number): void;
  /**
   * Whether this Pane should draw a cursor at all.
   *
   * Only one Pane of a split has the keyboard, and a cursor in each of the
   * others says otherwise — it reads as several places to type. Applied now
   * and remembered, so the next repaint does not bring it back.
   */
  setCursorVisible(visible: boolean): void;
  /** Nothing more is wanted from this view. */
  dispose(): void;
}

/**
 * How long a reading of what the Pane is doing stays good enough to route a
 * scroll by. A drag that follows `less` starting should be routed by the
 * second notch, not the second drag.
 */
const STATE_STALE_MS = 1500;

/**
 * What the Surface is showing, for one Pane.
 *
 * Owns the three things that used to be spread between the Terminal Screen and
 * tmux's own state: the repaint that makes an Attach show something, the
 * stream of output after it, and what a drag does.
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
 */
export function createPaneView(
  reader: PaneReader,
  events: PaneViewEvents,
  options: { now?: () => number } = {},
): PaneView {
  const now = options.now ?? (() => Date.now());

  let pane = '';
  let rows = 24;
  let disposed = false;

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

  /** Output arriving mid-repaint, to be written once the repaint lands. */
  let held: Uint8Array[] | null = null;

  /** Bytes typed but not yet sent, and whether a send is in flight. */
  let typed: number[] = [];
  let sending = false;

  /** A repaint in flight, and the position asked for behind it. */
  let painting = false;
  let wanted = false;

  /** Whether this Pane draws a cursor. False for a Pane nobody is typing in. */
  let cursorVisible = true;

  function report(error: unknown): void {
    if (!disposed) events.onError?.(error);
  }

  function announce(): void {
    if (disposed) return;
    events.onScroll(
      back === 0 ? null : { back, scrollbackLines: state?.scrollbackLines ?? back },
    );
  }

  function announceMouse(): void {
    const wanted = state?.wantsMouse ?? false;
    if (disposed || wanted === reportedMouse) return;
    reportedMouse = wanted;
    events.onMouseTracking?.(wanted);
  }

  /**
   * Reads what the Pane is doing, but no more often than it can change in a
   * way that matters. A Control Command per frame of a drag is what made
   * dragging feel like it was catching on something.
   */
  function refreshState(): void {
    if (now() - stateReadAt < STATE_STALE_MS) return;
    stateReadAt = now();
    const asked = pane;
    void reader
      .paneState(asked)
      .then((next) => {
        if (disposed || asked !== pane || !next) return;
        state = next;
        announce();
        announceMouse();
      })
      .catch(report);
  }

  /** Paints whatever the Pane should be showing right now. */
  async function repaint(): Promise<void> {
    const asked = pane;
    if (asked === '') return;

    if (back > 0) {
      const { start, end } = scrollbackRange(back, rows);
      const lines = await reader.captureScrollback(asked, start, end);
      if (disposed || asked !== pane) return;
      // No cursor: a view of the Scrollback has none in it, and one parked in
      // the middle of old output reads as a prompt that is not there.
      events.write(paintScreen({ lines, alternate: false }));
      announce();
      return;
    }

    // This repaint's own buffer, not merely "the" buffer: two repaints can
    // overlap when a Pane is switched twice quickly, and the first one
    // finishing must not release the second one's held output.
    const mine: Uint8Array[] = [];
    held = mine;
    try {
      // Both go down the Connection together, so the screen and where its
      // cursor is cost one round trip rather than two.
      const [next, lines] = await Promise.all([
        reader.paneState(asked),
        reader.capturePane(asked),
      ]);
      if (disposed || asked !== pane) return;
      if (next) {
        state = next;
        stateReadAt = now();
        announceMouse();
      }
      events.write(
        paintScreen({
          lines,
          alternate: next?.alternate ?? false,
          cursor:
            next && cursorVisible
              ? { column: next.cursorColumn, row: next.cursorRow }
              : undefined,
        }),
      );
    } finally {
      // Written after the repaint and in the order it arrived, so the last
      // second of the Pane's life lands on top of it rather than under it.
      if (held === mine) held = null;
      if (!disposed && asked === pane) for (const bytes of mine) events.write(bytes);
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

  /** Sends everything typed since the last send, as one command. */
  function flushTyped(): void {
    if (sending || typed.length === 0 || pane === '') return;
    const bytes = Uint8Array.from(typed);
    typed = [];
    sending = true;
    void reader
      .sendKeys(pane, bytes)
      .catch(report)
      .finally(() => {
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
    for (const byte of bytes) typed.push(byte);
    flushTyped();
  }

  return {
    paneId: () => pane,

    async show(paneId: string, height: number): Promise<void> {
      pane = paneId;
      rows = Math.max(1, Math.floor(height));
      back = 0;
      state = undefined;
      stateReadAt = 0;
      typed = [];
      await repaint();
    },

    receive(paneId: string, bytes: Uint8Array): void {
      // One Surface, one Pane. Output for another Pane of the same Window is
      // tmux being helpful about something nobody is looking at — and it is
      // also what would make a real split possible; see ticket 08.
      if (disposed || paneId !== pane) return;
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
      events.write(bytes);
    },

    click(column: number, row: number): boolean {
      if (disposed || pane === '') return false;
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
    jumpToLatest,

    setCursorVisible(visible: boolean): void {
      if (disposed || visible === cursorVisible) return;
      cursorVisible = visible;
      events.write(asciiBytes(visible ? '\u001b[?25h' : '\u001b[?25l'));
    },

    resize(height: number): void {
      const next = Math.max(1, Math.floor(height));
      if (next === rows) return;
      rows = next;
      if (back > 0) schedule();
    },

    scroll(notches: number, grid: Grid): void {
      if (disposed || pane === '' || notches === 0) return;

      // A gesture starting after a pause may be the first since the Pane began
      // running something else entirely, and what a scroll should become
      // depends on that.
      refreshState();

      if (state?.alternate) {
        const direction = notches > 0 ? 'up' : 'down';
        const count = Math.abs(notches);
        const text = state.wantsMouse
          ? // Aimed at the middle of the Surface: a mouse event whose
            // coordinates fall outside the Pane is discarded, and the middle
            // is inside whichever Pane is filling the Window.
            wheelSequence(
              direction,
              count,
              Math.max(1, Math.round(grid.cols / 2)),
              Math.max(1, Math.round(grid.rows / 2)),
            )
          : // An application that never asked for the mouse would ignore a
            // wheel event entirely, so it gets the keys it does read.
            cursorKeys(direction, count * LINES_PER_NOTCH);
        if (text !== '') type(asciiBytes(text));
        return;
      }

      const next = clampBack(back + notches * LINES_PER_NOTCH, state?.scrollbackLines ?? 0);
      if (next === back) return;
      back = next;
      schedule();
    },

    dispose(): void {
      disposed = true;
      typed = [];
      held = null;
    },
  };
}
