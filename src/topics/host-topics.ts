import type { EnvironmentSnapshot } from './environment';

/**
 * What the Host has to say about its Topics, once asked.
 *
 * Shaped like the Listing, and for the same reason: the Host Screen asks again
 * on every return to it, and a question in flight carries the last snapshot
 * so the asking is invisible.
 *
 * It differs from the Listing in one place, on purpose. A failed read keeps
 * the last snapshot. A Host that refuses to list its Sessions has no Sessions
 * to offer, but a failed Topics read means the Host is up and answered badly,
 * so the Topics already on screen are still the best account of its work, and
 * the error sits above them.
 */
export type HostTopics =
  | { kind: 'loading'; last: EnvironmentSnapshot | null }
  /** No `muxify` on this Host. */
  | { kind: 'absent' }
  /** A `muxify` with no `environment show`. */
  | { kind: 'old' }
  | { kind: 'failed'; error: string; last: EnvironmentSnapshot | null }
  | { kind: 'listed'; snapshot: EnvironmentSnapshot };

/** Before the Host has been asked anything. */
export const TOPICS_UNASKED: HostTopics = { kind: 'loading', last: null };

/** Asking again, without taking down the snapshot already on screen. */
export function loadingTopics(previous: HostTopics): HostTopics {
  return { kind: 'loading', last: lastSnapshot(previous) };
}

/** What one read of the Host came to. A failure here has not yet met the last snapshot. */
export type TopicsRead =
  | { kind: 'listed'; snapshot: EnvironmentSnapshot }
  | { kind: 'absent' }
  | { kind: 'old' }
  | { kind: 'failed'; error: string };

/** The state a read leaves behind. A failed one keeps what `previous` had. */
export function settled(previous: HostTopics, read: TopicsRead): HostTopics {
  return read.kind === 'failed' ? { ...read, last: lastSnapshot(previous) } : read;
}

/** What the Host last said, or null before it has said anything. */
export function lastSnapshot(topics: HostTopics): EnvironmentSnapshot | null {
  switch (topics.kind) {
    case 'listed':
      return topics.snapshot;
    case 'loading':
    case 'failed':
      return topics.last;
    case 'absent':
    case 'old':
      return null;
  }
}
