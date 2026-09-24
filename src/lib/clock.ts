/**
 * Time, as something that can be handed to a module rather than reached for.
 *
 * The three deep modules in this app all wait: the Pane view for the moment a
 * Surface will accept writes, the sizing module for a grid to stop moving, the
 * Attach for both. Every one of those waits was measured on a device and is
 * correct there — and every one of them, written against the global timer, can
 * only be checked on a device. A clock passed in is what turns "80 ms" from a
 * tuned constant into an assertion.
 *
 * Deliberately three methods. Anything else a module wants from time — a
 * deadline, a debounce, a settle — is built from these, and building it is the
 * module's own business rather than a shared helper's.
 */

/**
 * Whatever the clock hands back for a timer it started.
 *
 * Opaque on purpose: `setTimeout` answers a number on one runtime and an
 * object on another, and nothing above this ever looks inside it.
 */
export type Timer = unknown;

export interface Clock {
  /** Milliseconds, monotonic enough for a debounce. */
  now(): number;
  /** Runs `fire` no sooner than `ms` from now. */
  after(ms: number, fire: () => void): Timer;
  /** Stops a timer that has not fired. Safe on one that has. */
  cancel(timer: Timer | null): void;
}

/** The one the app runs on. */
export const systemClock: Clock = {
  now: () => Date.now(),
  after: (ms, fire) => setTimeout(fire, ms),
  cancel: (timer) => {
    if (timer !== null) clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};
