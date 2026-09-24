import { createTestClock } from '@/lib/test-clock';

import { createClientSizing, GRID_SETTLE_MS, GRID_SETTLE_TRIES } from './client-sizing';
import type { Grid } from './tmux-client';

/** The phone this was measured on: a Window of 49x41 in 390x780 points. */
const PHONE = { width: 390, height: 780 };
const REAL: Grid = { cols: 49, rows: 41 };
/** What the Surface says before it has been laid out. Six milliseconds early. */
const PRE_LAYOUT: Grid = { cols: 32, rows: 11 };

/** A Client whose resizes the test lets land, one at a time. */
function sizing(options: { failing?: boolean } = {}) {
  const sent: Grid[] = [];
  const flights: { settle: () => void; fail: () => void }[] = [];
  const clock = createTestClock();

  const module = createClientSizing(
    (grid) => {
      sent.push(grid);
      if (options.failing) return Promise.reject(new Error('the Host refused it'));
      return new Promise<void>((resolve, reject) => {
        flights.push({ settle: resolve, fail: () => reject(new Error('refused')) });
      });
    },
    { clock },
  );

  return {
    module,
    sent,
    clock,
    /** Lets the resize in flight land, and everything queued behind it go. */
    async land(): Promise<void> {
      flights.shift()?.settle();
      await flush();
    },
  };
}

/** Lets every already-settled promise callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('believing a grid', () => {
  it('sends the real grid and never the one reported before layout', async () => {
    const { module, sent, clock } = sizing();
    module.attached();

    module.windowGridReported(PRE_LAYOUT, PHONE);
    clock.advance(6);
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await flush();

    expect(sent).toEqual([REAL]);
  });

  it('takes the latest grid once it has been moving for long enough', () => {
    const { module, sent, clock } = sizing();
    module.attached();

    // A Surface that never stops changing its mind. It still has to be sized.
    for (let attempt = 0; attempt <= GRID_SETTLE_TRIES + 1; attempt += 1) {
      module.windowGridReported({ cols: 49, rows: 40 - attempt }, PHONE);
      clock.advance(GRID_SETTLE_MS);
    }

    expect(sent).toHaveLength(1);
    expect(sent[0].cols).toBe(49);
  });

  it('does not size the Client before the Attach asks for it', () => {
    const { module, sent, clock } = sizing();

    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);

    expect(sent).toEqual([]);
  });

  it('hands Attach the first settled grid rather than the first reported one', async () => {
    const { module, clock } = sizing();
    let settled: Grid | null = null;
    void module.settledGrid().then((grid) => {
      settled = grid;
    });

    module.windowGridReported(PRE_LAYOUT, PHONE);
    clock.advance(6);
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await flush();

    expect(settled).toEqual(REAL);
  });

  it('answers a grid that has already settled without waiting again', async () => {
    const { module, clock } = sizing();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);

    await expect(module.settledGrid()).resolves.toEqual(REAL);
  });
});

describe('a keyboard animation', () => {
  it('costs at most one resize in flight and only the newest behind it', async () => {
    const { module, sent, clock, land } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await land();
    sent.length = 0;

    // The keyboard rising: a new grid on every frame, each one settled before
    // the next arrives only because the animation pauses between them.
    for (const rows of [34, 28, 24, 22, 21]) {
      module.windowGridReported({ cols: 49, rows }, PHONE);
      clock.advance(GRID_SETTLE_MS * 2);
    }

    // One in flight, and nothing but the newest waiting behind it.
    expect(sent).toEqual([{ cols: 49, rows: 34 }]);
    await land();
    expect(sent).toEqual([
      { cols: 49, rows: 34 },
      { cols: 49, rows: 21 },
    ]);
  });
});

describe('sizes that must go out anyway', () => {
  it.each([
    [
      'a sheet closing',
      (module: ReturnType<typeof sizing>['module']) => {
        module.sheetPresented(true);
        module.sheetPresented(false);
      },
    ],
    ['a Session switch', (module: ReturnType<typeof sizing>['module']) => module.sessionSwitched()],
  ])('re-sends the current size on %s', async (_what, provoke) => {
    const { module, sent, clock, land } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await land();

    provoke(module);

    expect(sent).toEqual([REAL, REAL]);
  });

  it('sends the settled size the moment Attach comes up', async () => {
    const { module, sent, clock } = sizing();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    expect(sent).toEqual([]);

    module.attached();

    expect(sent).toEqual([REAL]);
  });

  it('skips an ordinary repeat of a size already applied', async () => {
    const { module, sent, clock, land } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await land();

    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);

    expect(sent).toEqual([REAL]);
  });
});

describe('a resize the Host refused', () => {
  it('does not wedge the next one', async () => {
    const { module, sent, clock, land } = sizing({ failing: true });
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await flush();
    expect(sent).toEqual([REAL]);

    // The same size again, because the one before it never landed.
    module.sheetPresented(true);
    module.sheetPresented(false);
    await land();

    expect(sent).toEqual([REAL, REAL]);
  });
});

describe('a split, where no Surface spans the Window', () => {
  it('sizes the Client from the container and the remembered cell metric', async () => {
    const { module, sent, clock, land } = sizing();
    module.attached();
    module.containerLaidOut(PHONE);
    // While a single Pane was up, which is what measures the cell.
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await land();
    sent.length = 0;

    // Zoom off: several Panes, none of them the whole Window, and the
    // container shrinks as the keyboard rises.
    module.spanningSurface(false);
    module.containerLaidOut({ width: 390, height: 400 });

    // 390/(390/49) wide, 400/(780/41) tall.
    expect(sent).toEqual([{ cols: 49, rows: 21 }]);
  });

  it('says nothing when it has never seen a cell to measure', () => {
    const { module, sent } = sizing();
    module.attached();
    module.spanningSurface(false);
    module.containerLaidOut(PHONE);

    expect(sent).toEqual([]);
  });
});

describe('the last stable grid', () => {
  it('is what a reconnect is sized from, not a grid still in motion', () => {
    const { module, clock } = sizing();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);

    // The keyboard starts to rise. Nothing has settled at the new shape yet.
    module.windowGridReported({ cols: 49, rows: 30 }, PHONE);
    clock.advance(6);

    expect(module.stableGrid()).toEqual(REAL);
  });
});

describe('disposal', () => {
  it('leaves no timer behind and sends nothing afterwards', () => {
    const { module, sent, clock } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);

    module.dispose();
    clock.advance(GRID_SETTLE_MS * GRID_SETTLE_TRIES);

    expect(sent).toEqual([]);
    expect(clock.pending()).toBe(0);
  });
});

describe('a sheet', () => {
  it('says nothing while it is opening, only when it closes', async () => {
    const { module, sent, clock, land } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    await land();

    module.sheetPresented(true);
    expect(sent).toEqual([REAL]);

    module.sheetPresented(false);
    expect(sent).toEqual([REAL, REAL]);
  });

  it('is not fooled by a close it never saw open', () => {
    const { module, sent, clock } = sizing();
    module.attached();
    module.windowGridReported(REAL, PHONE);
    clock.advance(GRID_SETTLE_MS * 2);
    sent.length = 0;

    module.sheetPresented(false);

    expect(sent).toEqual([]);
  });
});
