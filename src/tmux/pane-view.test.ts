import { createPaneView, type PaneReader, type ScrollPosition } from './pane-view';
import type { PaneState } from './tmux-client';

const bytes = (text: string) => new TextEncoder().encode(text);
const shown = (written: Uint8Array[]) =>
  written
    .map((chunk) => Array.from(chunk, (byte) => String.fromCharCode(byte)).join(''))
    .join('')
    .replace(//g, '<ESC>');

const paneState = (over: Partial<PaneState> = {}): PaneState => ({
  cursorColumn: 0,
  cursorRow: 0,
  alternate: false,
  scrollbackLines: 100,
  width: 80,
  height: 24,
  wantsMouse: false,
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

function viewOn(host: ReturnType<typeof fakePane>) {
  const written: Uint8Array[] = [];
  const positions: (ScrollPosition | null)[] = [];
  const errors: unknown[] = [];
  const mouse: boolean[] = [];
  let clock = 0;

  const view = createPaneView(
    host.reader,
    {
      write: (data) => written.push(data),
      onScroll: (position) => positions.push(position),
      onError: (error) => errors.push(error),
      onMouseTracking: (wanted) => mouse.push(wanted),
    },
    { now: () => clock },
  );

  return {
    view,
    written,
    positions,
    errors,
    mouse,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('showing a Pane', () => {
  it('paints what is already on the screen, not an empty one', async () => {
    const host = fakePane();
    host.screen = ['first line', 'second line'];
    const { view, written } = viewOn(host);

    await view.show('%2', 24);

    expect(shown(written)).toContain('first line\r\nsecond line');
    expect(host.asked).toContain('capture %2');
  });

  it('puts the cursor back where tmux says it is', async () => {
    const host = fakePane(paneState({ cursorColumn: 12, cursorRow: 3 }));
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    expect(shown(written)).toContain('<ESC>[4;13H');
  });

  it('reads the screen and the cursor in one round trip', async () => {
    const host = fakePane();
    const { view } = viewOn(host);
    await view.show('%0', 24);
    // Both written before either is answered, which is what makes it one.
    expect(host.asked.slice(0, 2).sort()).toEqual(['capture %0', 'state %0']);
  });

  it('streams output once the repaint has landed', async () => {
    const host = fakePane();
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    written.length = 0;

    view.receive('%0', bytes('after'));
    expect(shown(written)).toBe('after');
  });

  it('holds output that arrives mid-repaint, and writes it on top', async () => {
    const host = fakePane();
    host.screen = ['painted'];
    const release = host.hold();
    const { view, written } = viewOn(host);

    const showing = view.show('%0', 24);
    view.receive('%0', bytes('while painting'));
    expect(written).toHaveLength(0);

    release();
    await showing;

    const text = shown(written);
    expect(text.indexOf('painted')).toBeLessThan(text.indexOf('while painting'));
  });

  it('does not let one repaint release another’s held output', async () => {
    // Two Pane switches in quick succession: the first repaint finishing must
    // not write out what the second one is still holding.
    const host = fakePane();
    const release = host.hold();
    const { view, written } = viewOn(host);

    const first = view.show('%0', 24);
    const second = view.show('%1', 24);
    view.receive('%1', bytes('for the second'));
    expect(written).toHaveLength(0);

    release();
    await Promise.all([first, second]);

    // Held output belongs to the Pane it was held for, and lands after it.
    const text = shown(written);
    expect(text).toContain('for the second');
    expect(text.indexOf('for the second')).toBeGreaterThan(text.lastIndexOf('<ESC>[2J'));
  });

  it('drops output for a Pane nobody is looking at', async () => {
    const host = fakePane();
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    written.length = 0;

    view.receive('%3', bytes('somewhere else'));
    expect(written).toHaveLength(0);
  });

  it('repaints from the new Pane when the view is pointed at one', async () => {
    const host = fakePane();
    host.screen = ['first pane'];
    const { view, written } = viewOn(host);
    await view.show('%0', 24);

    host.screen = ['second pane'];
    written.length = 0;
    await view.show('%1', 24);

    expect(shown(written)).toContain('second pane');
    expect(view.paneId()).toBe('%1');
  });
});

describe('typing', () => {
  it('sends what was typed to the Pane', async () => {
    const host = fakePane();
    const { view } = viewOn(host);
    await view.show('%4', 24);

    view.type(bytes('hi'));
    await settle();

    expect(host.sent.map((data) => shown([data]))).toEqual(['hi']);
    expect(host.asked).toContain('keys %4');
  });

  it('batches a burst into one command rather than one per keystroke', async () => {
    const host = fakePane();
    const { view } = viewOn(host);
    await view.show('%0', 24);

    // The first goes at once — a Surface waiting for its own echo feels
    // broken — and everything typed during that round trip follows as one.
    view.type(bytes('a'));
    view.type(bytes('b'));
    view.type(bytes('c'));
    await settle();

    expect(host.sent.map((data) => shown([data]))).toEqual(['a', 'bc']);
  });

  it('carries bytes no keyboard has, unchanged', async () => {
    const host = fakePane();
    const { view } = viewOn(host);
    await view.show('%0', 24);

    view.type(Uint8Array.of(0x1b, 0x5b, 0x41, 0xff));
    await settle();

    expect([...host.sent[0]]).toEqual([0x1b, 0x5b, 0x41, 0xff]);
  });

  it('spends a keystroke getting back to the bottom, and does not forward it', async () => {
    const host = fakePane();
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(2, { cols: 80, rows: 24 });
    await settle();
    host.sent.length = 0;

    view.type(bytes('x'));
    await settle();

    expect(host.sent).toHaveLength(0);
    expect(positions[positions.length - 1]).toBeNull();
  });
});

describe('scrolling a shell’s Scrollback', () => {
  it('paints the Scrollback tmux is holding, without entering copy-mode', async () => {
    const host = fakePane();
    host.scrollback = ['older output'];
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    written.length = 0;

    view.scroll(2, { cols: 80, rows: 24 });
    await settle();

    // Two notches of five lines each, a screen's worth from there.
    expect(host.asked).toContain('scrollback %0 -10..13');
    expect(shown(written)).toContain('older output');
    expect(host.sent).toHaveLength(0);
  });

  it('says how far back it is, and how much Scrollback there is', async () => {
    const host = fakePane(paneState({ scrollbackLines: 240 }));
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(3, { cols: 80, rows: 24 });
    await settle();

    expect(positions[positions.length - 1]).toEqual({ back: 15, scrollbackLines: 240 });
  });

  it('stops where tmux ran out of Scrollback', async () => {
    const host = fakePane(paneState({ scrollbackLines: 7 }));
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(50, { cols: 80, rows: 24 });
    await settle();

    expect(positions[positions.length - 1]).toEqual({ back: 7, scrollbackLines: 7 });
  });

  it('reaches the bottom cleanly, cursor and all', async () => {
    const host = fakePane(paneState({ cursorColumn: 5, cursorRow: 1 }));
    const { view, written, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(2, { cols: 80, rows: 24 });
    await settle();
    written.length = 0;

    view.scroll(-10, { cols: 80, rows: 24 });
    await settle();

    expect(positions[positions.length - 1]).toBeNull();
    expect(shown(written)).toContain('<ESC>[2;6H');
  });

  it('jumps back to the live bottom on request', async () => {
    const host = fakePane();
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(4, { cols: 80, rows: 24 });
    await settle();

    view.jumpToLatest();
    await settle();

    expect(positions[positions.length - 1]).toBeNull();
  });

  it('holds the past still while the Pane keeps writing', async () => {
    const host = fakePane();
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(2, { cols: 80, rows: 24 });
    await settle();
    written.length = 0;

    view.receive('%0', bytes('live output'));
    expect(written).toHaveLength(0);
  });

  it('paints only where the flick ended, not everywhere it passed', async () => {
    const host = fakePane();
    const { view } = viewOn(host);
    await view.show('%0', 24);
    host.asked.length = 0;

    view.scroll(1, { cols: 80, rows: 24 });
    view.scroll(1, { cols: 80, rows: 24 });
    view.scroll(1, { cols: 80, rows: 24 });
    await settle();

    const captures = host.asked.filter((each) => each.startsWith('scrollback'));
    expect(captures).toHaveLength(2);
    expect(captures[captures.length - 1]).toBe('scrollback %0 -15..8');
  });

  it('has nowhere to go in a Pane with no Scrollback', async () => {
    const host = fakePane(paneState({ scrollbackLines: 0 }));
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    positions.length = 0;

    view.scroll(3, { cols: 80, rows: 24 });
    await settle();

    expect(host.asked.filter((each) => each.startsWith('scrollback'))).toHaveLength(0);
    expect(positions).toEqual([]);
  });
});

describe('scrolling a full-screen application', () => {
  it('hands the wheel to one that asked for the mouse', async () => {
    const host = fakePane(paneState({ alternate: true, wantsMouse: true }));
    const { view } = viewOn(host);
    await view.show('%0', 24);

    view.scroll(2, { cols: 80, rows: 24 });
    await settle();

    // SGR wheel-up, twice, aimed at the middle of the Surface.
    expect(shown(host.sent)).toBe('<ESC>[<64;40;12M<ESC>[<64;40;12M');
    expect(host.asked.filter((each) => each.startsWith('scrollback'))).toHaveLength(0);
  });

  it('sends cursor keys to one that did not, which would ignore a wheel', async () => {
    // `less` and `man` read nothing else; tmux 3.6 dropped the option that
    // used to do this translation.
    const host = fakePane(paneState({ alternate: true, wantsMouse: false }));
    const { view } = viewOn(host);
    await view.show('%0', 24);

    view.scroll(1, { cols: 80, rows: 24 });
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[A'.repeat(5));
  });

  it('scrolls down as readily as up', async () => {
    const host = fakePane(paneState({ alternate: true, wantsMouse: true }));
    const { view } = viewOn(host);
    await view.show('%0', 24);

    view.scroll(-1, { cols: 80, rows: 24 });
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[<65;40;12M');
  });

  it('follows the Pane changing what it is running', async () => {
    const host = fakePane(paneState({ alternate: false, scrollbackLines: 0 }));
    const { view, tick } = viewOn(host);
    await view.show('%0', 24);

    // `less` starts, which nothing tells this view about.
    host.state = paneState({ alternate: true, wantsMouse: false });

    // A gesture while the reading is still fresh is routed by what was true
    // when it was taken.
    view.scroll(1, { cols: 80, rows: 24 });
    await settle();
    expect(host.sent).toHaveLength(0);

    // Once it has gone stale, the gesture that finds it so asks again — so the
    // drag is routed by its second notch rather than by the next drag.
    tick(2000);
    view.scroll(1, { cols: 80, rows: 24 });
    await settle();
    view.scroll(1, { cols: 80, rows: 24 });
    await settle();

    expect(shown(host.sent)).toBe('<ESC>[A'.repeat(5));
  });
});

describe('a view that has been let go', () => {
  it('writes nothing more', async () => {
    const host = fakePane();
    const { view, written } = viewOn(host);
    await view.show('%0', 24);
    written.length = 0;

    view.dispose();
    view.receive('%0', bytes('too late'));
    view.type(bytes('x'));

    await settle();
    expect(written).toHaveLength(0);
    expect(host.sent).toHaveLength(0);
  });
});

/** Lets every queued promise run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

describe('tapping a Pane', () => {
  it('sends a click to an application that asked for the mouse', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const { view } = viewOn(host);
    await view.show('%0', 24);

    expect(view.click(12, 5)).toBe(true);
    await settle();

    // Press and release together, so nothing is left held down.
    expect(shown(host.sent)).toBe('<ESC>[<0;12;5M<ESC>[<0;12;5m');
  });

  it('sends nothing to a shell, which would only see the escape as text', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const { view } = viewOn(host);
    await view.show('%0', 24);

    expect(view.click(12, 5)).toBe(false);
    await settle();
    expect(host.sent).toHaveLength(0);
  });

  it('spends a tap getting back to the bottom rather than clicking the past', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const { view, positions } = viewOn(host);
    await view.show('%0', 24);
    view.scroll(2, { cols: 80, rows: 24 });
    await settle();
    host.sent.length = 0;

    expect(view.click(12, 5)).toBe(true);
    await settle();

    expect(host.sent).toHaveLength(0);
    expect(positions[positions.length - 1]).toBeNull();
  });

  it('says nothing about a Pane it is not showing', () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const { view } = viewOn(host);
    expect(view.click(1, 1)).toBe(false);
  });
});

describe('telling the Screen what a tap should mean', () => {
  it('reports mouse tracking when the Pane is first shown', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const { view, mouse } = viewOn(host);
    await view.show('%0', 24);
    expect(mouse).toEqual([true]);
  });

  it('says nothing for a Pane that never wanted it', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const { view, mouse } = viewOn(host);
    await view.show('%0', 24);
    expect(mouse).toEqual([]);
  });

  it('notices an application turning it on, from output alone', async () => {
    // Nothing in the control protocol announces mouse tracking: an application
    // turns it on by writing to its own screen. Output is the only sign.
    const host = fakePane(paneState({ wantsMouse: false }));
    const { view, mouse, tick } = viewOn(host);
    await view.show('%0', 24);

    host.state = paneState({ wantsMouse: true });
    tick(2000);
    view.receive('%0', bytes('claude starting'));
    await settle();

    expect(mouse).toEqual([true]);
  });

  it('does not ask again for every byte of a chatty Pane', async () => {
    const host = fakePane(paneState({ wantsMouse: false }));
    const { view } = viewOn(host);
    await view.show('%0', 24);
    host.asked.length = 0;

    for (let at = 0; at < 20; at += 1) view.receive('%0', bytes('noise'));
    await settle();

    expect(host.asked.filter((each) => each.startsWith('state'))).toHaveLength(0);
  });

  it('reports it turning off again', async () => {
    const host = fakePane(paneState({ wantsMouse: true }));
    const { view, mouse, tick } = viewOn(host);
    await view.show('%0', 24);

    host.state = paneState({ wantsMouse: false });
    tick(2000);
    view.receive('%0', bytes('claude exited'));
    await settle();

    expect(mouse).toEqual([true, false]);
  });
});
