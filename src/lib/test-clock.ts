import type { Clock, Timer } from './clock';

export interface TestClock extends Clock {
  /** Moves time on, firing everything due on the way. */
  advance(ms: number): void;
  /** How many timers are still waiting, which is how a leak is caught. */
  pending(): number;
}

/**
 * A clock the test drives.
 *
 * Not in `clock.ts`, because nothing in the app imports it and a test double
 * sitting next to the thing it doubles is a test double that eventually ships.
 *
 * Timers fire in the order they come due, and a timer set by a timer that is
 * firing is honoured on the same `advance` if it falls inside the span — which
 * is what a chain of waits looks like from the outside.
 */
export function createTestClock(start = 0): TestClock {
  let clock = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; fire: () => void }>();

  return {
    now: () => clock,

    after(ms: number, fire: () => void): Timer {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: clock + Math.max(0, ms), fire });
      return id;
    },

    cancel(timer: Timer | null): void {
      if (typeof timer === 'number') timers.delete(timer);
    },

    advance(ms: number): void {
      const until = clock + ms;
      for (;;) {
        let dueId: number | undefined;
        let dueAt = Infinity;
        for (const [id, timer] of timers) {
          if (timer.at <= until && timer.at < dueAt) {
            dueAt = timer.at;
            dueId = id;
          }
        }
        if (dueId === undefined) break;
        const due = timers.get(dueId) as { at: number; fire: () => void };
        timers.delete(dueId);
        clock = due.at;
        due.fire();
      }
      clock = until;
    },

    pending: () => timers.size,
  };
}
