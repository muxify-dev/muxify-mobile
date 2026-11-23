import type { HostServer } from '@/ssh/host-server';
import { fakeHostServer, lost } from '@/test-support/fake-host-server';

import type { TopicId } from './environment';
import { markPanesRead, markTopicRead } from './unread-on-visit';

const mockLogged: string[] = [];
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: (_tag: string, text: string) => mockLogged.push(text) }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ hostServer: () => null }) }));

const TOPIC = 'topic-a' as TopicId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { mockLogged.length = 0; });

function connectionsOf(server: HostServer | null) {
  return { hostServer: jest.fn(() => server) };
}

it('sends `mark_read` with the Topic on the Host\'s Host Server, waits for nothing and logs nothing', async () => {
  const fake = fakeHostServer();
  fake.on.mark_read = async () => ({});
  const connections = connectionsOf(fake.server);

  expect(markTopicRead('host-1', TOPIC, connections)).toBeUndefined();
  await settle();

  expect(connections.hostServer).toHaveBeenCalledWith('host-1');
  expect(fake.requests).toEqual([{ mark_read: { topics: ['topic-a'] } }]);
  expect(mockLogged).toEqual([]);
});

it('sends `mark_read` with the shown Panes, which makes their Agents read', async () => {
  const fake = fakeHostServer();
  fake.on.mark_read = async () => ({});

  expect(markPanesRead('host-1', ['%3', '%4'], connectionsOf(fake.server))).toBe(true);
  await settle();

  expect(fake.requests).toEqual([{ mark_read: { panes: ['%3', '%4'] } }]);
  expect(mockLogged).toEqual([]);
});

it('only logs a `mark_read` that fails, and throws nothing', async () => {
  const fake = fakeHostServer();
  fake.on.mark_read = async () => { throw lost(); };

  markTopicRead('host-1', TOPIC, connectionsOf(fake.server));
  await settle();

  expect(fake.requests).toHaveLength(1);
  expect(mockLogged).toHaveLength(1);
  expect(mockLogged[0]).toMatch(/^the Host did not mark Topic topic-a read on the visit: /);
});

it('sends nothing in Sessions only', async () => {
  const fake = fakeHostServer();
  fake.server = { ...fake.server, state: () => ({ kind: 'sessions-only', reason: 'the Host Server did not answer' }) };

  markTopicRead('host-1', TOPIC, connectionsOf(fake.server));
  await settle();

  expect(fake.requests).toEqual([]);
  expect(mockLogged).toEqual([]);
});

it('sends nothing with no Host Server on the Connection, and says so', async () => {
  expect(markPanesRead('host-1', ['%3'], connectionsOf(null))).toBe(false);
  markTopicRead('host-1', TOPIC, connectionsOf(null));
  await settle();

  expect(mockLogged).toEqual([]);
});
