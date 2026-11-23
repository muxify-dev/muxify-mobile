import {
  initialPresence,
  isPhysicalKeyboardAttached,
  nextPresence,
  type PresenceEvidence,
} from './physical-keyboard-presence';

const full: PresenceEvidence = { kind: 'softwareKeyboard', height: 336 };
const bar: PresenceEvidence = { kind: 'softwareKeyboard', height: 55 };
const down: PresenceEvidence = { kind: 'softwareKeyboard', height: 0 };

function attachedAfter(connected: boolean, ...evidence: PresenceEvidence[]): boolean {
  return isPhysicalKeyboardAttached(evidence.reduce(nextPresence, initialPresence(connected)));
}

describe('physical keyboard presence', () => {
  it('follows connect and disconnect notifications', () => {
    expect(attachedAfter(false, { kind: 'announced', connected: true })).toBe(true);
    expect(attachedAfter(true, { kind: 'announced', connected: false })).toBe(false);
  });

  it('gives way to the full software keyboard when GameController still says connected', () => {
    expect(attachedAfter(true, full)).toBe(false);
  });

  it('stays gone once the software keyboard goes down again', () => {
    expect(attachedAfter(true, full, down)).toBe(false);
  });

  it('stays gone when a return to the foreground reads the same stale connection', () => {
    expect(attachedAfter(true, full, { kind: 'checked', connected: true })).toBe(false);
  });

  it('comes back when a keyboard connects again', () => {
    expect(attachedAfter(true, full, { kind: 'announced', connected: true })).toBe(true);
  });

  it('comes back when iOS shrinks the software keyboard to its bar for a physical one', () => {
    expect(attachedAfter(true, full, down, bar)).toBe(true);
  });

  it('comes back when a check finds a keyboard after one found none', () => {
    expect(attachedAfter(true, full, { kind: 'checked', connected: false }, { kind: 'checked', connected: true })).toBe(true);
  });

  it('does not take the bar or a hidden keyboard alone as a physical keyboard', () => {
    expect(attachedAfter(false, bar)).toBe(false);
    expect(attachedAfter(false, down)).toBe(false);
  });

  it('keeps a reported keyboard while the software keyboard is down', () => {
    expect(attachedAfter(true, down, bar)).toBe(true);
  });
});
