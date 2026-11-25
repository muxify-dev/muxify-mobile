import type { TopicId } from '@/topics/environment';
import { TOPIC_GONE, type TopicRead } from '@/topics/topic-detail';

import { channelEnded, HostServerError } from './host-server-channel';
import type { HostServer, HostServerState } from './host-server';
import { followTopic } from './topic-feed';

const LIVE: HostServerState = { kind: 'live', build: 'muxify 1', protocol: 1 };

/** A Host Server whose state, subscriptions and their ends the test drives. */
function fakeServer(initial: HostServerState) {
  let state = initial;
  const listeners = new Set<(state: HostServerState) => void>();
  const subscriptions: {
    payload: object; onItem: (item: unknown) => void; cancelled: boolean; fail(error: unknown): Promise<void>;
  }[] = [];
  const server: HostServer = {
    state: () => state,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} }),
    subscribe: (payload, onItem) => {
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((_, no) => { reject = no; });
      const entry = {
        payload, onItem, cancelled: false,
        fail: async (error: unknown) => { reject(error); await Promise.resolve(); await Promise.resolve(); },
      };
      subscriptions.push(entry);
      return Object.assign(promise, { cancel: () => { entry.cancelled = true; } });
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

/** A Topic as the Host Server pushes it: one Session, one Window, one Pane with an Agent. */
const topicItem = (label: string, status: string) => ({
  topic: {
    created_at: '2026-11-16T10:00:00Z', id: 't', label, note: null, slug: 'ship', state: 'live', tags: [], title: label,
    sessions: [{
      base_name: 'game', directory: '/work/game', id: '$1', name: 'game/ship', worktree: null,
      windows: [{
        active: true, id: '@2', index: 1, name: 'claude',
        panes: [{ active: true, agent: { conversation: null, kind: 'claude', status, unread: true }, command: 'claude',
          id: '%3', index: 0, label: 'claude', path: '/work/game', window_id: '@2' }],
      }],
    }],
  },
});

const T = 't' as TopicId;

describe('the detail of one Topic from a Host Server', () => {
  it('subscribes to the Topic and draws each push with the Topic detail parser', () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    expect(fake.subscriptions.map((entry) => entry.payload)).toEqual([{ topic: { id: 't' } }]);
    fake.subscriptions[0].onItem(topicItem('Ship', 'working'));
    fake.subscriptions[0].onItem(topicItem('Ship it', 'blocked'));
    expect(reads.map((read) => read.kind === 'shown'
      ? [read.topic.label, read.topic.sessions[0].windows?.[0].mark]
      : read.error)).toEqual([['Ship', 'working'], ['Ship it', 'blocked']]);
  });

  it('says that the Topic is gone on a null item', () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    fake.subscriptions[0].onItem(null);
    expect(reads).toEqual([{ kind: 'failed', error: TOPIC_GONE }]);
  });

  it('cancels the subscription when it is let go, and hears nothing after', async () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    const stop = followTopic(fake.server, T, (read) => reads.push(read));
    stop();
    expect(fake.subscriptions[0].cancelled).toBe(true);
    fake.subscriptions[0].onItem(topicItem('Late', 'done'));
    await fake.subscriptions[0].fail(new HostServerError('cancelled', 'cancelled'));
    fake.become({ kind: 'starting' });
    fake.become(LIVE);
    expect(reads).toEqual([]);
    expect(fake.subscriptions).toHaveLength(1);
  });

  it('subscribes again to a server that starts again on the same Connection', async () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    fake.become({ kind: 'starting' });
    await fake.subscriptions[0].fail(channelEnded());
    expect(fake.subscriptions).toHaveLength(1);
    fake.become(LIVE);
    expect(fake.subscriptions).toHaveLength(2);
    fake.subscriptions[1].onItem(topicItem('Back', 'working'));
    expect(reads).toEqual([expect.objectContaining({ kind: 'shown' })]);
  });

  it('has no Topic detail in Sessions only, and says why', async () => {
    const fake = fakeServer({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    await fake.subscriptions[0].fail(channelEnded());
    expect(reads).toEqual([{ kind: 'failed', error: 'Topics are unavailable on this Host: the Host Server did not answer' }]);
  });

  it('says what the Host refused, and an item this phone cannot read', async () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    fake.subscriptions[0].onItem({ topic: { id: 't' } });
    await fake.subscriptions[0].fail(new HostServerError('failed', 'no Topic t'));
    expect(reads).toEqual([
      { kind: 'failed', error: expect.stringContaining('This phone cannot read the Topic') },
      { kind: 'failed', error: 'no Topic t' },
    ]);
  });

  it('leaves a closed Connection to the next one', async () => {
    const fake = fakeServer(LIVE);
    const reads: TopicRead[] = [];
    followTopic(fake.server, T, (read) => reads.push(read));
    fake.become({ kind: 'closed' });
    await fake.subscriptions[0].fail(channelEnded());
    expect(reads).toEqual([]);
    expect(fake.subscriptions).toHaveLength(1);
  });
});
