import { createResizeScheduler } from './resize-scheduler';
import type { Grid } from './tmux-client';

/** A resize whose completion the test controls. */
function deferred() {
  let settle!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = () => resolve();
    fail = reject;
  });
  return { promise, settle, fail };
}

function recorder() {
  const applied: Grid[] = [];
  const flights: ReturnType<typeof deferred>[] = [];
  const resize = (grid: Grid) => {
    applied.push(grid);
    const flight = deferred();
    flights.push(flight);
    return flight.promise;
  };
  return { applied, flights, resize };
}

describe('createResizeScheduler', () => {
  it('re-sends a size after a reset, because the Session it targets has changed', async () => {
    const { applied, flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 32 });
    flights[0].settle();
    await flush();

    scheduler.reset();
    scheduler.request({ cols: 38, rows: 32 });

    expect(applied).toHaveLength(2);
  });

  it('applies the first size straight away, so growth is never delayed', () => {
    const { applied, resize } = recorder();

    createResizeScheduler(resize).request({ cols: 38, rows: 30 });

    expect(applied).toEqual([{ cols: 38, rows: 30 }]);
  });

  it('never runs two resizes at once', () => {
    const { applied, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    scheduler.request({ cols: 38, rows: 24 });
    scheduler.request({ cols: 38, rows: 14 });

    expect(applied).toEqual([{ cols: 38, rows: 30 }]);
  });

  it('collapses a burst into a single follow-up at the latest size', async () => {
    const { applied, flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    // What a keyboard animation looks like: many intermediate grids, of which
    // only the last one is worth a round trip.
    scheduler.request({ cols: 38, rows: 26 });
    scheduler.request({ cols: 38, rows: 20 });
    scheduler.request({ cols: 38, rows: 14 });

    flights[0].settle();
    await flush();

    expect(applied).toEqual([
      { cols: 38, rows: 30 },
      { cols: 38, rows: 14 },
    ]);
  });

  it('drops a burst that ends back at the size already applied', async () => {
    const { applied, flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    scheduler.request({ cols: 38, rows: 14 });
    scheduler.request({ cols: 38, rows: 30 });

    flights[0].settle();
    await flush();

    expect(applied).toEqual([{ cols: 38, rows: 30 }]);
  });

  it('ignores a size that is already applied', () => {
    const { applied, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    scheduler.request({ cols: 38, rows: 30 });

    expect(applied).toEqual([{ cols: 38, rows: 30 }]);
  });

  it('re-applies a size that was applied and then moved away from', async () => {
    const { applied, flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    flights[0].settle();
    await flush();

    scheduler.request({ cols: 38, rows: 14 });
    flights[1].settle();
    await flush();

    scheduler.request({ cols: 38, rows: 30 });

    expect(applied).toEqual([
      { cols: 38, rows: 30 },
      { cols: 38, rows: 14 },
      { cols: 38, rows: 30 },
    ]);
  });

  it('keeps working after a resize fails', async () => {
    const { applied, flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    scheduler.request({ cols: 38, rows: 14 });

    flights[0].fail(new Error('connection went away'));
    await flush();

    expect(applied).toEqual([
      { cols: 38, rows: 30 },
      { cols: 38, rows: 14 },
    ]);
  });

  it('does not reject when a resize fails with nothing queued behind it', async () => {
    const { flights, resize } = recorder();
    const scheduler = createResizeScheduler(resize);

    scheduler.request({ cols: 38, rows: 30 });
    flights[0].fail(new Error('connection went away'));

    await expect(flush()).resolves.toBeUndefined();
  });
});

/** Lets every already-settled promise callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('a resize that does not land', () => {
  it('is not remembered as applied, so the same size can be asked for again', async () => {
    // The bug this guards: a resize sent before the Client's tty was known was
    // dropped, recorded as applied, and then skipped forever after — the
    // Surface and the Window stayed different shapes until something else moved.
    const sent: Grid[] = [];
    let failing = true;
    const scheduler = createResizeScheduler(async (grid) => {
      sent.push(grid);
      if (failing) throw new Error('no tty yet');
    });

    scheduler.request({ cols: 27, rows: 13 });
    await Promise.resolve();
    await Promise.resolve();

    failing = false;
    scheduler.request({ cols: 27, rows: 13 });
    await Promise.resolve();

    expect(sent).toEqual([
      { cols: 27, rows: 13 },
      { cols: 27, rows: 13 },
    ]);
  });

  it('still skips a repeat of a size that did land', async () => {
    const sent: Grid[] = [];
    const scheduler = createResizeScheduler(async (grid) => {
      sent.push(grid);
    });

    scheduler.request({ cols: 27, rows: 13 });
    await Promise.resolve();
    scheduler.request({ cols: 27, rows: 13 });

    expect(sent).toEqual([{ cols: 27, rows: 13 }]);
  });
});
