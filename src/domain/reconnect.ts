import { describeError } from '@/lib/describe-error';
import type { Settings } from '@/settings/settings';
import { describeConnectionFailure } from '@/ssh/failures';
import type { KeyVerdict } from '@/ssh/host-key';
import type { LastPlace, Records } from '@/storage/records';

/** What the Connection Screen shows for a cold start, in the order a reconnect goes through them. */
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

/** How far that visit has gone. */
export type Lookup =
  | { kind: 'at'; step: LookupStep }
  | { kind: 'found' }
  | ({ kind: 'failed' } & LookupFailure);

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
