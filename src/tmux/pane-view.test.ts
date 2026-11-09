import { createTestClock } from '@/lib/test-clock';

import {
  createPaneView,
  OUTPUT_SETTLE_MS,
  type PaneReader,
  type PaneSurface,
  type ScrollPosition,
} from './pane-view';
import type { Grid, PaneState } from './tmux-client';

const bytes = (text: string) => new TextEncoder().encode(text);
const shown = (written: Uint8Array[]) =>
  written
    .map((chunk) => Array.from(chunk, (byte) => String.fromCharCode(byte)).join(''))
    .join('')
    .replace(//g, '<ESC>');

const GRID: Grid = { cols: 80, rows: 24 };
/** What a Surface says before it has been laid out. */
const PRE_LAYOUT: Grid = { cols: 32, rows: 11 };

const paneState = (over: Partial<PaneState> = {}): PaneState => ({
  cursorColumn: 0,
  cursorRow: 0,
  alternate: false,
  scrollbackLines: 100,
  width: 80,
  height: 24,
  wantsMouse: false,
  cursorShown: true,
  bracketedPaste: true,
  ...over,
});

/** A tmux whose answers the test sets, and which records what it was asked. */
function fakePane(state: PaneState = paneState()) {
  const asked: string[] = [];
  const sent: Uint8Array[] = [];
  let screen = ['live'];
  let scrollback = ['old'];
  /** While set, every capture waits; `hold()` returns the way to let them go. */
  let holding = false;
  const waiting: (() => void)[] = [];

  const reader: PaneReader = {
    async paneState(paneId) {
      asked.push(`state ${paneId}`);
      return state;
    },
    async capturePane(paneId) {
      asked.push(`capture ${paneId}`);
      if (holding) await new Promise<void>((resolve) => waiting.push(resolve));
      return screen.map(bytes);
    },
    async captureScrollback(paneId, start, end) {
      asked.push(`scrollback ${paneId} ${start}..${end}`);
      return scrollback.map(bytes);
    },
    async sendKeys(paneId, data) {
      asked.push(`keys ${paneId}`);
      sent.push(data);
    },
    async sendKey(paneId, key) {
      asked.push(`key ${paneId} ${key}`);
    },
  };

  return {
    reader,
    asked,
    sent,
    set state(next: PaneState) {
      state = next;
    },
    set screen(next: string[]) {
      screen = next;
    },
    set scrollback(next: string[]) {
      scrollback = next;
    },
    /** Makes captures wait; returns the function that lets them all go. */
    hold(): () => void {
      holding = true;
      return () => {
        holding = false;
        for (const resume of waiting.splice(0)) resume();
      };
    },
  };
}

/**
 * A Surface that records everything written to it, and whether it has the
 * keyboard.
 *
 * The second of the two adapters the seam is there for: `expo-libghostty` in
 * production, this in the tests. It is what makes "the ref arrived after the
 * grid" a test case rather than a device session.
 */
function fakeSurface() {
  const written: Uint8Array[] = [];
  const keyboard: string[] = [];
  let focused = false;

  const surface: PaneSurface = {
    write: (data) => written.push(data),
    focus: () => {
      focused = true;
      keyboard.push('focus');
    },
    blur: () => {
      focused = false;
      keyboard.push('blur');
    },
    isFocused: () => Promise.resolve(focused),
  };

  return {
    surface,
    written,
    keyboard,
    focused: () => focused,
    /** The keyboard moving to some other Surface, as far as this one can tell. */
    lose(): void {
      focused = false;
    },
  };
}

function viewOn(host: ReturnType<typeof fakePane>, paneId = '%0') {
  const positions: (ScrollPosition | null)[] = [];
  const errors: unknown[] = [];
  const mouse: boolean[] = [];
  const cursor: number[] = [];
  const paints: number[] = [];
  const clock = createTestClock();
  const screen = fakeSurface();

  const view = createPaneView(
    paneId,
    host.reader,
    {
      onScroll: (position) => positions.push(position),
      onError: (error) => errors.push(error),
      onMouseTracking: (wanted) => mouse.push(wanted),
      onCursor: (row) => cursor.push(row),
      onPainted: () => paints.push(clock.now()),
    },
    { clock },
  );

  return {
    view,
    screen,
    written: screen.written,
    positions,
    errors,
    mouse,
    cursor,
    paints,
    clock,
    tick: (ms: number) => clock.advance(ms),
  };
}

/** The ordinary way a Pane comes up: a Surface and a grid, in that order. */
async function paints(kit: ReturnType<typeof viewOn>, grid: Grid = GRID): Promise<void> {
  kit.view.setSurface(kit.screen.surface);
  kit.view.reportGrid(grid);
  await settle();
}

/** Lets every queued promise run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

describe('deciding when a Pane may be painted', () => {
  it('paints once it has a Surface and then a grid', async () => {
    const host = fakePane();
    host.screen = ['first line', 'second line'];
    const kit = viewOn(host, '%2');

    kit.view.setSurface(kit.screen.surface);
    kit.view.reportGrid(GRID);
    await settle();

    expect(shown(kit.written)).toContain('first line\r\nsecond line');
    expect(host.asked).toContain('capture %2');
  });

  it('paints just as readily when the grid arrived before the Surface', async () => {
    // The bug: one Pane of a split had its grid before its ref, and so was
    // never painted at all. Whichever comes last has to do the painting.
    const host = fakePane();
    host.screen = ['it painted'];
    const kit = viewOn(host);

    kit.view.reportGrid(GRID);
    kit.clock.advance(1000);
    expect(kit.written).toHaveLength(0);

    kit.view.setSurface(kit.screen.surface);
    await settle();

    expect(shown(kit.written)).toContain('it painted');
  });

  it('waits on nothing but the two facts: no timer stands between them and the paint', async () => {
    // There used to be a quarter of a second here, measured against a Surface
    // that dropped early writes. The Surface holds them itself now, so a
    // Pane with both halves is a Pane being captured this very turn.
    const host = fakePane();
    const kit = viewOn(host);

    kit.view.setSurface(kit.screen.surface);
    kit.view.reportGrid(GRID);
    expect(host.asked).toContain('capture %0');
  });

  it('ends up painted at the real grid when the pre-layout one came first', async () => {
    const host = fakePane();
    const kit = viewOn(host);

    kit.view.setSurface(kit.screen.surface);
    kit.view.reportGrid(PRE_LAYOUT);
    kit.clock.advance(6);
    kit.view.reportGrid(GRID);
    await settle();

    // The Scrollback is cut to the real grid's rows, whatever was painted first.
    kit.view.scroll(4, GRID);
    await settle();
    expect(host.asked).toContain('scrollback %0 -4..19');
  });

  it('repaints when a later grid is a real change', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    host.asked.length = 0;

    kit.view.reportGrid({ cols: 80, rows: 12 });
    kit.clock.advance(1);
    await settle();

    expect(host.asked.filter((each) => each.startsWith('capture'))).toHaveLength(1);
  });

  it('repaints when the same grid is reported again, because the Surface underneath is new', async () => {
    // The Surface reports once per grid per surface the library has built
    // under it. The same grid twice is therefore never a repeat: it is a
    // surface rebuilt blank at the old size, and a Pane that shrugged it off
    // was a Pane showing nothing with no way to notice.
    const host = fakePane();
    host.screen = ['still here'];
    const kit = viewOn(host);
    await paints(kit);
    host.asked.length = 0;
    kit.written.length = 0;

    kit.view.reportGrid(GRID);
    await settle();

    expect(host.asked.filter((each) => each.startsWith('capture'))).toHaveLength(1);
    expect(shown(kit.written)).toContain('still here');
  });
});

describe('a Pane that loses its Surface and gains another', () => {
  it('writes nothing while it has none', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.setSurface(null);
    kit.view.receive(bytes('output while away'));
    kit.clock.advance(1000);
    await settle();

    expect(kit.written).toHaveLength(0);
  });

  it('resyncs from a fresh capture when a new one arrives', async () => {
    // Home, and back again. The Attach never went away, so the Connection is
    // not remade — but the Surface is new and blank, and what is on the Pane
    // now is the truth rather than what was on it when the screen left.
    const host = fakePane();
    host.screen = ['as it was'];
    const kit = viewOn(host);
    await paints(kit);

    kit.view.setSurface(null);
    host.screen = ['as it is now'];
    const second = fakeSurface();

    kit.view.setSurface(second.surface);
    kit.view.reportGrid(GRID);
    await settle();

    expect(shown(second.written)).toContain('as it is now');
  });

  it('waits for the new Surface to report rather than painting it at the old one’s grid', async () => {
    // Every Surface reports its grid, so the one arriving will say what it
    // is. Painting it at the last one's grid first was a capture spent on a
    // guess — and a wrong one after a rotation while the screen was away.
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.setSurface(null);
    host.asked.length = 0;

    const second = fakeSurface();
    kit.view.setSurface(second.surface);
    await settle();
    expect(host.asked).toEqual([]);

    kit.view.reportGrid({ cols: 80, rows: 12 });
    await settle();
    expect(host.asked.filter((each) => each.startsWith('capture'))).toHaveLength(1);
  });

  it('does not paint the new Surface with the screen the old one asked for', async () => {
    const host = fakePane();
    host.screen = ['for the first'];
    const release = host.hold();
    const kit = viewOn(host);

    kit.view.setSurface(kit.screen.surface);
    kit.view.reportGrid(GRID);

    const second = fakeSurface();
    kit.view.setSurface(second.surface);
    kit.view.reportGrid(GRID);

    host.screen = ['for the second'];
    release();
    await settle();

    expect(shown(second.written)).not.toContain('for the first');
    expect(shown(second.written)).toContain('for the second');
  });
});

describe('the app going to the background', () => {
  it('writes nothing to a Surface nobody is looking at', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.setPaused(true);
    kit.view.receive(bytes('output while suspended'));
    kit.clock.advance(1000);
    await settle();

    expect(kit.written).toHaveLength(0);
  });

  it('resyncs on the way back rather than replaying what was missed', async () => {
    const host = fakePane();
    host.screen = ['before'];
    const kit = viewOn(host);
    await paints(kit);

    kit.view.setPaused(true);
    host.screen = ['after'];
    kit.view.setPaused(false);
    await settle();

    expect(shown(kit.written)).toContain('after');
  });
});

describe('showing a Pane', () => {
  it('puts the cursor back where tmux says it is', async () => {
    const host = fakePane(paneState({ cursorColumn: 12, cursorRow: 3 }));
    const kit = viewOn(host);
    await paints(kit);
    expect(shown(kit.written)).toContain('<ESC>[4;13H');
  });

  it('reads the screen and the cursor in one round trip', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    // Both written before either is answered, which is what makes it one.
    expect(host.asked.slice(0, 2).sort()).toEqual(['capture %0', 'state %0']);
  });

  it('streams output once the repaint has landed', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.receive(bytes('after'));
    expect(shown(kit.written)).toBe('after');
  });

  it('holds output that arrives mid-repaint, and writes it on top', async () => {
    const host = fakePane();
    host.screen = ['painted'];
    const release = host.hold();
    const kit = viewOn(host);

    kit.view.setSurface(kit.screen.surface);
    kit.view.reportGrid(GRID);
    await settle();

    kit.view.receive(bytes('while painting'));
    expect(kit.written).toHaveLength(0);

    release();
    await settle();

    const text = shown(kit.written);
    expect(text.indexOf('painted')).toBeLessThan(text.indexOf('while painting'));
  });

  it('tells the Screen a repaint landed, which is what clears a line of trouble', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    expect(kit.paints).toHaveLength(1);
  });
});

describe('typing', () => {
  it('sends what was typed to the Pane', async () => {
    const host = fakePane();
    const kit = viewOn(host, '%4');
    await paints(kit);

    kit.view.type(bytes('hi'));
    await settle();

    expect(host.sent.map((data) => shown([data]))).toEqual(['hi']);
    expect(host.asked).toContain('keys %4');
  });

  it('batches a burst into one command rather than one per keystroke', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);

    // The first goes at once — a Surface waiting for its own echo feels
    // broken — and everything typed during that round trip follows as one.
    kit.view.type(bytes('a'));
    kit.view.type(bytes('b'));
    kit.view.type(bytes('c'));
    await settle();

    expect(host.sent.map((data) => shown([data]))).toEqual(['a', 'bc']);
  });

  it('carries bytes no keyboard has, unchanged', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);

    kit.view.type(Uint8Array.of(0x1b, 0x5b, 0x41, 0xff));
    await settle();

    expect([...host.sent[0]]).toEqual([0x1b, 0x5b, 0x41, 0xff]);
  });

  it('spends a keystroke getting back to the bottom, and does not forward it', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(2, GRID);
    await settle();
    host.sent.length = 0;

    kit.view.type(bytes('x'));
    await settle();

    expect(host.sent).toHaveLength(0);
    expect(kit.positions[kit.positions.length - 1]).toBeNull();
  });
});

describe('a key from the Key Row', () => {
  it('sends tmux the name, not the bytes', async () => {
    const host = fakePane();
    const kit = viewOn(host, '%4');
    await paints(kit);

    kit.view.press('Up');
    await settle();

    expect(host.asked).toContain('key %4 Up');
  });

  it('arrives where it was pressed, not past what was typed before it', async () => {
    // A named key cannot be merged into a `send-keys -H` of typed bytes, so
    // the two share one queue. Sending it straight out would put an arrow
    // pressed mid-burst *before* the letters typed ahead of it.
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);

    kit.view.type(bytes('a'));
    kit.view.type(bytes('b'));
    kit.view.press('C-c');
    kit.view.type(bytes('c'));
    await settle();

    expect(host.asked.filter((each) => each.startsWith('key') || each === 'keys %0')).toEqual([
      'keys %0',
      'keys %0',
      'key %0 C-c',
      'keys %0',
    ]);
    expect(host.sent.map((data) => shown([data]))).toEqual(['a', 'b', 'c']);
  });

  it('spends itself getting back to the bottom, like a keystroke', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(2, GRID);
    await settle();
    host.asked.length = 0;

    kit.view.press('Up');
    await settle();

    expect(host.asked.some((each) => each.startsWith('key '))).toBe(false);
    expect(kit.positions[kit.positions.length - 1]).toBeNull();
  });
});

describe('the keyboard, which belongs to the Surface', () => {
  it('raises it on a Pane whose Surface does not have it', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);

    await kit.view.toggleKeyboard();

    expect(kit.screen.keyboard).toEqual(['focus']);
    await expect(kit.view.keyboardFocused()).resolves.toBe(true);
  });

  it('dismisses it on one that does', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.focusKeyboard();
    kit.screen.keyboard.length = 0;

    await kit.view.toggleKeyboard();

    expect(kit.screen.keyboard).toEqual(['blur']);
  });

  it('asks the Surface rather than believing a listener that never saw it', async () => {
    // React Native's keyboard registry never heard of this view, so a global
    // "the keyboard is up" is about some other Surface as often as this one.
    // Toggling on that answer blurred a Surface that was not focused.
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.focusKeyboard();

    // The keyboard moves to the other half of a split. The phone still says a
    // keyboard is up; this Surface knows it is not the one with it.
    kit.screen.lose();
    kit.screen.keyboard.length = 0;

    await kit.view.toggleKeyboard();

    expect(kit.screen.keyboard).toEqual(['focus']);
  });

  it('does nothing at all for a Pane with no Surface', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await kit.view.toggleKeyboard();
    await expect(kit.view.keyboardFocused()).resolves.toBe(false);
  });
});

describe('scrolling a shell’s Scrollback', () => {
  it('paints the Scrollback tmux is holding, without entering copy-mode', async () => {
    const host = fakePane();
    host.scrollback = ['older output'];
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.scroll(10, GRID);
    await settle();

    // Ten lines back, a screen's worth from there.
    expect(host.asked).toContain('scrollback %0 -10..13');
    expect(shown(kit.written)).toContain('older output');
    expect(host.sent).toHaveLength(0);
  });

  it('says how far back it is, and how much Scrollback there is', async () => {
    const host = fakePane(paneState({ scrollbackLines: 240 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(15, GRID);
    await settle();

    expect(kit.positions[kit.positions.length - 1]).toEqual({ back: 15, scrollbackLines: 240 });
  });

  it('stops where tmux ran out of Scrollback', async () => {
    const host = fakePane(paneState({ scrollbackLines: 7 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(250, GRID);
    await settle();

    expect(kit.positions[kit.positions.length - 1]).toEqual({ back: 7, scrollbackLines: 7 });
  });

  it('reaches the bottom cleanly, cursor and all', async () => {
    const host = fakePane(paneState({ cursorColumn: 5, cursorRow: 1 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(10, GRID);
    await settle();
    kit.written.length = 0;

    kit.view.scroll(-50, GRID);
    await settle();

    expect(kit.positions[kit.positions.length - 1]).toBeNull();
    expect(shown(kit.written)).toContain('<ESC>[2;6H');
  });

  it('jumps back to the live bottom on request', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(20, GRID);
    await settle();

    kit.view.jumpToLatest();
    await settle();

    expect(kit.positions[kit.positions.length - 1]).toBeNull();
  });

  it('holds the past still while the Pane keeps writing', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(10, GRID);
    await settle();
    kit.written.length = 0;

    kit.view.receive(bytes('live output'));
    expect(kit.written).toHaveLength(0);
  });

  it('paints only where the flick ended, not everywhere it passed', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    host.asked.length = 0;

    kit.view.scroll(5, GRID);
    kit.view.scroll(5, GRID);
    kit.view.scroll(5, GRID);
    await settle();

    const captures = host.asked.filter((each) => each.startsWith('scrollback'));
    expect(captures).toHaveLength(2);
    expect(captures[captures.length - 1]).toBe('scrollback %0 -15..8');
  });

  it('has nowhere to go in a Pane with no Scrollback', async () => {
    const host = fakePane(paneState({ scrollbackLines: 0 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.positions.length = 0;

    kit.view.scroll(15, GRID);
    await settle();

    expect(host.asked.filter((each) => each.startsWith('scrollback'))).toHaveLength(0);
    expect(kit.positions).toEqual([]);
  });
});

describe('scrolling a full-screen application', () => {
  it('hands the wheel to one that asked for the mouse', async () => {
    const host = fakePane(paneState({ alternate: true, wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);

    kit.view.scroll(10, GRID);
    await settle();

    // Ten lines is two notches of the wheel, aimed at the middle of the
    // Surface.
    expect(shown(host.sent)).toBe('<ESC>[<64;40;12M<ESC>[<64;40;12M');
    expect(host.asked.filter((each) => each.startsWith('scrollback'))).toHaveLength(0);
  });

  it('sends cursor keys to one that did not, which would ignore a wheel', async () => {
    // `less` and `man` read nothing else; tmux 3.6 dropped the option that
    // used to do this translation.
    const host = fakePane(paneState({ alternate: true, wantsMouse: false }));
    const kit = viewOn(host);
    await paints(kit);

    kit.view.scroll(5, GRID);
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[A'.repeat(5));
  });

  it('carries a part-notch rather than dropping it', async () => {
    // A finger is not a wheel. Four lines is less than a notch, and throwing
    // the remainder away is a slow drag over `less` that moves nothing at all
    // — and a flick whose last, smallest frames count for nothing.
    const host = fakePane(paneState({ alternate: true, wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);

    kit.view.scroll(4, GRID);
    await settle();
    expect(host.sent).toHaveLength(0);

    kit.view.scroll(2, GRID);
    await settle();
    expect(shown(host.sent)).toBe('<ESC>[<64;40;12M');
  });

  it('scrolls down as readily as up', async () => {
    const host = fakePane(paneState({ alternate: true, wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);

    kit.view.scroll(-5, GRID);
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[<65;40;12M');
  });

  it('follows the Pane changing what it is running', async () => {
    const host = fakePane(paneState({ alternate: false, scrollbackLines: 0 }));
    const kit = viewOn(host);
    await paints(kit);

    // `less` starts, which nothing tells this view about.
    host.state = paneState({ alternate: true, wantsMouse: false });

    // A gesture while the reading is still fresh is routed by what was true
    // when it was taken.
    kit.view.scroll(5, GRID);
    await settle();
    expect(host.sent).toHaveLength(0);

    // Once it has gone stale, the gesture that finds it so asks again — so the
    // drag is routed by its second frame rather than by the next drag.
    kit.tick(2000);
    kit.view.scroll(5, GRID);
    await settle();
    kit.view.scroll(5, GRID);
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[A'.repeat(5));
  });
});

describe('a view that has been let go', () => {
  it('writes nothing more, and leaves no timer behind', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.dispose();
    kit.view.receive(bytes('too late'));
    kit.view.type(bytes('x'));
    kit.clock.advance(1000);

    await settle();
    expect(kit.written).toHaveLength(0);
    expect(host.sent).toHaveLength(0);
    expect(kit.clock.pending()).toBe(0);
  });
});

describe('tapping a Pane', () => {
  it('sends a click to an application that asked for the mouse', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);

    expect(kit.view.click(12, 5)).toBe(true);
    await settle();

    // Press and release together, so nothing is left held down.
    expect(shown(host.sent)).toBe('<ESC>[<0;12;5M<ESC>[<0;12;5m');
  });

  it('sends nothing to a shell, which would only see the escape as text', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const kit = viewOn(host);
    await paints(kit);

    expect(kit.view.click(12, 5)).toBe(false);
    await settle();
    expect(host.sent).toHaveLength(0);
  });

  it('spends a tap getting back to the bottom rather than clicking the past', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.scroll(2, GRID);
    await settle();
    host.sent.length = 0;

    expect(kit.view.click(12, 5)).toBe(true);
    await settle();

    expect(host.sent).toHaveLength(0);
    expect(kit.positions[kit.positions.length - 1]).toBeNull();
  });

  it('says nothing about a Pane it has never read', () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const kit = viewOn(host);
    expect(kit.view.click(1, 1)).toBe(false);
  });
});

describe('telling the Screen what a tap should mean', () => {
  it('reports mouse tracking when the Pane is first painted', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);
    expect(kit.mouse).toEqual([true]);
  });

  it('says nothing for a Pane that never wanted it', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const kit = viewOn(host);
    await paints(kit);
    expect(kit.mouse).toEqual([]);
  });

  it('notices an application turning it on, from output alone', async () => {
    // Nothing in the control protocol announces mouse tracking: an application
    // turns it on by writing to its own screen. Output is the only sign.
    const host = fakePane(paneState({ wantsMouse: false }));
    const kit = viewOn(host);
    await paints(kit);

    host.state = paneState({ wantsMouse: true });
    kit.tick(2000);
    kit.view.receive(bytes('claude starting'));
    await settle();

    expect(kit.mouse).toEqual([true]);
  });

  it('does not ask again for every byte of a chatty Pane', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const kit = viewOn(host);
    await paints(kit);
    host.asked.length = 0;

    for (let at = 0; at < 20; at += 1) kit.view.receive(bytes('noise'));
    await settle();

    expect(host.asked.filter((each) => each.startsWith('state'))).toHaveLength(0);
  });

  it('reports it turning off again', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const kit = viewOn(host);
    await paints(kit);

    host.state = paneState({ wantsMouse: false });
    kit.tick(2000);
    kit.view.receive(bytes('claude exited'));
    await settle();

    expect(kit.mouse).toEqual([true, false]);
  });
});

describe('which Pane draws a cursor', () => {
  it('draws one by default, because a single Pane is the Pane', async () => {
    const host = fakePane(paneState({ cursorColumn: 5, cursorRow: 1 }));
    const kit = viewOn(host);
    await paints(kit);
    expect(shown(kit.written)).toContain('<ESC>[2;6H');
  });

  it('hides it the moment the Pane stops being the one being typed in', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.setActive(false);

    expect(shown(kit.written)).toBe('<ESC>[?25l');
  });

  it('keeps it hidden through a repaint, rather than letting it back', async () => {
    const host = fakePane(paneState({ cursorColumn: 5, cursorRow: 1 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.setActive(false);
    kit.written.length = 0;

    // A resize, which is what makes tmux redraw and this view repaint.
    kit.view.reportGrid({ cols: 80, rows: 30 });
    kit.clock.advance(1);
    await settle();

    // Put where tmux has it all the same — see ScreenPaint.cursorVisible. A
    // hidden cursor that is nowhere in particular is one that reappears in the
    // wrong place the moment the Pane is tapped.
    expect(shown(kit.written)).toContain('<ESC>[2;6H');
    expect(shown(kit.written)).not.toContain('<ESC>[?25h');
  });

  it('leaves it hidden after a repaint when the application hid it', async () => {
    // Claude Code and Codex hide the terminal's cursor and draw their own. A
    // repaint that showed it anyway put a second, blue one beside theirs.
    const host = fakePane(paneState({ cursorColumn: 5, cursorRow: 1, cursorShown: false }));
    const kit = viewOn(host);
    await paints(kit);

    expect(shown(kit.written)).toContain('<ESC>[2;6H');
    expect(shown(kit.written)).not.toContain('<ESC>[?25h');
  });

  it('leaves it hidden when the Pane takes the keyboard, if the application hid it', async () => {
    const host = fakePane(paneState({ cursorShown: false }));
    const kit = viewOn(host);
    await paints(kit);
    kit.view.setActive(false);
    kit.written.length = 0;

    kit.view.setActive(true);

    expect(shown(kit.written)).not.toContain('<ESC>[?25h');
  });

  it('brings it back when the Pane takes the keyboard again', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.setActive(false);
    kit.written.length = 0;

    kit.view.setActive(true);

    expect(shown(kit.written)).toBe('<ESC>[?25h');
  });

  it('puts it back down when the application in the Pane asks for it back', async () => {
    // The real source of a second cursor, and the one a single instruction
    // could not close: an unattended Pane is still running something, and
    // anything that redraws — a TUI, a shell drawing its prompt — ends its
    // redraw with its own `?25h`. Told once at the start, the Pane simply had
    // its cursor handed back a moment later.
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.view.setActive(false);
    kit.written.length = 0;

    kit.view.receive(bytes('[?25hhello'));

    expect(shown(kit.written)).toBe('<ESC>[?25hhello<ESC>[?25l');
  });

  it('leaves the output of the Pane that has the keyboard alone', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;

    kit.view.receive(bytes('hello'));

    expect(shown(kit.written)).toBe('hello');
  });

  it('says nothing when asked for what it already does', async () => {
    const host = fakePane();
    const kit = viewOn(host);
    await paints(kit);
    kit.written.length = 0;
    kit.view.setActive(true);
    expect(kit.written).toHaveLength(0);
  });
});

describe('telling the Screen where the cursor is', () => {
  it('reports the row once the Pane is painted', async () => {
    const host = fakePane(paneState({ cursorRow: 7 }));
    const kit = viewOn(host);
    await paints(kit);
    expect(kit.cursor).toEqual([7]);
  });

  it('reads the Pane once more when its output stops', async () => {
    // The throttled readings are all taken before the chunk that prompted
    // them is written, so the last one of a burst describes the Pane as it was
    // before the burst finished. Thirty lines of output carry the cursor
    // under the keyboard, and the Window has to follow it. See readWhenSettled.
    const host = fakePane(paneState({ cursorRow: 7 }));
    const kit = viewOn(host);
    await paints(kit);

    host.state = paneState({ cursorRow: 37 });
    kit.view.receive(bytes('a burst'));
    kit.view.receive(bytes('and the rest of it'));
    await settle();
    // Nothing yet: the reading this burst triggered was taken before it landed.
    expect(kit.cursor).toEqual([7]);

    kit.tick(OUTPUT_SETTLE_MS);
    await settle();
    expect(kit.cursor).toEqual([7, 37]);
  });

  it('says nothing for a cursor that has not moved', async () => {
    const host = fakePane(paneState({ cursorRow: 7 }));
    const kit = viewOn(host);
    await paints(kit);

    kit.tick(2000);
    kit.view.receive(bytes('same row'));
    await settle();
    kit.tick(OUTPUT_SETTLE_MS);
    await settle();

    expect(kit.cursor).toEqual([7]);
  });

  it('asks no more than once for a burst, however many chunks it comes in', async () => {
    const host = fakePane(paneState({ cursorRow: 7 }));
    const kit = viewOn(host);
    await paints(kit);
    kit.tick(2000);
    host.asked.length = 0;

    for (let at = 0; at < 20; at += 1) {
      kit.view.receive(bytes('chunk'));
      kit.tick(OUTPUT_SETTLE_MS / 2);
    }
    await settle();
    kit.tick(OUTPUT_SETTLE_MS);
    await settle();

    // Three seconds of chunks: two throttled readings, a second and a half
    // apart, and one settled reading at the end. A chatty Pane costs three,
    // not twenty — and the settled one is the only one that saw the end.
    expect(host.asked.filter((each) => each.startsWith('state'))).toHaveLength(3);
  });
});
