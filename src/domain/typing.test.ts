import type { AttachPhase } from '@/tmux/attach';

import { typingOf, type Typing } from './typing';

const LOST = { kind: 'transport-lost', detail: 'gone' } as const;

describe('typingOf', () => {
  it.each<[string, AttachPhase, boolean, boolean, Typing]>([
    ['connecting', { kind: 'connecting' }, false, false, { kind: 'waiting', for: 'connecting' }],
    ['reconnecting', { kind: 'reconnecting' }, false, false, { kind: 'waiting', for: 'reconnecting' }],
    ['restoring', { kind: 'restoring' }, false, false, { kind: 'waiting', for: 'restoring' }],
    ['connected', { kind: 'connected' }, false, false, { kind: 'open' }],
    ['switching Session', { kind: 'connected' }, true, false, { kind: 'waiting', for: 'switching' }],
    ['connected with a key not accepted', { kind: 'connected' }, false, true, { kind: 'waiting', for: 'host-key' }],
    ['switching with a key not accepted', { kind: 'connected' }, true, true, { kind: 'waiting', for: 'host-key' }],
    ['disconnected', { kind: 'disconnected', reason: LOST }, false, false, { kind: 'stopped', reason: LOST }],
    ['disconnected mid-switch', { kind: 'disconnected', reason: LOST }, true, false, { kind: 'stopped', reason: LOST }],
    ['closed', { kind: 'closed' }, false, false, { kind: 'stopped', reason: null }],
  ])('is right while %s', (_, phase, switching, keyChanged, typing) => {
    expect(typingOf({ phase, switching, keyChanged })).toEqual(typing);
  });
});
