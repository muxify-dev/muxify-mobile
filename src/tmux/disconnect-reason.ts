import { MissingCredentialError } from '@/ssh/failures';

import type { ClosedCause } from './control-connection';
import { TmuxError } from './tmux-error';

/**
 * Which kind of ending it was.
 *
 * The distinction that matters is not how bad it was but whether *trying again
 * could possibly work*. A Wi-Fi handover and a wrong password both end a
 * Connection; one of them is worth a silent retry and the other is worth a
 * sentence and a stop. So the kind is what the reconnect policy reads, and
 * every ending is classified into one of these on the way out.
 */
export type DisconnectKind =
  /** The link underneath went. The only kind that reconnects on its own. */
  | 'transport-lost'
  /** The Host never answered. */
  | 'host-unreachable'
  /** The Host refused the credential. */
  | 'authentication'
  /** The Host key was refused. */
  | 'host-key'
  /** There is no tmux there, or not where the Host record says. */
  | 'tmux-unavailable'
  /** tmux let go: the Session was killed, or the server went. */
  | 'session-ended'
  /** The user said so, or another Session was opened. */
  | 'user-closed'
  | 'unknown';

export interface DisconnectReason {
  kind: DisconnectKind;
  /** tmux's or the library's own words, for putting in front of the user. */
  detail: string;
}

/** The two things that can ask for an automatic reconnect, and only once each. */
export type ReconnectSource = 'foreground' | 'transport-loss';

/**
 * Whether trying this Connection again could possibly work.
 *
 * Only a lost transport. Authentication, a Host key, an unreachable Host, a
 * missing tmux, a Session that ended and a close the user asked for are all
 * endings a second attempt would reproduce exactly.
 *
 * Both uses read it, which is why it is named for the fact rather than for
 * either of them. The reconnect policy will not retry automatically when it is
 * false — a Muxify that loops against a Host which is refusing is worse than
 * one that stops and says so — and the Terminal Screen will not offer the
 * button, because a button that cannot work is worse than none. What the
 * policy adds on top is its own rule, and not this one: at most one automatic
 * attempt per source until the next connected phase.
 */
export function retryCouldWork(reason: DisconnectReason): boolean {
  return reason.kind === 'transport-lost';
}

/** The word the status banner and the Host Screen's row show. `remux`'s own. */
export function shortLabel(reason: DisconnectReason): string {
  switch (reason.kind) {
    case 'transport-lost':
      return 'Transport lost';
    case 'host-unreachable':
      return 'Host unreachable';
    case 'authentication':
      return 'Auth failed';
    case 'host-key':
      return 'Host key refused';
    case 'tmux-unavailable':
      return 'tmux unavailable';
    case 'session-ended':
      return 'Session ended';
    case 'user-closed':
      return 'Disconnected';
    case 'unknown':
      return 'Disconnected';
  }
}

/**
 * What the SSH library said, as a kind.
 *
 * Its codes are the whole of the signal here: the message is for the user and
 * differs between versions, the code does not.
 */
export function reasonForConnectFailure(error: unknown): DisconnectReason {
  if (error instanceof MissingCredentialError) {
    return { kind: 'authentication', detail: error.message };
  }

  const detail = messageOf(error);
  switch (codeOf(error)) {
    case 'AUTH_FAILED':
      return {
        kind: 'authentication',
        detail: 'The Host refused those credentials. Check the user and password or key.',
      };
    case 'HOST_KEY_REJECTED':
      return { kind: 'host-key', detail: 'The Host key was rejected.' };
    case 'TIMEOUT':
      return {
        kind: 'host-unreachable',
        detail: 'The Host did not answer in time. Check the address and that it is reachable.',
      };
    case 'CANCELLED':
      return { kind: 'user-closed', detail: 'The connection was cancelled.' };
    default:
      return {
        kind: 'host-unreachable',
        detail: detail === '' ? 'Could not reach the Host.' : detail,
      };
  }
}

/**
 * What tmux said when it refused the attach, as a kind.
 *
 * In tmux's own words, deliberately. "no sessions" and "can't find session
 * work" are different problems with different fixes — one means start
 * something on the Host, the other means the Session has gone — and no wording
 * of ours improves on tmux's. A path that is not a tmux is the third case and
 * reads nothing like either.
 */
export function reasonForAttachFailure(error: unknown): DisconnectReason {
  const detail = messageOf(error);
  const text = (error instanceof TmuxError ? (error.detail ?? detail) : detail).toLowerCase();

  if (
    text.includes('not found') ||
    text.includes('no such file') ||
    text.includes('permission denied') ||
    text.includes('not executable')
  ) {
    return { kind: 'tmux-unavailable', detail };
  }
  if (
    text.includes('no sessions') ||
    text.includes("can't find session") ||
    text.includes('no server running') ||
    text.includes('error connecting to')
  ) {
    return { kind: 'session-ended', detail };
  }
  return { kind: 'unknown', detail: detail === '' ? 'Could not attach.' : detail };
}

/**
 * What the Control Connection ending means, from why it ended.
 *
 * The cause is the classification: tmux letting go is the Session ending, the
 * channel disappearing is the transport, and this app closing it is the user.
 * Which of the three it was is something only the Connection knows, which is
 * why it says so rather than leaving the text to be read for clues.
 */
export function reasonForClosure(cause: ClosedCause, detail: string): DisconnectReason {
  switch (cause) {
    case 'exit': {
      // tmux letting go is the Session ending, in tmux's own words: "the
      // Session was detached", "server exited unexpectedly". The exception
      // is a tmux that was never there to let go of, which says so in the
      // shell's words instead and is a Host record to fix rather than a
      // Session to mourn.
      const classified = reasonForAttachFailure(new TmuxError(detail, detail));
      return classified.kind === 'tmux-unavailable'
        ? classified
        : { kind: 'session-ended', detail };
    }
    case 'channel':
      return { kind: 'transport-lost', detail };
    case 'local':
      return { kind: 'user-closed', detail };
  }
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
