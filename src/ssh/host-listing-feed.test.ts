import { createTestClock } from '@/lib/test-clock';

import type { HostServer, HostServerState } from './host-server';
import { HostServerError } from './host-server-channel';
import { followListing } from './host-listing-feed';

const LIVE: HostServerState = { kind: 'live', build: 'muxify 1', protocol: 1 };

/** A Host Server whose state and subscriptions the test drives. */
function fakeServer(initial: HostServerState) {
  let state = initial;
  const listeners = new Set<(state: HostServerState) => void>();
  const subscriptions: {
    payload: object;
    onItem: (item: unknown) => void;
    cancelled: boolean;
    /** The Host ends it, as it ends a subscriber that fell behind. */
    end: () => void;
  }[] = [];
  const server: HostServer = {
    state: () => state,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} }),
    subscribe: (payload, onItem) => {
      let end = () => {};
      const ended = new Promise<unknown>((_resolve, reject) => {
        end = () => reject(new HostServerError('unavailable', 'the subscriber fell behind'));
      });
      const entry = { payload, onItem, cancelled: false, end };
      subscriptions.push(entry);
      return Object.assign(ended, { cancel: () => { entry.cancelled = true; } });
    },
    installAnswered: () => {},
    tryAgain: () => {},
    close: () => {},
  };
  return {
    server,
    subscriptions,
    become(next: HostServerState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

const snapshot = (...labels: string[]) => ({
  no_topic: [],
  pinned: [],
  sessions: [],
  sidebar: { sessions: true, topics: false },
  tags: [],
  unpinned: {
    bench: [], guests: [], kind: 'in_play', limit: 3,
    places: labels.map((label, index) => ({
      kind: 'topic', mark: null, sessions: [],
      topic: { id: `t${index}`, label, note: null, state: 'empty', tags: [] },
    })),
  },
});
const labelsOf = (feed: ReturnType<typeof followListing>) =>
  feed.current().received?.snapshot.unpinned.places.map((card) => (card.kind === 'topic' ? card.topic.label : card.kind));

describe('the Listing of a Host Server', () => {
  it('subscribes once the server is live, and keeps the newest push, with its sidebar', () => {
    const fake = fakeServer({ kind: 'starting' });
    const feed = followListing(fake.server);
    const heard = jest.fn();
    feed.onChange(heard);
    expect(fake.subscriptions).toEqual([]);
    expect(feed.current()).toMatchObject({ server: { kind: 'starting' }, received: null });

    fake.become(LIVE);
    expect(fake.subscriptions.map((entry) => entry.payload)).toEqual([{ snapshot: {} }]);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    fake.subscriptions[0]!.onItem(snapshot('Ship', 'Docs'));

    expect(labelsOf(feed)).toEqual(['Ship', 'Docs']);
    expect(feed.current().received?.snapshot.sidebar).toEqual({ topics: false, sessions: true });
    expect(feed.current().server).toEqual(LIVE);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('subscribes again on a server that starts again, and keeps the last push until the new first item', () => {
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));

    fake.become({ kind: 'starting' });
    fake.become(LIVE);
    expect(fake.subscriptions).toHaveLength(2);
    expect(fake.subscriptions[0]!.cancelled).toBe(true);
    expect(labelsOf(feed)).toEqual(['Ship']);

    // The old server, shutting down, pushes no more.
    fake.subscriptions[0]!.onItem(snapshot('Old'));
    expect(labelsOf(feed)).toEqual(['Ship']);
    fake.subscriptions[1]!.onItem(snapshot('Docs'));
    expect(labelsOf(feed)).toEqual(['Docs']);
  });

  it('notes when the phone received each snapshot, and is sure of the list once one comes', () => {
    const clock = createTestClock(1_000);
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server, () => {}, clock);
    expect(feed.current().doubt).toEqual({ since: 1_000, asked: 1_000 });

    clock.advance(5_000);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));

    expect(feed.current()).toMatchObject({ received: { at: 6_000 }, doubt: null });
  });

  it('stays sure of a list the Host has not changed for hours, while its subscription runs', () => {
    const clock = createTestClock();
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server, () => {}, clock);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));

    clock.advance(2 * 60 * 60_000);

    expect(feed.current()).toMatchObject({ received: { at: 0 }, doubt: null });
  });

  it('doubts the list from the moment the app goes to the background, and writes nothing to the Host until it comes back', () => {
    const clock = createTestClock();
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server, () => {}, clock);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    clock.advance(10_000);

    feed.pause();
    clock.advance(120_000);
    feed.refresh();

    expect(feed.current().doubt).toEqual({ since: 10_000, asked: null });
    expect(fake.subscriptions).toHaveLength(1);
    expect(fake.subscriptions[0]!.cancelled).toBe(false);
  });

  it('keeps the doubt over an item of the subscription that ran before the background, and ends it with the first item of a new one', () => {
    const clock = createTestClock();
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server, () => {}, clock);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    clock.advance(10_000);
    feed.pause();
    clock.advance(120_000);

    feed.resume();
    expect(feed.current().doubt).toEqual({ since: 10_000, asked: 130_000 });
    // A push the link held while the app was away, or one from a dead link: it shows what it says, but proves nothing.
    fake.subscriptions[0]!.onItem(snapshot('Ship', 'Old'));
    expect(labelsOf(feed)).toEqual(['Ship', 'Old']);
    expect(feed.current().doubt).toEqual({ since: 10_000, asked: 130_000 });

    clock.advance(300);
    feed.refresh();
    expect(fake.subscriptions).toHaveLength(2);
    expect(fake.subscriptions[0]!.cancelled).toBe(true);
    fake.subscriptions[1]!.onItem(snapshot('Ship', 'Docs'));

    expect(labelsOf(feed)).toEqual(['Ship', 'Docs']);
    expect(feed.current()).toMatchObject({ received: { at: 130_300 }, doubt: null });
  });

  it('does not subscribe on refresh while the server is not live: it subscribes once it is', () => {
    const fake = fakeServer({ kind: 'starting' });
    const feed = followListing(fake.server);

    feed.refresh();

    expect(fake.subscriptions).toEqual([]);
  });

  it('doubts the list from the moment its server leaves live', () => {
    const clock = createTestClock();
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server, () => {}, clock);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    clock.advance(40_000);

    fake.become({ kind: 'closed' });

    expect(feed.current().doubt).toEqual({ since: 40_000, asked: 40_000 });
  });

  it('subscribes again when the Host ends a subscription that brought items while the server stays live, and says so', async () => {
    const clock = createTestClock();
    const fake = fakeServer(LIVE);
    const said: string[] = [];
    const feed = followListing(fake.server, (line) => said.push(line), clock);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    clock.advance(7_000);

    fake.subscriptions[0]!.end();
    await Promise.resolve();

    expect(fake.subscriptions).toHaveLength(2);
    expect(said).toEqual(['the Host ended the Listing subscription; subscribing again']);
    expect(feed.current().doubt).toEqual({ since: 7_000, asked: 7_000 });
    fake.subscriptions[1]!.onItem(snapshot('Docs'));
    expect(labelsOf(feed)).toEqual(['Docs']);
    expect(feed.current().doubt).toBeNull();
  });

  it('does not ask again when the Host ends a subscription before its first item, and doubts the list', async () => {
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server);

    fake.subscriptions[0]!.end();
    await Promise.resolve();

    expect(fake.subscriptions).toHaveLength(1);
    expect(feed.current().doubt).not.toBeNull();
  });

  it('keeps the last snapshot over one it cannot read, and says so', () => {
    const fake = fakeServer(LIVE);
    const said: string[] = [];
    const feed = followListing(fake.server, (line) => said.push(line));
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    fake.subscriptions[0]!.onItem({ sessions: 'nope' });

    expect(labelsOf(feed)).toEqual(['Ship']);
    expect(said).toEqual([expect.stringContaining('a snapshot this phone cannot read')]);
  });

  it('says when the server falls to Sessions only', () => {
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server);
    fake.become({ kind: 'sessions-only', reason: 'the Host Server did not answer' });

    expect(feed.current().server).toEqual({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
  });
});
