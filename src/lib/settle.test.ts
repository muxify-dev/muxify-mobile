import { settle } from './settle';

const same = (a: number, b: number) => a === b;
const immediately = async () => undefined;

describe('settle', () => {
  it('returns as soon as two readings agree', async () => {
    const readings = [1, 2, 2, 3];
    let at = 0;
    const value = await settle(() => readings[Math.min(at++, readings.length - 1)], 0, {
      same,
      everyMs: 0,
      tries: 5,
      sleep: immediately,
    });

    expect(value).toBe(2);
  });

  it('keeps waiting while the value is still moving', async () => {
    const readings = [1, 2, 3, 4, 4];
    let at = 0;
    const value = await settle(() => readings[Math.min(at++, readings.length - 1)], 0, {
      same,
      everyMs: 0,
      tries: 6,
      sleep: immediately,
    });

    expect(value).toBe(4);
  });

  it('gives up with the latest reading rather than waiting forever', async () => {
    // Something that never settles must not hold up the Connection: a size
    // that is merely current beats no size at all.
    let next = 0;
    const value = await settle(() => ++next, 0, {
      same,
      everyMs: 0,
      tries: 3,
      sleep: immediately,
    });

    // One more than the last loop reading: giving up still takes a fresh
    // look rather than handing back a value it already knows is stale.
    expect(value).toBe(5);
  });

  it('falls back when there is never anything to read', async () => {
    const value = await settle<number>(() => null, 99, {
      same,
      everyMs: 0,
      tries: 2,
      sleep: immediately,
    });

    expect(value).toBe(99);
  });

  it('does not settle on a pair that straddles a missing reading', async () => {
    const readings: (number | null)[] = [5, null, 5, 5];
    let at = 0;
    const value = await settle(() => readings[Math.min(at++, readings.length - 1)] ?? null, 0, {
      same,
      everyMs: 0,
      tries: 5,
      sleep: immediately,
    });

    expect(value).toBe(5);
  });
});
