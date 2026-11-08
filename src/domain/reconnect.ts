import { describeError } from '@/lib/describe-error';
import type { Settings } from '@/settings/settings';
import { describeConnectionFailure } from '@/ssh/failures';
import type { KeyVerdict } from '@/ssh/host-key';
import type { LastPlace, Records } from '@/storage/records';
import type { AttachPhase } from '@/tmux/attach';
import { shortLabel } from '@/tmux/disconnect-reason';

/** What "Trying to reconnect" shows, in the order a reconnect goes through them. */
export const RECONNECT_STEPS = [
  'connecting',
  'checking-host-key',
  'signing-in',
  'looking-for-session',
  'attaching',
] as const;
export type ReconnectStep = (typeof RECONNECT_STEPS)[number];

/** The steps before the Attach: one short visit to the Host to find the Session. */
export type LookupStep = Exclude<ReconnectStep, 'attaching'>;

/** Why the visit stopped, with what each step's message needs. */
export type LookupFailure =
  | { step: 'connecting'; reason: string }
  /** The key changed. The visit refused it, so nothing signed in past it. */
  | { step: 'checking-host-key'; fingerprint: string }
  | { step: 'signing-in' }
  /** `reason` is null when the Host answered and the Session is not in its list. */
  | { step: 'looking-for-session'; reason: string | null };

/** Why a reconnect stopped. It stays stopped until the user asks again. */
export type ReconnectFailure =
  | LookupFailure
  | { step: 'attaching'; title: string; reason: string | null };

/** How far that visit has gone. */
export type Lookup =
  | { kind: 'at'; step: LookupStep }
  | { kind: 'found' }
  | ({ kind: 'failed' } & LookupFailure);

/** Where a reconnect is, from the visit and then from the Attach's own phases. */
export type ReconnectProgress =
  | { kind: 'at'; step: ReconnectStep }
  | ({ kind: 'failed' } & ReconnectFailure)
  | { kind: 'attached' };

export const LOOKUP_START: Lookup = { kind: 'at', step: 'connecting' };

/**
 * The Last Place a cold start opens, or null for the Hosts list: the switch is
 * off, nothing is saved, or the Host it names has been deleted since.
 */
export function placeToReconnect(
  settings: Pick<Settings, 'reconnectOnStart'>,
  records: Pick<Records, 'hosts' | 'lastPlace'>,
): LastPlace | null {
  const place = records.lastPlace;
  if (!settings.reconnectOnStart || place === null) return null;
  return records.hosts.some((host) => host.id === place.hostId) ? place : null;
}

/**
 * The step to show. The Attach is asked for only once the visit has found the
 * Session, so until then its phase says nothing about this reconnect.
 */
export function reconnectProgress(lookup: Lookup, phase: AttachPhase | null): ReconnectProgress {
  if (lookup.kind !== 'found') return lookup;
  switch (phase?.kind) {
    case 'connected':
      return { kind: 'attached' };
    case 'disconnected':
      return {
        kind: 'failed',
        step: 'attaching',
        title: shortLabel(phase.reason),
        reason: phase.reason.detail === '' ? null : phase.reason.detail,
      };
    case 'closed':
      return { kind: 'failed', step: 'attaching', title: 'Disconnected', reason: null };
    default:
      return { kind: 'at', step: 'attaching' };
  }
}

export function reconnectStepLabel(step: ReconnectStep): string {
  switch (step) {
    case 'connecting':
      return 'Connecting';
    case 'checking-host-key':
      return 'Checking the host key';
    case 'signing-in':
      return 'Signing in';
    case 'looking-for-session':
      return 'Looking for the Session';
    case 'attaching':
      return 'Attaching';
  }
}

/** What a failed step says: a headline, and the Host's or the library's own words. */
export function failureText(
  failure: ReconnectFailure,
  place: { hostName: string; session: string },
): { title: string; reason: string | null } {
  const { hostName, session } = place;
  switch (failure.step) {
    case 'connecting':
      return { title: `Could not reach ${hostName}`, reason: failure.reason };
    case 'checking-host-key':
      return { title: `${hostName} presented a different host key`, reason: null };
    case 'signing-in':
      return { title: `${hostName} did not accept the Identity`, reason: null };
    case 'looking-for-session':
      return failure.reason === null
        ? { title: `${session} is no longer on ${hostName}`, reason: null }
        : { title: `Could not look for ${session} on ${hostName}`, reason: failure.reason };
    case 'attaching':
      return { title: failure.title, reason: failure.reason };
  }
}

/**
 * One short visit to the Host: connect, check the key, sign in, list the
 * Sessions. `onHostKey` answers whether to go on past the key, and
 * `onSignedIn` is told once the Host has let the visit in.
 */
export type SessionVisit = (hooks: {
  onHostKey: (verdict: KeyVerdict, fingerprint: string) => boolean;
  onSignedIn: () => void;
}) => Promise<readonly string[]>;

/**
 * A cold-start reconnect: the visit first, and `attach` only once it has found
 * the Session. A changed key ends the visit before it signs in, so `attach` is
 * never asked for past one. Tells `progress` each step as it starts.
 */
export async function reconnect({
  session,
  visit,
  attach,
  progress,
}: {
  session: string;
  visit: SessionVisit;
  attach: () => Promise<void>;
  progress: (lookup: Lookup) => void;
}): Promise<void> {
  let step: LookupStep = 'connecting';
  let changedKey: string | null = null;
  const at = (next: LookupStep) => {
    step = next;
    progress({ kind: 'at', step });
  };

  at('connecting');
  let sessions: readonly string[];
  try {
    sessions = await visit({
      onHostKey: (verdict, fingerprint) => {
        at('checking-host-key');
        if (verdict.kind === 'changed') {
          changedKey = fingerprint;
          return false;
        }
        at('signing-in');
        return true;
      },
      onSignedIn: () => at('looking-for-session'),
    });
  } catch (error) {
    progress({ kind: 'failed', ...visitFailure(step, changedKey, error) });
    return;
  }

  if (!sessions.includes(session)) {
    progress({ kind: 'failed', step: 'looking-for-session', reason: null });
    return;
  }
  await attach();
  progress({ kind: 'found' });
}

function visitFailure(step: LookupStep, changedKey: string | null, error: unknown): LookupFailure {
  if (changedKey !== null) return { step: 'checking-host-key', fingerprint: changedKey };
  switch (step) {
    case 'connecting':
    case 'checking-host-key':
      return { step: 'connecting', reason: describeConnectionFailure(error) };
    case 'signing-in':
      return { step: 'signing-in' };
    case 'looking-for-session':
      return { step: 'looking-for-session', reason: describeError(error) };
  }
}
