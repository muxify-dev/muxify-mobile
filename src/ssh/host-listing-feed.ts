import { systemClock, type Clock } from '@/lib/clock';
import { describeError } from '@/lib/describe-error';
import { parseEnvironment, type EnvironmentSnapshot } from '@/topics/environment';

import type { HostServer, HostServerCall, HostServerState } from './host-server';

/** A snapshot, and when the phone received it, in clock milliseconds. A snapshot carries no time of its own. */
export interface Received {
  snapshot: EnvironmentSnapshot;
  at: number;
}

/**
 * The phone does not know that the list is the Host's now. It last knew at
 * `since`. The try to know again began at `asked`: when the app came back
 * from the background, or when the doubt began. It is null while the app is
 * in the background, where nothing is asked.
 */
export interface Doubt {
  since: number;
  asked: number | null;
}

/** What the Host Server of one Connection says of its Host. */
export interface LiveListing {
  /** Where the link stands: live, starting, installing, Sessions only or closed. */
  server: HostServerState;
  /** The latest snapshot of this feed, with `sidebar`, kept across subscriptions; null before the first push of this Connection. */
  received: Received | null;
  /**
   * Null while the list is the Host's now: a subscription made after the last
   * doubt delivered it, and runs on in an active app.
   */
  doubt: Doubt | null;
}

/** The Listing of one Connection, as its Host Server pushes it. */
export interface ListingFeed {
  /** The same object until something changes, so a reader that compares snapshots sees no change. */
  current(): LiveListing;
  /** Hears every change of `current()`. Answers the way to stop hearing. */
  onChange(listener: () => void): () => void;
  /**
   * The app went to the background: from now the list is in doubt, and
   * nothing the running subscription brings ends that. The feed writes
   * nothing to the Host until `resume`.
   */
  pause(): void;
  /** The app came back: the try to know again starts now. */
  resume(): void;
  /** Subscribes again on a live server. The first item of the new subscription is the whole state, and ends the doubt. */
  refresh(): void;
}

/**
 * Holds one `snapshot` subscription on a Host Server for its life, and keeps
 * the latest snapshot as the Host's Listing. The existing snapshot parser is
 * the decoder.
 *
 * A server that starts again, after a stop or the Host CLI install, is
 * subscribed again, and the first item of the new subscription carries the
 * whole state: until it comes, the last snapshot stays, in doubt.
 *
 * The Host can end a subscription while its server stays live, as it does a
 * subscriber that fell behind. One that brought at least one item is followed
 * again at once. One that ended before any item was refused, and asking again
 * would only be refused again.
 */
export function followListing(
  server: HostServer,
  say: (line: string) => void = () => {},
  clock: Clock = systemClock,
): ListingFeed {
  const listeners = new Set<() => void>();
  const started = clock.now();
  let current: LiveListing = { server: server.state(), received: null, doubt: { since: started, asked: started } };
  /** `vouches`: its items show the Host's state now. One that ran before a background does not. */
  let subscription: { call: HostServerCall<unknown>; vouches: boolean } | null = null;
  let paused = false;

  function publish(next: LiveListing): void {
    current = next;
    for (const listener of [...listeners]) listener();
  }

  /** From now the list may not be the Host's. An earlier doubt keeps its moment. */
  function doubt(): void {
    if (current.doubt !== null) return;
    const now = clock.now();
    publish({ ...current, doubt: { since: now, asked: now } });
  }

  function subscribe(): void {
    if (paused) return;
    subscription?.call.cancel();
    let delivered = false;
    const mine = {
      vouches: true,
      call: server.subscribe({ snapshot: {} }, (item) => {
        if (subscription !== mine) return;
        delivered = true;
        try {
          const received = { snapshot: parseEnvironment(item), at: clock.now() };
          publish({ ...current, received, doubt: mine.vouches ? null : current.doubt });
        } catch (error) {
          say(`a snapshot this phone cannot read: ${describeError(error)}`);
        }
      }),
    };
    subscription = mine;
    const ended = () => {
      if (subscription !== mine) return;
      subscription = null;
      doubt();
      if (delivered && server.state().kind === 'live' && !paused) {
        say('the Host ended the Listing subscription; subscribing again');
        subscribe();
      }
    };
    mine.call.then(ended, ended);
  }

  server.onState((state) => {
    publish({ ...current, server: state });
    if (state.kind === 'live') subscribe();
    else doubt();
  });
  if (current.server.kind === 'live') subscribe();

  return {
    current: () => current,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pause() {
      paused = true;
      if (subscription !== null) subscription.vouches = false;
      publish({ ...current, doubt: { since: current.doubt?.since ?? clock.now(), asked: null } });
    },
    resume() {
      paused = false;
      if (current.doubt !== null) publish({ ...current, doubt: { ...current.doubt, asked: clock.now() } });
    },
    refresh() {
      if (server.state().kind !== 'live') return;
      say('subscribing to the Listing again');
      subscribe();
    },
  };
}
