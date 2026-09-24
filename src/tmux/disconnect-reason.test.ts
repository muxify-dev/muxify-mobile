import { MissingCredentialError } from '@/ssh/failures';

import {
  retryCouldWork,
  reasonForAttachFailure,
  reasonForClosure,
  reasonForConnectFailure,
  shortLabel,
  type DisconnectKind,
} from './disconnect-reason';
import { TmuxError } from './tmux-error';

const coded = (code: string, message = 'the library said so') =>
  Object.assign(new Error(message), { code });

describe('what the SSH library said', () => {
  it.each<[string, DisconnectKind]>([
    ['AUTH_FAILED', 'authentication'],
    ['HOST_KEY_REJECTED', 'host-key'],
    ['TIMEOUT', 'host-unreachable'],
    ['CANCELLED', 'user-closed'],
  ])('reads %s as %s', (code, kind) => {
    expect(reasonForConnectFailure(coded(code)).kind).toBe(kind);
  });

  it('reads a credential that was never stored as an authentication problem', () => {
    const reason = reasonForConnectFailure(new MissingCredentialError());
    expect(reason.kind).toBe('authentication');
    expect(reason.detail).toContain('No credential');
  });

  it('reads anything else at this stage as a Host it could not reach', () => {
    const reason = reasonForConnectFailure(new Error('connection refused'));
    expect(reason.kind).toBe('host-unreachable');
    expect(reason.detail).toBe('connection refused');
  });
});

describe('what tmux said', () => {
  it('reads a Session that is not there as the Session ending, in tmux’s words', () => {
    const reason = reasonForAttachFailure(
      new TmuxError("can't find session: work", "can't find session: work"),
    );
    expect(reason.kind).toBe('session-ended');
    expect(reason.detail).toContain("can't find session");
  });

  it('reads a Host with no server running the same way', () => {
    expect(reasonForAttachFailure(new TmuxError('no server running on /tmp/tmux-501')).kind).toBe(
      'session-ended',
    );
  });

  it('reads a Host with nothing to attach to the same way', () => {
    expect(reasonForAttachFailure(new TmuxError('no sessions')).kind).toBe('session-ended');
  });

  it('reads a tmux that is not where the Host record says as a tmux problem', () => {
    // What a shell writes to stderr for a `tmuxExecutablePath` that is wrong,
    // which reaches us only because the parser stopped dropping it.
    const reason = reasonForAttachFailure(new TmuxError('sh: /usr/bin/tmux: not found'));
    expect(reason.kind).toBe('tmux-unavailable');
    expect(reason.detail).toContain('not found');
  });

  it('keeps anything it cannot place in tmux’s own words', () => {
    const reason = reasonForAttachFailure(new TmuxError('something nobody has seen'));
    expect(reason.kind).toBe('unknown');
    expect(reason.detail).toBe('something nobody has seen');
  });
});

describe('how a Connection ended', () => {
  it('reads tmux letting go as the Session ending', () => {
    expect(reasonForClosure('exit', 'server exited unexpectedly').kind).toBe('session-ended');
    expect(reasonForClosure('exit', 'The Session was detached').kind).toBe('session-ended');
  });

  it('still reads a missing tmux as a missing tmux, however it arrived', () => {
    expect(reasonForClosure('exit', 'sh: tmux: command not found').kind).toBe('tmux-unavailable');
  });

  it('reads the channel disappearing as the transport', () => {
    expect(reasonForClosure('channel', 'The Connection to the Host was closed').kind).toBe(
      'transport-lost',
    );
  });

  it('reads this app closing it as the user', () => {
    expect(reasonForClosure('local', 'The Connection was closed').kind).toBe('user-closed');
  });
});

describe('what may be tried again on its own', () => {
  it('retries a lost transport and nothing else', () => {
    const kinds: DisconnectKind[] = [
      'transport-lost',
      'host-unreachable',
      'authentication',
      'host-key',
      'tmux-unavailable',
      'session-ended',
      'user-closed',
      'unknown',
    ];
    const retried = kinds.filter((kind) => retryCouldWork({ kind, detail: '' }));
    expect(retried).toEqual(['transport-lost']);
  });
});

describe('the word on the banner', () => {
  it('uses remux’s own labels', () => {
    expect(shortLabel({ kind: 'transport-lost', detail: '' })).toBe('Transport lost');
    expect(shortLabel({ kind: 'session-ended', detail: '' })).toBe('Session ended');
    expect(shortLabel({ kind: 'authentication', detail: '' })).toBe('Auth failed');
  });
});
