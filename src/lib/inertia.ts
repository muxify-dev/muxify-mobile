/**
 * A flick that keeps going after the finger has gone.
 *
 * The terminal library already does this for the Surface's own gesture: it
 * ends a pan by starting a display link that decays the velocity and keeps
 * reporting deltas. The layer that takes the finger while an application is
 * listening for the mouse had nothing of the kind — a flick there stopped dead
 * on release, which on a phone reads as the scroll being broken rather than
 * different.
 *
 * So the same arithmetic lives here, with the same constants, and both paths
 * coast the same way. Measured out of the vendored source rather than guessed:
 * `momentumScrollFrame` multiplies the velocity by 0.92 each frame and stops
 * below 50 points a second.
 *
 * Pure: velocity in, distance out, no timers and no view.
 */

/** What is left of a flick's speed after one frame. */
const DECELERATION = 0.92;

/** The frame rate that deceleration was written for. */
const FRAMES_PER_SECOND = 60;

/** Below this, in points a second, a flick has stopped. */
const STOP_SPEED = 50;

export interface Coast {
  /** Points travelled during this frame. */
  points: number;
  /** What the flick is doing now, for the next frame. */
  velocity: number;
  /** Whether it is still worth another frame. */
  moving: boolean;
}

/** Whether a release was a flick at all, or just a finger being lifted. */
export function isFlick(velocity: number): boolean {
  return Math.abs(velocity) > STOP_SPEED;
}

/**
 * One frame of coasting: how far it travels, and how fast it is afterwards.
 *
 * `seconds` is the real frame time rather than an assumed one, so a frame the
 * app spent painting does not swallow part of the flick. The decay is raised
 * to that many 60ths of a second, which is what keeps a flick the same length
 * whatever the frame rate turns out to be.
 */
export function coast(velocity: number, seconds: number): Coast {
  const next = velocity * Math.pow(DECELERATION, Math.max(0, seconds) * FRAMES_PER_SECOND);
  if (Math.abs(next) < STOP_SPEED) return { points: 0, velocity: 0, moving: false };
  return { points: next * seconds, velocity: next, moving: true };
}

/**
 * How fast a finger is moving, from where it has been.
 *
 * Not from the last move event on its own, which is what this did first and
 * got wrong: a drag arrives as sixty small events, the last of them covering a
 * couple of points in a couple of milliseconds, and a velocity read off it is
 * noise. Measured over a window instead — the same thing UIKit's own pan
 * recogniser reports and the reason the Surface's momentum has always felt
 * right where this did not.
 */
export interface VelocityTracker {
  /** Where the finger is now. */
  add(position: number, at: number): void;
  /** Points a second, over the window. Zero until there is something to say. */
  velocity(at: number): number;
  clear(): void;
}

/** How far back a velocity is measured, in milliseconds. */
const WINDOW_MS = 100;

export function createVelocityTracker(windowMs: number = WINDOW_MS): VelocityTracker {
  let samples: { position: number; at: number }[] = [];

  return {
    add(position: number, at: number): void {
      samples.push({ position, at });
      samples = samples.filter((each) => at - each.at <= windowMs);
    },

    velocity(at: number): number {
      // A finger that has been still for longer than the window has no speed,
      // whatever it was doing before that.
      const live = samples.filter((each) => at - each.at <= windowMs);
      const first = live[0];
      const last = live[live.length - 1];
      if (!first || !last || last.at === first.at) return 0;
      return ((last.position - first.position) / (last.at - first.at)) * 1000;
    },

    clear(): void {
      samples = [];
    },
  };
}
