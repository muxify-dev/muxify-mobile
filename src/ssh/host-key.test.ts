import { describeConnectionFailure, MissingCredentialError } from './failures';
import { compareHostKey } from './host-key';

describe('compareHostKey', () => {
  it('is first sight when nothing has been recorded', () => {
    expect(compareHostKey(undefined, 'SHA256:abc')).toEqual({ kind: 'first-sight' });
  });

  it('treats an empty stored value as never having seen the Host', () => {
    expect(compareHostKey('', 'SHA256:abc')).toEqual({ kind: 'first-sight' });
  });

  it('is known when the key matches', () => {
    expect(compareHostKey('SHA256:abc', 'SHA256:abc')).toEqual({ kind: 'known' });
  });

  it('is changed when the key differs, and says what was expected', () => {
    // The stored value travels with the verdict so the warning can show both.
    expect(compareHostKey('SHA256:abc', 'SHA256:def')).toEqual({
      kind: 'changed',
      stored: 'SHA256:abc',
    });
  });

  it('is changed for a key differing only in case, since these are digests', () => {
    expect(compareHostKey('SHA256:abc', 'SHA256:ABC').kind).toBe('changed');
  });
});

describe('describeConnectionFailure', () => {
  it('tells a refused credential from an unreachable Host', () => {
    // The whole point: these have different fixes, and one message hides which.
    const auth = describeConnectionFailure(Object.assign(new Error('nope'), { code: 'AUTH_FAILED' }));
    const timeout = describeConnectionFailure(Object.assign(new Error('nope'), { code: 'TIMEOUT' }));

    expect(auth).toContain('refused those credentials');
    expect(timeout).toContain('did not answer in time');
    expect(auth).not.toBe(timeout);
  });

  it('explains a missing credential in terms of what to do about it', () => {
    expect(describeConnectionFailure(new MissingCredentialError())).toContain('Edit it');
  });

  it('falls back to the error message when the code is unfamiliar', () => {
    expect(describeConnectionFailure(new Error('socket closed'))).toBe('socket closed');
  });

  it('says something useful even for an empty failure', () => {
    expect(describeConnectionFailure(new Error(''))).toBe('Could not reach the Host.');
  });
});
