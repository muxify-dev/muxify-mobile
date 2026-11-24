import { fakeHostServer, refused } from '@/test-support/fake-host-server';
import type { Host } from '@/storage/records';

import { recordSessionVisit, recordVisit } from './visit';

const mockLogged: string[] = [];
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: (_tag: string, text: string) => mockLogged.push(text) }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  // The Host's shell, whose home is /Users/me.
  read: (_host: unknown, work: Function) => work({ exec: async () => ({ stdout: '/Users/me', stderr: '', exitCode: 0 }) }),
}) }));

const HOST = { id: 'host', displayName: 'Dev Host' } as Host;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { mockLogged.length = 0; });

it('sends `visit_session_path` with the folder, and waits for nothing', async () => {
  const server = fakeHostServer();
  const visits = jest.fn().mockResolvedValue({});
  server.on.visit_session_path = visits;

  expect(recordVisit(HOST, '/work/game', server)).toBeUndefined();
  await settle();

  expect(server.requests).toEqual([{ visit_session_path: { folder: '/work/game' } }]);
  expect(mockLogged).toEqual([]);
});

it('sends a folder under ~ as the Host\'s home, as the Host Server takes only absolute folders', async () => {
  const server = fakeHostServer();
  server.on.visit_session_path = async () => ({});

  recordVisit(HOST, '~/Dev/new app', server);
  await settle();

  expect(server.requests).toEqual([{ visit_session_path: { folder: '/Users/me/Dev/new app' } }]);
});

it('only logs a visit the Host refuses', async () => {
  const server = fakeHostServer();
  server.on.visit_session_path = async () => { throw refused('No folder at /nope.', 'session_path_unavailable'); };

  recordVisit(HOST, '/nope', server);
  await settle();

  expect(mockLogged.join('\n')).toMatch(/^Dev Host did not record the visit of \/nope: .*No folder at \/nope\.$/);
});

it('records a Session visit on a Host with go-to and leaves folder visits to the older Host', async () => {
  const server = fakeHostServer();
  server.server.state = () => ({ kind: 'live', goTo: true, protocol: 2, build: 'muxify test' });
  recordVisit(HOST, '/work/game', server);
  recordSessionVisit(HOST, 'game', server);
  await settle();
  expect(server.requests).toEqual([{ visit_session: { session: 'game' } }]);
  const older = fakeHostServer();
  recordSessionVisit(HOST, 'game', older);
  await settle();
  expect(older.requests).toEqual([]);
});
