import { fakeHostServer, inDoubt, lost, refused } from '@/test-support/fake-host-server';
import type { HostServer } from '@/ssh/host-server';
import type { Host } from '@/storage/records';

import { sendEnvironment, type EnvironmentWrite } from './host-write-request';
import { newRequestId, REQUEST_MISMATCH_ERROR, WriteOutcomeUnknown } from './request';
import type { TopicId } from './environment';

const mockLogged: string[] = [];
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: (tag: string, text: string) => mockLogged.push(`${tag}: ${text}`) }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => { throw new Error('the tests give their own Connections'); } }));

const HOST: Host = { id: 'h1', displayName: 'Mac', address: '10.0.0.1', port: 22, identityId: 'i1' };
const WRITE: EnvironmentWrite = { command: { rename: { title: 'Fix login' } }, target: { topic: 't1' as TopicId }, request: newRequestId() };
const SENT = { environment: { version: 2, command: { rename: { title: 'Fix login' } }, target: { topic: { id: 't1' } }, request: WRITE.request } };

/**
 * The Connections of a Host whose Host Servers are these, in turn: each
 * `onServer` gets the next one, as a new Connection or a restarted server
 * would give. A server that is an Error stands for a Connection that does not
 * open.
 */
function connections(...servers: (ReturnType<typeof fakeHostServer> | Error)[]) {
  let at = 0;
  return {
    onServer: async <T,>(_host: Host, work: (server: HostServer) => Promise<T>) => {
      const next = servers[Math.min(at, servers.length - 1)]!;
      at += 1;
      if (next instanceof Error) throw next;
      return work(next.server);
    },
  };
}

beforeEach(() => { mockLogged.length = 0; });

describe('a Host Write on the Host Server', () => {
  it('goes out as one environment request with its Request id, after `sending`', async () => {
    const server = fakeHostServer();
    const order: string[] = [];
    server.answer = () => {
      order.push('request');
      return { changed: { topic_id: 't1' } };
    };

    const answer = await sendEnvironment(HOST, WRITE, () => order.push('sending'), connections(server));

    expect(answer).toEqual({ kind: 'answered', answer: { changed: { topic_id: 't1' } } });
    expect(server.requests).toEqual([SENT]);
    expect(order).toEqual(['sending', 'request']);
  });

  it('goes once more, with the same id, to the next Host Server when the channel ends before its end, and ends with that answer', async () => {
    const first = fakeHostServer();
    first.answer = () => { throw lost(); };
    const next = fakeHostServer();
    next.answer = () => ({ changed: { topic_id: 't1' } });

    const answer = await sendEnvironment(HOST, WRITE, () => {}, connections(first, next));

    expect(answer).toEqual({ kind: 'answered', answer: { changed: { topic_id: 't1' } } });
    expect(first.requests).toEqual([SENT]);
    expect(next.requests).toEqual([SENT]);
    expect(mockLogged).toContain('topic: Mac: the Host Server ended before it answered a write; sending the same Request to the next one');
  });

  it('is unsure when the next Host Server does not answer either, and goes no third time', async () => {
    const first = fakeHostServer();
    first.answer = () => { throw lost(); };
    const next = fakeHostServer();
    next.answer = () => { throw lost(); };
    const third = fakeHostServer();

    const sent = sendEnvironment(HOST, WRITE, () => {}, connections(first, next, third));

    await expect(sent).rejects.toBeInstanceOf(WriteOutcomeUnknown);
    await expect(sent).rejects.toMatchObject({ resent: true, cause: new Error('The Host Server ended before it answered.') });
    expect(third.requests).toEqual([]);
  });

  it('is unsure when no Connection opens for the second send', async () => {
    const first = fakeHostServer();
    first.answer = () => { throw lost(); };

    await expect(sendEnvironment(HOST, WRITE, () => {}, connections(first, new Error('no route to the Host'))))
      .rejects.toMatchObject({ name: 'WriteOutcomeUnknown', resent: true, cause: new Error('no route to the Host') });
  });

  it('is unsure with the Host’s words when the Host has the Request in doubt, and is not sent again', async () => {
    const server = fakeHostServer();
    server.answer = () => { throw inDoubt('The Request changed the Topic records, but Move Topic did not finish.'); };

    const answer = await sendEnvironment(HOST, WRITE, () => {}, connections(server));

    expect(answer).toEqual({ kind: 'unknown', message: 'The Request changed the Topic records, but Move Topic did not finish.' });
    expect(server.requests).toHaveLength(1);
  });

  it('fails with the Host’s message on a refusal', async () => {
    const server = fakeHostServer();
    server.answer = () => { throw refused('The Config does not define the Tag wrok.'); };

    const answer = await sendEnvironment(HOST, WRITE, () => {}, connections(server));

    expect(answer).toEqual({ kind: 'failed', error: 'The Config does not define the Tag wrok.' });
    expect(server.requests).toHaveLength(1);
  });

  it('fails, and logs a phone bug, when the Host has the id with other arguments', async () => {
    const server = fakeHostServer();
    const clash = `The Request ${WRITE.request} is the id of an earlier environment rename with other arguments.`;
    server.answer = () => { throw refused(clash, 'request_clash'); };

    const answer = await sendEnvironment(HOST, WRITE, () => {}, connections(server));

    expect(answer).toEqual({ kind: 'failed', error: REQUEST_MISMATCH_ERROR });
    expect(mockLogged).toContain(
      `topic: phone bug: Mac refused Request ${WRITE.request}, which came before with other arguments: ${clash}`,
    );
  });

  it('throws as it is, sent nowhere and not `sending`, when no Connection opens: nothing reached the Host', async () => {
    const sending = jest.fn();

    await expect(sendEnvironment(HOST, WRITE, sending, connections(new Error('no route to the Host'))))
      .rejects.toEqual(new Error('no route to the Host'));
    expect(sending).not.toHaveBeenCalled();
  });
});
