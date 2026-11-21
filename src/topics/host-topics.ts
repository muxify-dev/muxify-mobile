import { answered, HOST_PROBLEM, refused, type Listing, type ListedSession } from '@/domain/host-listing';
import type { LiveListing } from '@/ssh/host-listing-feed';
import type { Unavailable } from '@/ssh/host-server';

import type { EnvironmentSnapshot } from './environment';
import type { HostCliState } from './host-cli-install';

/**
 * What the Host Server has pushed of the Host's Topics, or why there are none.
 *
 * Shaped like the Listing: until a new Connection's first push, `loading`
 * carries the last snapshot so the wait is invisible.
 *
 * It differs from the Listing in one place, on purpose. A failure keeps the
 * last snapshot: the Topics already on screen are still the best account of
 * the Host's work, and the error sits above them.
 *
 * `installing` and `updating` are never pushed: they are what `withHostCli`
 * makes of `absent` and `unavailable` while the Host CLI install runs.
 */
export type HostTopics =
  | { kind: 'loading'; last: EnvironmentSnapshot | null }
  /** No Host CLI on this Host. */
  | { kind: 'absent' }
  /** No Host CLI on this Host, and the install is putting one there. */
  | { kind: 'installing' }
  /** A Host CLI too old for a Host Server, and the install is updating it. */
  | { kind: 'updating'; last: EnvironmentSnapshot | null }
  | { kind: 'failed'; error: string; last: EnvironmentSnapshot | null }
  /** The Host could not be used. Its Host Problem says why, so the Topics say nothing. */
  | { kind: 'host-problem'; last: EnvironmentSnapshot | null }
  | { kind: 'listed'; snapshot: EnvironmentSnapshot }
  /**
   * No Host Server can run on this Connection: the Host Screen shows Sessions
   * only and says "Topics are unavailable on <host>: <reason>".
   */
  | ({ kind: 'unavailable'; host: string } & Unavailable);

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
  switch (topics.kind) {
    case 'listed':
      return topics.snapshot;
    case 'loading':
    case 'failed':
    case 'host-problem':
    case 'updating':
      return topics.last;
    case 'absent':
    case 'installing':
    case 'unavailable':
      return null;
  }
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
 * - the latest push of this Connection, at once;
 * - before it, `last`, the Listing the screen last drew, so a new
 *   Connection shows no spinner over it; with none, the spinner;
 * - in Sessions only, and while the Host has no `muxify` yet, the Sessions
 *   that tmux lists, `sessions`, and the reason there are no Topics;
 * - `problem`, a Host that could not be used: the Host Problem says why, so
 *   the Listing and the Topics say nothing of it;
 * - `failure`, any other reason the screen could not ask, as a refusal.
 */
export function liveReading(input: {
  live: LiveListing | null;
  last: EnvironmentSnapshot | null;
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
  const snapshot = live?.snapshot ?? null;
  if (snapshot !== null) return { listing: answered(listedSessions(snapshot)), topics: { kind: 'listed', snapshot } };
  return {
    listing: last === null ? { phase: 'reading' } : { phase: 'reading', sessions: listedSessions(last) },
    topics: { kind: 'loading', last },
  };
}
