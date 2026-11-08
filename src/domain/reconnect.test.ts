import type { Host } from '@/storage/records';

import type { AttachPhase } from '@/tmux/attach';

import {
  placeToReconnect,
  reconnectProgress,
  type Lookup,
  type ReconnectProgress,
} from './reconnect';

const HOST: Host = {
  id: 'host1',
  displayName: 'Dev',
  address: '10.0.0.2',
  port: 22,
  identityId: 'identity1',
};
const PLACE = { hostId: 'host1', session: 'main', topicId: null };

describe('placeToReconnect', () => {
  it('is the Last Place when the switch is on and its Host is saved', () => {
    expect(placeToReconnect({ reconnectOnStart: true }, { hosts: [HOST], lastPlace: PLACE })).toBe(
      PLACE,
    );
  });

  it.each([
    ['the switch is off', false, [HOST], PLACE],
    ['there is no Last Place, as after a Disconnect', true, [HOST], null],
    ['its Host was deleted', true, [], PLACE],
  ])('is the Hosts list when %s', (_, on, hosts, lastPlace) => {
    expect(placeToReconnect({ reconnectOnStart: on }, { hosts, lastPlace })).toBeNull();
  });
});

describe('reconnectProgress', () => {
  it.each<[string, Lookup]>([
    ['connecting', { kind: 'at', step: 'connecting' }],
    ['signing in', { kind: 'at', step: 'signing-in' }],
    ['looking for the Session', { kind: 'at', step: 'looking-for-session' }],
  ])('follows the visit while it is %s, whatever the Attach says', (_, lookup) => {
    expect(reconnectProgress(lookup, { kind: 'connected' })).toEqual(lookup);
  });

  it('stays failed at the step the visit failed at', () => {
    const lookup: Lookup = { kind: 'failed', step: 'looking-for-session' };
    expect(reconnectProgress(lookup, null)).toEqual(lookup);
  });

  it.each<[string, AttachPhase | null, ReconnectProgress]>([
    ['not yet asked for', null, { kind: 'at', step: 'attaching' }],
    ['connecting', { kind: 'connecting' }, { kind: 'at', step: 'attaching' }],
    ['connected', { kind: 'connected' }, { kind: 'attached' }],
    ['closed', { kind: 'closed' }, { kind: 'failed', step: 'attaching' }],
    [
      'disconnected',
      { kind: 'disconnected', reason: { kind: 'host-unreachable', detail: 'no route' } },
      { kind: 'failed', step: 'attaching' },
    ],
  ])('follows the Attach once the Session is found and the Attach is %s', (_, phase, progress) => {
    expect(reconnectProgress({ kind: 'found' }, phase)).toEqual(progress);
  });
});
