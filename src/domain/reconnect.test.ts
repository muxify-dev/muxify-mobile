import type { Host } from '@/storage/records';

import type { KeyVerdict } from '@/ssh/host-key';
import type { AttachPhase } from '@/tmux/attach';
import { reasonForAttachFailure, reasonForConnectFailure } from '@/tmux/disconnect-reason';

import {
  failureText,
  placeToReconnect,
  reconnect,
  reconnectProgress,
  type Lookup,
  type ReconnectProgress,
  type SessionVisit,
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
    const lookup: Lookup = { kind: 'failed', step: 'looking-for-session', reason: null };
    expect(reconnectProgress(lookup, null)).toEqual(lookup);
  });

  it.each<[string, AttachPhase | null, ReconnectProgress]>([
    ['not yet asked for', null, { kind: 'at', step: 'attaching' }],
    ['connecting', { kind: 'connecting' }, { kind: 'at', step: 'attaching' }],
    ['connected', { kind: 'connected' }, { kind: 'attached' }],
    [
      'closed',
      { kind: 'closed' },
      { kind: 'failed', step: 'attaching', title: 'Disconnected', reason: null },
    ],
    [
      'disconnected',
      { kind: 'disconnected', reason: { kind: 'host-unreachable', detail: 'no route' } },
      { kind: 'failed', step: 'attaching', title: 'Host unreachable', reason: 'no route' },
    ],
  ])('follows the Attach once the Session is found and the Attach is %s', (_, phase, progress) => {
    expect(reconnectProgress({ kind: 'found' }, phase)).toEqual(progress);
  });
});

/**
 * A Host as the SSH library meets it: connect, show the key, sign in, list.
 * A key the visit refuses ends it with HOST_KEY_REJECTED, as the library does.
 */
function fakeHost(
  options: {
    connectError?: unknown;
    verdict?: KeyVerdict;
    signInError?: unknown;
    listError?: unknown;
    sessions?: string[];
  } = {},
) {
  const seen = { signedIn: false, attached: false };
  const visit: SessionVisit = async ({ onHostKey, onSignedIn }) => {
    if (options.connectError) throw options.connectError;
    if (!onHostKey(options.verdict ?? { kind: 'known' }, 'SHA256:presented')) {
      throw Object.assign(new Error('Host key rejected'), { code: 'HOST_KEY_REJECTED' });
    }
    if (options.signInError) throw options.signInError;
    seen.signedIn = true;
    onSignedIn();
    if (options.listError) throw options.listError;
    return options.sessions ?? ['main'];
  };
  return { visit, seen };
}

async function reconnectTo(host: ReturnType<typeof fakeHost>, session = 'main') {
  const steps: Lookup[] = [];
  await reconnect({
    session,
    visit: host.visit,
    attach: async () => {
      host.seen.attached = true;
    },
    progress: (lookup) => steps.push(lookup),
  });
  return steps;
}

function messageOf(progress: ReconnectProgress) {
  if (progress.kind !== 'failed') throw new Error(`not failed: ${progress.kind}`);
  return failureText(progress, { hostName: 'Dev', session: 'main' });
}

describe('reconnect', () => {
  it('goes through every step and then attaches', async () => {
    const host = fakeHost();
    expect(await reconnectTo(host)).toEqual([
      { kind: 'at', step: 'connecting' },
      { kind: 'at', step: 'checking-host-key' },
      { kind: 'at', step: 'signing-in' },
      { kind: 'at', step: 'looking-for-session' },
      { kind: 'found' },
    ]);
    expect(host.seen.attached).toBe(true);
  });

  it('stops at a changed key: it never signs in and never attaches', async () => {
    const host = fakeHost({ verdict: { kind: 'changed', stored: 'SHA256:old' } });
    const steps = await reconnectTo(host);

    expect(steps.at(-1)).toEqual({
      kind: 'failed',
      step: 'checking-host-key',
      fingerprint: 'SHA256:presented',
    });
    expect(host.seen.signedIn).toBe(false);
    expect(host.seen.attached).toBe(false);
  });

  it.each<[string, Parameters<typeof fakeHost>[0], { title: string; reason: string | null }]>([
    [
      'the Host does not answer',
      { connectError: Object.assign(new Error('timed out'), { code: 'TIMEOUT' }) },
      {
        title: 'Could not reach Dev',
        reason: 'The Host did not answer in time. Check the address and that it is reachable.',
      },
    ],
    [
      'the Host presents a changed key',
      { verdict: { kind: 'changed', stored: 'SHA256:old' } },
      { title: 'Dev presented a different host key', reason: null },
    ],
    [
      'the Host refuses the Identity',
      { signInError: Object.assign(new Error('auth'), { code: 'AUTH_FAILED' }) },
      { title: 'Dev did not accept the Identity', reason: null },
    ],
    [
      'the Session is gone',
      { sessions: ['other'] },
      { title: 'main is no longer on Dev', reason: null },
    ],
    [
      'the Host cannot list its Sessions',
      { listError: new Error('sh: tmux: not found') },
      { title: 'Could not look for main on Dev', reason: 'sh: tmux: not found' },
    ],
  ])('stays failed when %s, with its message, and does not attach', async (_, options, text) => {
    const host = fakeHost(options);
    const steps = await reconnectTo(host);

    expect(messageOf(reconnectProgress(steps.at(-1)!, null))).toEqual(text);
    expect(host.seen.attached).toBe(false);
  });

  it.each<[string, AttachPhase, { title: string; reason: string | null }]>([
    [
      'tmux has let go of the Session',
      {
        kind: 'disconnected',
        reason: reasonForAttachFailure(new Error("can't find session: main")),
      },
      { title: 'Session ended', reason: "can't find session: main" },
    ],
    [
      'the Host did not answer the Attach',
      {
        kind: 'disconnected',
        reason: reasonForConnectFailure(Object.assign(new Error(''), { code: 'TIMEOUT' })),
      },
      {
        title: 'Host unreachable',
        reason: 'The Host did not answer in time. Check the address and that it is reachable.',
      },
    ],
  ])('says why the Attach failed when %s', (_, phase, text) => {
    expect(messageOf(reconnectProgress({ kind: 'found' }, phase))).toEqual(text);
  });
});
