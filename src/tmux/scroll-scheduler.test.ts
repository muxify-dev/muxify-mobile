import { createScrollScheduler } from './scroll-scheduler';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createScrollScheduler', () => {
  it('sends the first request straight away', () => {
    const calls: number[] = [];
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
    });

    scheduler.request(12);

    expect(calls).toEqual([12]);
  });

  it('adds up everything that arrives while one is in flight', async () => {
    // The difference from resizing: a dropped scroll is distance the user
    // asked for and did not get, where a dropped size is simply stale.
    const calls: number[] = [];
    const gate = deferred();
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
      if (calls.length === 1) await gate.promise;
    });

    scheduler.request(10);
    scheduler.request(5);
    scheduler.request(7);
    expect(calls).toEqual([10]);

    gate.resolve();
    await gate.promise;
    await Promise.resolve();

    expect(calls).toEqual([10, 12]);
  });

  it('lets a reversal cancel itself out rather than travelling twice', async () => {
    const calls: number[] = [];
    const gate = deferred();
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
      if (calls.length === 1) await gate.promise;
    });

    scheduler.request(10);
    scheduler.request(8);
    scheduler.request(-8);

    gate.resolve();
    await gate.promise;
    await Promise.resolve();

    expect(calls).toEqual([10]);
  });

  it('ignores a request for no movement', () => {
    const calls: number[] = [];
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
    });

    scheduler.request(0);

    expect(calls).toEqual([]);
  });

  it('keeps going after one fails', async () => {
    // A wedged scheduler is a terminal that has stopped scrolling for good.
    const calls: number[] = [];
    const gate = deferred();
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
      if (calls.length === 1) await gate.promise;
    });

    scheduler.request(10);
    scheduler.request(4);
    gate.reject(new Error('the Host went away'));
    await gate.promise.catch(() => undefined);
    await Promise.resolve();

    expect(calls).toEqual([10, 4]);
  });

  it('forgets what was never sent when it is reset', async () => {
    const calls: number[] = [];
    const gate = deferred();
    const scheduler = createScrollScheduler(async (lines) => {
      calls.push(lines);
      if (calls.length === 1) await gate.promise;
    });

    scheduler.request(10);
    scheduler.request(30);
    scheduler.reset();

    gate.resolve();
    await gate.promise;
    await Promise.resolve();

    expect(calls).toEqual([10]);
  });
});
