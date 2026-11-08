import type { Settings } from '@/settings/settings';
import type { LastPlace, Records } from '@/storage/records';
import type { AttachPhase } from '@/tmux/attach';

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

/** How far that visit has gone. */
export type Lookup =
  | { kind: 'at'; step: LookupStep }
  | { kind: 'found' }
  | { kind: 'failed'; step: LookupStep };

/** Where a reconnect is, from the visit and then from the Attach's own phases. */
export type ReconnectProgress =
  | { kind: 'at'; step: ReconnectStep }
  | { kind: 'failed'; step: ReconnectStep }
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
    case 'closed':
      return { kind: 'failed', step: 'attaching' };
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
