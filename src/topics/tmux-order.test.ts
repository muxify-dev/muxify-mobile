import { fakeHostServer, inDoubt, refused } from '@/test-support/fake-host-server';
import type { Host } from '@/storage/records';

import type { SessionId } from './environment';
import { endAlert, sendTmuxOrder, type TmuxOrder } from './tmux-order';

let mockServer = fakeHostServer();
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));

const HOST: Host = { id: 'h1', displayName: 'Mac', address: '10.0.0.1', port: 22, identityId: 'i1' };
const SESSION = '$3' as SessionId;

beforeEach(() => {
  mockServer = fakeHostServer();
});

describe('the Session and Window Actions', () => {
  it('asks before Kill Session and Close Window, naming what ends', () => {
    expect(endAlert('kill-session', 'api')).toEqual({
      title: 'Kill api?', message: 'Its Windows and what runs in them end on the Host.', confirm: 'Kill Session',
    });
    expect(endAlert('close-window', 'logs')).toEqual({
      title: 'Close logs?', message: 'Its Panes and what runs in them end on the Host.', confirm: 'Close Window',
    });
  });

  it.each<[TmuxOrder, object, object | undefined]>([
    [{ kind: 'rename-session', session: SESSION, name: 'web' }, { rename_session: { name: 'web' } }, { session: '$3' }],
    [{ kind: 'remove-from-topic', session: SESSION }, { remove_from_topic: {} }, { session: '$3' }],
    [{ kind: 'kill-session', session: SESSION }, { kill_session: {} }, { session: '$3' }],
    [{ kind: 'rename-window', window: '@7', name: 'logs' }, { rename_window: { name: 'logs' } }, { window: '@7' }],
    [{ kind: 'close-window', window: '@7' }, { kill_window: {} }, { window: '@7' }],
    [{ kind: 'mark-all-read' }, { mark_all_read: {} }, undefined],
  ])('sends %j as one Host Write with its Request id and its explicit target', async (order, command, target) => {
    const sending = jest.fn();
    await expect(sendTmuxOrder(HOST, order, sending)).resolves.toEqual({ kind: 'changed' });
    expect(sending).toHaveBeenCalledTimes(1);
    expect(mockServer.writes()).toEqual([{
      version: 2,
      command,
      ...(target === undefined ? {} : { target }),
      request: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }]);
  });

  it('has its own Request id for each tap', async () => {
    await sendTmuxOrder(HOST, { kind: 'kill-session', session: SESSION }, () => {});
    await sendTmuxOrder(HOST, { kind: 'kill-session', session: SESSION }, () => {});
    const [first, second] = mockServer.writes();
    expect(first!.request).not.toBe(second!.request);
  });

  it("ends failed with the Host's refusal, and unknown for a Request in doubt", async () => {
    mockServer.answer = () => { throw refused('No Session $3.', 'session_unavailable'); };
    await expect(sendTmuxOrder(HOST, { kind: 'kill-session', session: SESSION }, () => {}))
      .resolves.toEqual({ kind: 'failed', error: 'No Session $3.' });
    mockServer.answer = () => { throw inDoubt('The Host may have it.'); };
    await expect(sendTmuxOrder(HOST, { kind: 'mark-all-read' }, () => {}))
      .resolves.toEqual({ kind: 'unknown', message: 'The Host may have it.' });
  });
});
