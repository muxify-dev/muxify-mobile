import type { Host, Place } from '@/storage/records';

import type { KeyVerdict } from '@/ssh/host-key';

import { coverOf } from './cover';
import { coldStartRoute, placeToReconnect, reconnect, type Lookup, type SessionVisit } from './reconnect';

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

describe('coldStartRoute', () => {
  const TAB = { url: 'http://localhost:3000/', page: 'http://localhost:3000/docs', scrollY: 120 };
  const at = (overrides: Partial<Place>): Place => ({
    hostId: 'host1', owner: { kind: 'session', session: 'main' }, session: 'main',
    window: { id: '@2', index: 1, name: 'web' }, pane: '%3', tab: null, at: '2026-11-23T10:00:00.000Z', ...overrides,
  });

  it('opens the Web View of a Session Place with a Tab, and no Terminal Screen', () => {
    expect(coldStartRoute({ places: [at({ tab: TAB })] }, PLACE)).toEqual({
      pathname: '/web-view',
      params: { url: TAB.url, page: TAB.page, scrollY: '120', restored: '1', hostId: 'host1', session: 'main', reconnect: '1' },
    });
  });

  it('opens the Web View of a Topic Place with a Tab, with the Topic', () => {
    const topicPlace = at({ owner: { kind: 'topic', topicId: 't1' }, tab: TAB });
    expect(coldStartRoute({ places: [topicPlace] }, { ...PLACE, topicId: 't1' })).toEqual({
      pathname: '/web-view',
      params: { url: TAB.url, page: TAB.page, scrollY: '120', restored: '1', hostId: 'host1', session: 'main', topicId: 't1', reconnect: '1' },
    });
  });

  it.each([
    ['the Place has no Tab', [at({})], PLACE],
    ['there is no Place', [], PLACE],
    ['the Tab is in the Place of another Session', [at({ owner: { kind: 'session', session: 'other' }, session: 'other', tab: TAB })], PLACE],
    ['the Topic Place is in another Session of the Topic', [at({ owner: { kind: 'topic', topicId: 't1' }, session: 'other', tab: TAB })], { ...PLACE, topicId: 't1' }],
    ['the Tab is on another Host', [at({ hostId: 'host2', tab: TAB })], PLACE],
  ])('opens the Terminal Screen when %s', (_, places, last) => {
    expect(coldStartRoute({ places }, last)).toEqual({
      pathname: '/terminal',
      params: { hostId: 'host1', session: 'main', ...(last.topicId ? { topicId: last.topicId } : {}), reconnect: '1' },
    });
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

/** What the Connection Screen says about where the visit stopped. */
function messageOf(lookup: Lookup) {
  const cover = coverOf({ missing: null, lookup, attach: null, place: { hostName: 'Dev', session: 'main' } });
  if (cover.kind !== 'connection-screen' || !cover.failure) throw new Error(`not failed: ${lookup.kind}`);
  return { title: cover.failure.title, reason: cover.failure.reason };
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
      {
        title: 'Dev presented a different host key',
        reason: 'It may have been rebuilt, or something may be intercepting the connection.',
      },
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

    expect(messageOf(steps.at(-1)!)).toEqual(text);
    expect(host.seen.attached).toBe(false);
  });
});
