import type { AttachPhase } from './attach';
import { shortLabel } from './disconnect-reason';

/**
 * What an Attach's phase is called, wherever it is shown.
 *
 * One function because there are two places — the Terminal Screen's status
 * banner and the Host Screen's row for the attached Session — and they are
 * describing the same Connection. Two switches producing the same strings is
 * two chances for them to disagree about a Session the user is looking at from
 * both sides of a navigation push.
 *
 * The words are `remux`'s own: Connecting, Connected, Restoring after a
 * foreground check, Reconnecting after a lost transport, and a short label per
 * disconnect reason. See ADR 0007.
 */
export function phaseLabel(phase: AttachPhase): string {
  switch (phase.kind) {
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'restoring':
      return 'Restoring';
    case 'reconnecting':
      return 'Reconnecting';
    case 'disconnected':
      return shortLabel(phase.reason);
    case 'closed':
      return 'Disconnected';
  }
}
