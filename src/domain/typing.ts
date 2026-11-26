import type { AttachPhase } from '@/tmux/attach';
import type { DisconnectReason } from '@/tmux/disconnect-reason';

/** What a Typing that is not open waits for. */
export type TypingWait =
  | 'connecting'
  | 'reconnecting'
  | 'restoring'
  /** A Session switch is in progress: the old Session takes no keys. */
  | 'switching'
  /** The Host presented a different key, and the user has not accepted it. */
  | 'host-key';

/**
 * Whether keys reach the active Pane now. See CONTEXT.md.
 *
 * The one answer the cursor, the keyboard, the Key Row, the trackpad and the
 * Cover read. A Pane's first paint is not part of it: before that paint the
 * Connection is up and tmux takes keys.
 */
export type Typing =
  | { kind: 'open' }
  | { kind: 'waiting'; for: TypingWait }
  /** Null is an Attach closed on purpose. */
  | { kind: 'stopped'; reason: DisconnectReason | null };

export const OPEN: Typing = { kind: 'open' };

/** The Attach's facts that decide Typing. */
export interface TypingFacts {
  phase: AttachPhase;
  switching: boolean;
  keyChanged: boolean;
}

export function typingOf({ phase, switching, keyChanged }: TypingFacts): Typing {
  switch (phase.kind) {
    case 'connecting':
    case 'reconnecting':
    case 'restoring':
      return { kind: 'waiting', for: phase.kind };
    case 'disconnected':
      return { kind: 'stopped', reason: phase.reason };
    case 'closed':
      return { kind: 'stopped', reason: null };
    case 'connected':
      if (keyChanged) return { kind: 'waiting', for: 'host-key' };
      if (switching) return { kind: 'waiting', for: 'switching' };
      return OPEN;
  }
}

export function sameTyping(a: Typing, b: Typing): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'waiting' && b.kind === 'waiting') return a.for === b.for;
  if (a.kind === 'stopped' && b.kind === 'stopped') return a.reason === b.reason;
  return true;
}
