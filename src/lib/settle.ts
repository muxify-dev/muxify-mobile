/** Reads whatever the value is right now, or null before there is one. */
export type Read<T> = () => T | null;

export interface SettleOptions<T> {
  /** True when two readings are the same value. */
  same: (a: T, b: T) => boolean;
  /** How long to wait between readings. */
  everyMs: number;
  /** How many readings to take before giving up and using the latest. */
  tries: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits for a value to stop changing, then returns it.
 *
 * For the case where something must be read exactly once and cannot be
 * corrected afterwards, while the thing being read is still settling.
 *
 * Gives up after `tries` and returns the latest reading: a value that will not
 * settle is still better than no value, and the caller has something to do
 * with it either way.
 */
export async function settle<T>(
  read: Read<T>,
  fallback: T,
  { same, everyMs, tries, sleep = defaultSleep }: SettleOptions<T>,
): Promise<T> {
  let previous = read();
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await sleep(everyMs);
    const current = read();
    if (current !== null && previous !== null && same(previous, current)) return current;
    previous = current;
  }
  return read() ?? fallback;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
