import type { TopicId, SessionId } from './environment';
import type { TopicDetail } from './topic-detail';
import { chooseTopicSession } from './open-topic';

const topic: TopicDetail = { id: 't' as TopicId, label: 'Topic', note: null, tags: [], state: 'live',
  sessions: ['first', 'second'].map((name) => ({ id: name as SessionId, name, windows: null })) };

it('uses the phone Recent Session for this Host and keeps Mac order for ties', () => {
  expect(chooseTopicSession(topic, 'host', [
    { hostId: 'other', name: 'first', lastOpenedAt: '2026-11-10T12:00:00Z' },
    { hostId: 'host', name: 'second', lastOpenedAt: '2026-11-09T12:00:00Z' },
  ])?.name).toBe('second');
  expect(chooseTopicSession(topic, 'host', topic.sessions.map(({ name }) => ({ hostId: 'host', name, lastOpenedAt: '2026-11-09T12:00:00Z' })))?.name).toBe('first');
  expect(chooseTopicSession(topic, 'host', [])?.name).toBe('first');
  expect(chooseTopicSession({ ...topic, sessions: [] }, 'host', [])).toBeNull();
});
