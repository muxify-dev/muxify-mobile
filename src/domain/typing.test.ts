import type { AttachPhase } from '@/tmux/attach';

import { keyboardMove, typingOf, type Typing } from './typing';

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

describe('keyboardMove', () => {
  it.each<[string, Parameters<typeof keyboardMove>[0], ReturnType<typeof keyboardMove>]>([
    [
      'blurs a Surface with the keyboard when keys stop, and remembers it',
      { canType: false, focused: true, remembered: false, inputElsewhere: false },
      { act: 'blur', remembered: true },
    ],
    [
      'does nothing to a Surface without the keyboard when keys stop',
      { canType: false, focused: false, remembered: false, inputElsewhere: false },
      { act: 'none', remembered: false },
    ],
    [
      'keeps what it remembers through a second stop',
      { canType: false, focused: false, remembered: true, inputElsewhere: false },
      { act: 'none', remembered: true },
    ],
    [
      'gives the keyboard back when keys reach the Pane again',
      { canType: true, focused: false, remembered: true, inputElsewhere: false },
      { act: 'focus', remembered: false },
    ],
    [
      'does not raise a keyboard that was down',
      { canType: true, focused: false, remembered: false, inputElsewhere: false },
      { act: 'none', remembered: false },
    ],
    [
      'does not take the keyboard from the Composer, a Selection or a sheet',
      { canType: true, focused: false, remembered: true, inputElsewhere: true },
      { act: 'none', remembered: false },
    ],
  ])('%s', (_, facts, move) => {
    expect(keyboardMove(facts)).toEqual(move);
  });
});
