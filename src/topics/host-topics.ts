import { answered, HOST_PROBLEM, refused, type Listing, type ListedSession } from '@/domain/host-listing';
import type { Doubt, LiveListing, Received } from '@/ssh/host-listing-feed';
import type { Unavailable } from '@/ssh/host-server';

import type { EnvironmentSnapshot } from './environment';
import type { HostCliState } from './host-cli-install';

/**
 * What the Host Server has pushed of the Host's Topics, or why there are none.
 *
 * Shaped like the Listing: until a new Connection's first push, `loading`
 * carries the last snapshot, so the list stays on screen. Every list carries
 * the phone's doubt of it, so the screen can say when it may be old: see
 * `freshness`.
 *
 * It differs from the Listing in one place, on purpose. A failure keeps the
 * last snapshot: the Topics already on screen are still the best account of
 * the Host's work, and the error sits above them.
 *
 * `installing` and `updating` are never pushed: they are what `withHostCli`
 * makes of `absent` and `unavailable` while the Host CLI install runs.
 */
export type HostTopics =
  /** A new Connection, before its first push. `last` is from an earlier Connection. */
  | { kind: 'loading'; last: Shown | null }
  /** No Host CLI on this Host. */
  | { kind: 'absent' }
  /** No Host CLI on this Host, and the install is putting one there. */
  | { kind: 'installing' }
  /** A Host CLI too old for a Host Server, and the install is updating it. */
  | { kind: 'updating'; last: Shown | null }
  | { kind: 'failed'; error: string; last: Shown | null }
  /** The Host could not be used. Its Host Problem says why, so the Topics say nothing. */
  | { kind: 'host-problem'; last: Shown | null }
  /** This Connection's latest push. */
  | ({ kind: 'listed' } & Shown)
  /**
   * No Host Server can run on this Connection: the Host Screen shows Sessions
   * only and says "Topics are unavailable on <host>: <reason>".
   */
  | ({ kind: 'unavailable'; host: string } & Unavailable);

/** A list the Host pushed, and the phone's doubt of it: null while it is the Host's now. */
export interface Shown {
  received: Received;
  doubt: Doubt | null;
}

/** Why a Host shows no Topics, in the Mac's words: "Topics are unavailable on <host>: <reason>". */
export function topicsUnavailable(host: string, reason: string): string {
  return `Topics are unavailable on ${host}: ${reason}`;
}

/** Before the Host has been asked anything. */
export const TOPICS_UNASKED: HostTopics = { kind: 'loading', last: null };

/**
 * The Topics as the Host CLI install on the Host's Connection leaves them: a
 * Host with none, or one too old for a Host Server, says the install is
 * running, and a Host with none says why it failed. Any other state of the
 * install changes nothing, because one that put a new Host CLI there starts
 * the Host Server again, which pushes the Topics. A phone too old for the
 * Host's muxify keeps its reason: no update of the Host can help it.
 */
export function withHostCli(topics: HostTopics, hostCli: HostCliState): HostTopics {
  const failure =
    hostCli.kind === 'done' && hostCli.result.kind === 'failed' ? hostCli.result.text : null;
  switch (topics.kind) {
    case 'absent':
      if (hostCli.kind === 'running') return { kind: 'installing' };
      if (failure === null) return topics;
      return { kind: 'failed', error: `Could not install Muxify on this Host: ${failure}`, last: null };
    case 'unavailable':
      // A Host CLI too old for a Host Server, which the install is updating.
      return hostCli.kind === 'running' && topics.tooOld !== 'phone' ? { kind: 'updating', last: null } : topics;
    default:
      return topics;
  }
}

/** What the Host last said, or null before it has said anything. */
export function lastSnapshot(topics: HostTopics): EnvironmentSnapshot | null {
  return lastReceived(topics)?.snapshot ?? null;
}

/** What the Host last said and when the phone received it, or null before it has said anything. */
export function lastReceived(topics: HostTopics): Received | null {
  switch (topics.kind) {
    case 'listed':
      return topics.received;
    case 'loading':
    case 'failed':
    case 'host-problem':
    case 'updating':
      return topics.last?.received ?? null;
    case 'absent':
    case 'installing':
    case 'unavailable':
      return null;
  }
}

/** How long the phone may go without knowing the list before the Host Screen says so. */
export const QUIET_WAIT_MS = 30_000;

/** How long a try to know again may run before the Host Screen says so: a good link answers sooner. */
export const QUIET_ASK_MS = 1_000;

/**
 * Whether the Topics on screen are the Host's now, as the Host Screen says it
 * above the list. The age that counts is from the last moment the phone knew
 * the list was the Host's, not from the last push: a Mac where nothing changed
 * for hours sends no push, and its list is still the Host's.
 *
 * - `current`: nothing to say. The list is the Host's now, or there is no list
 *   and a row of its own says why.
 * - `quiet`: the phone is asking again, but it knew the list less than
 *   QUIET_WAIT_MS ago, or has asked for less than QUIET_ASK_MS, so a short
 *   absence or a quick answer shows nothing. At `until` it becomes `updating`;
 *   with no `until`, the app is in the background and asks nothing yet.
 * - `updating`: the phone is asking again, and both waits are over. The screen
 *   shows "Updating…".
 * - `not-updated`: the update failed, and the phone last knew the list `at`.
 *   The screen shows "Not updated · <age>" and Retry. A Host Problem is not
 *   this: it keeps its own row.
 */
export type Freshness =
  | { kind: 'current' }
  | { kind: 'quiet'; until: number | null }
  | { kind: 'updating' }
  | { kind: 'not-updated'; at: number; error: string };

const CURRENT: Freshness = { kind: 'current' };

/** How fresh the Topics on screen are at `now`, in the feed's clock. */
export function freshness(topics: HostTopics, now: number): Freshness {
  switch (topics.kind) {
    case 'listed':
      return topics.doubt === null ? CURRENT : asking(topics.doubt, now);
    case 'loading':
      return topics.last === null ? CURRENT : asking(doubtOf(topics.last), now);
    case 'failed':
      return topics.last === null ? CURRENT : { kind: 'not-updated', at: doubtOf(topics.last).since, error: topics.error };
    case 'absent':
    case 'installing':
    case 'updating':
    case 'host-problem':
    case 'unavailable':
      return CURRENT;
  }
}

function asking({ since, asked }: Doubt, now: number): Freshness {
  if (asked === null) return { kind: 'quiet', until: null };
  const until = Math.max(since + QUIET_WAIT_MS, asked + QUIET_ASK_MS);
  return now < until ? { kind: 'quiet', until } : { kind: 'updating' };
}

/**
 * The doubt of a list an earlier Connection left. Its feed doubts it once its
 * server closes; a screen that never drew that change knows only that the list
 * was the Host's when it came.
 */
function doubtOf({ received, doubt }: Shown): Doubt {
  return doubt ?? { since: received.at, asked: received.at };
}

/**
 * The snapshot's Sessions as the Listing holds them, in the order the Mac's
 * Sessions mode shows them. The snapshot has no window counts.
 */
export function listedSessions(snapshot: EnvironmentSnapshot): ListedSession[] {
  return snapshot.sessions.map(({ name }) => ({ name, windowCount: undefined }));
}

/**
 * What the Host Screen draws of a Host whose Host Server pushes its Listing:
 *
 * - the latest push of this Connection, at once, and the phone's doubt of it;
 * - before it, and once its server has closed, `last`, the Listing the
 *   screen last drew, so a new Connection shows no spinner over it; with
 *   none, the spinner;
 * - in Sessions only, and while the Host has no `muxify` yet, the Sessions
 *   that tmux lists, `sessions`, and the reason there are no Topics;
 * - `problem`, a Host that could not be used: the Host Problem says why, so
 *   the Listing and the Topics say nothing of it;
 * - `failure`, any other reason the screen could not ask, as a refusal.
 */
export function liveReading(input: {
  live: LiveListing | null;
  last: Shown | null;
  sessions: Listing;
  failure: string | null;
  problem: boolean;
  host: string;
}): { listing: Listing; topics: HostTopics } {
  const { live, last, sessions, failure, problem, host } = input;
  if (failure !== null) return { listing: refused(failure), topics: { kind: 'failed', error: failure, last } };
  if (problem) return { listing: HOST_PROBLEM, topics: { kind: 'host-problem', last } };
  if (live?.server.kind === 'sessions-only') {
    const { reason, tooOld } = live.server;
    return { listing: sessions, topics: { kind: 'unavailable', host, reason, tooOld } };
  }
  if (live?.server.kind === 'installing') return { listing: sessions, topics: { kind: 'absent' } };
  if (live !== null && live.received !== null && live.server.kind !== 'closed') {
    const { received, doubt } = live;
    return { listing: answered(listedSessions(received.snapshot)), topics: { kind: 'listed', received, doubt } };
  }
  return {
    listing: last === null ? { phase: 'reading' } : { phase: 'reading', sessions: listedSessions(last.received.snapshot) },
    topics: { kind: 'loading', last },
  };
}
