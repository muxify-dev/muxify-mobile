import { coast, createVelocityTracker, isFlick } from './inertia';

/** One frame at 60Hz, which is what the constants were written for. */
const FRAME = 1 / 60;

describe('telling a flick from a finger being lifted', () => {
  it('takes a fast release as a flick', () => {
    expect(isFlick(1200)).toBe(true);
    expect(isFlick(-1200)).toBe(true);
  });

  it('takes a slow one as the end of a drag', () => {
    // Letting go without throwing. Coasting from here would move the screen
    // after the user had stopped asking it to.
    expect(isFlick(40)).toBe(false);
    expect(isFlick(0)).toBe(false);
  });
});

describe('coasting', () => {
  it('travels in the direction it was thrown', () => {
    expect(coast(1200, FRAME).points).toBeGreaterThan(0);
    expect(coast(-1200, FRAME).points).toBeLessThan(0);
  });

  it('slows down', () => {
    const first = coast(1200, FRAME);
    const second = coast(first.velocity, FRAME);
    expect(Math.abs(second.velocity)).toBeLessThan(Math.abs(first.velocity));
    expect(Math.abs(second.points)).toBeLessThan(Math.abs(first.points));
  });

  it('stops, rather than creeping for ever', () => {
    let velocity = 1200;
    let frames = 0;
    while (coast(velocity, FRAME).moving) {
      velocity = coast(velocity, FRAME).velocity;
      frames += 1;
      if (frames > 600) break;
    }
    // About three quarters of a second from a good throw, which is what the
    // Surface's own momentum does.
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(80);
  });

  it('is the same length whatever the frame rate', () => {
    // A frame the app spent painting must not swallow part of the flick, so
    // the decay follows the clock rather than the frame count.
    const far = (seconds: number) => {
      let velocity = 2000;
      let travelled = 0;
      for (let at = 0; at < 600; at += 1) {
        const step = coast(velocity, seconds);
        if (!step.moving) break;
        travelled += step.points;
        velocity = step.velocity;
      }
      return travelled;
    };
    // Within a couple of percent: the two disagree only about which frame
    // crosses the stop threshold, not about how far the flick goes.
    expect(Math.abs(far(1 / 120) - far(1 / 60)) / far(1 / 60)).toBeLessThan(0.05);
  });

  it('has stopped when it is handed nothing', () => {
    expect(coast(0, FRAME)).toEqual({ points: 0, velocity: 0, moving: false });
  });
});

describe('how fast the finger was going', () => {
  it('measures over a window, not off the last event', () => {
    // A drag arrives as many small events. The last one on its own covers a
    // couple of points in a couple of milliseconds and says almost nothing.
    const tracker = createVelocityTracker(100);
    for (let at = 0; at <= 100; at += 2) tracker.add(at * 5, at);
    // 5 points every millisecond is 5000 a second.
    expect(tracker.velocity(100)).toBeCloseTo(5000, -1);
  });

  it('forgets what happened before the window', () => {
    const tracker = createVelocityTracker(100);
    tracker.add(0, 0);
    tracker.add(1000, 50);
    tracker.add(1010, 400);
    tracker.add(1020, 420);
    // The throw is long over; what is left is a finger barely moving.
    expect(Math.abs(tracker.velocity(420))).toBeLessThan(1000);
  });

  it('says nothing about a finger that has stopped', () => {
    const tracker = createVelocityTracker(100);
    tracker.add(0, 0);
    tracker.add(500, 50);
    expect(tracker.velocity(900)).toBe(0);
  });

  it('says nothing before there is anything to say', () => {
    const tracker = createVelocityTracker(100);
    expect(tracker.velocity(0)).toBe(0);
    tracker.add(10, 0);
    expect(tracker.velocity(0)).toBe(0);
  });

  it('keeps the direction', () => {
    const tracker = createVelocityTracker(100);
    tracker.add(300, 0);
    tracker.add(0, 60);
    expect(tracker.velocity(60)).toBeLessThan(0);
  });
});
