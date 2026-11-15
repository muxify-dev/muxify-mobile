import { describeError } from '@/lib/describe-error';

import type { OutboxToken } from './commands';
import { newOutboxToken } from './input-outbox';

/** The number of one Session verb. One count for each Attach, which only grows. */
export type Op = number & { readonly __brand: 'Op' };

/** A change to a Session, not input to a Pane, so it is not on a Lane. */
export type Verb =
  | { readonly kind: 'split'; readonly direction: 'right' | 'down' }
  | { readonly kind: 'new-window' };

export interface SentVerb {
  readonly op: Op;
  readonly verb: Verb;
  /** The Session target at the tap: its id when the Attach knows it, so a rename does not lose it. */
  readonly session: string;
  /** False on tmux below 3.2, which cannot refuse a copy of the line. */
  readonly guarded: boolean;
  /**
   * The pid of the tmux server at the tap. A server that started again can
   * give a new Session the same id, and its Op reads as 0. Null when unknown.
   */
  readonly serverPid: number | null;
}

/** The tmux server of a Connection, as a tap records it. */
export interface VerbServer {
  readonly guarded: boolean;
  readonly serverPid: number | null;
}

/** What tmux said to a verb line, or to a read of the Session's Op. */
export type VerbAnswer =
  | { readonly kind: 'read'; readonly held: number; readonly serverPid: number; readonly error: string | null }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly error: string };

export type GuardPhase =
  | { readonly kind: 'idle' }
  /** The line is on its way on this Connection. `again`: a new Connection sends it a second time. */
  | { readonly kind: 'sending'; readonly sent: SentVerb; readonly again: boolean }
  /** The Connection broke before tmux answered. */
  | { readonly kind: 'kept'; readonly sent: SentVerb }
  /** A new Connection reads the Session's Op before it sends anything. */
  | { readonly kind: 'checking'; readonly sent: SentVerb };

/** One unconfirmed verb at a time. */
export interface Guard {
  readonly nextOp: Op;
  readonly phase: GuardPhase;
}

export type GuardEvent =
  | ({ readonly kind: 'tapped'; readonly verb: Verb; readonly session: string } & VerbServer)
  | { readonly kind: 'answered'; readonly answer: VerbAnswer }
  | { readonly kind: 'lost' }
  | { readonly kind: 'connected' };

/** What became of a tap, which its promise reports. */
export type Outcome = { readonly kind: 'done' } | { readonly kind: 'waits' } | { readonly kind: 'refused'; readonly error: string };

export type GuardEffect =
  | { readonly kind: 'send'; readonly sent: SentVerb }
  | { readonly kind: 'read'; readonly sent: SentVerb }
  | { readonly kind: 'settled'; readonly op: Op; readonly outcome: Outcome }
  | { readonly kind: 'say'; readonly line: string };

export const IDLE: Guard = { nextOp: 1 as Op, phase: { kind: 'idle' } };

export function describeVerb(verb: Verb): string {
  return verb.kind === 'split' ? `split ${verb.direction}` : 'New Window';
}

function label(sent: SentVerb): string {
  return `Op ${sent.op} (${describeVerb(sent.verb)} in ${sent.session})`;
}

/** The rules of the guard. Pure: the runner below does what the effects ask. */
export function step(guard: Guard, event: GuardEvent): { guard: Guard; effects: GuardEffect[] } {
  const { phase } = guard;
  const idle = (...effects: GuardEffect[]) => ({ guard: { ...guard, phase: { kind: 'idle' } as const }, effects });
  const same = { guard, effects: [] };

  switch (event.kind) {
    case 'tapped': {
      if (phase.kind !== 'idle') return same;
      const { verb, session, guarded, serverPid } = event;
      const sent: SentVerb = { op: guard.nextOp, verb, session, guarded, serverPid };
      return {
        guard: { nextOp: (guard.nextOp + 1) as Op, phase: { kind: 'sending', sent, again: false } },
        effects: [{ kind: 'send', sent }],
      };
    }

    case 'answered': {
      const { answer } = event;
      if (phase.kind === 'sending') {
        const { sent } = phase;
        if (answer.kind === 'read' && answer.held >= sent.op) {
          return idle({ kind: 'settled', op: sent.op, outcome: { kind: 'done' } });
        }
        const error =
          answer.kind === 'gone' ? 'the Session is gone' : (answer.error ?? 'tmux did not run it');
        return idle(
          { kind: 'say', line: `${label(sent)} refused: ${error}` },
          { kind: 'settled', op: sent.op, outcome: { kind: 'refused', error } },
        );
      }
      if (phase.kind === 'checking') {
        const { sent } = phase;
        if (answer.kind === 'read' && answer.serverPid !== sent.serverPid) {
          return idle({ kind: 'say', line: `${label(sent)} dropped: the tmux server started again` });
        }
        if (answer.kind === 'read' && answer.held < sent.op) {
          return {
            guard: { ...guard, phase: { kind: 'sending', sent, again: true } },
            effects: [
              { kind: 'say', line: `${label(sent)} did not run before the break; sending it again` },
              { kind: 'send', sent },
            ],
          };
        }
        const line =
          answer.kind === 'read'
            ? `${label(sent)} ran before the break`
            : answer.kind === 'gone'
              ? `${label(sent)} dropped: the Session is gone`
              : `${label(sent)} dropped: the Session's Op did not read: ${answer.error}`;
        return idle({ kind: 'say', line });
      }
      return same;
    }

    case 'lost': {
      if (phase.kind === 'checking') return { guard: { ...guard, phase: { kind: 'kept', sent: phase.sent } }, effects: [] };
      if (phase.kind !== 'sending') return same;
      const { sent } = phase;
      if (!sent.guarded) {
        return idle(
          { kind: 'say', line: `${label(sent)} dropped: tmux is older than 3.2 and cannot refuse a copy, so it is not sent again` },
          { kind: 'settled', op: sent.op, outcome: { kind: 'waits' } },
        );
      }
      return {
        guard: { ...guard, phase: { kind: 'kept', sent } },
        effects: [
          { kind: 'say', line: `${label(sent)} waits for the Connection to learn if tmux ran it` },
          { kind: 'settled', op: sent.op, outcome: { kind: 'waits' } },
        ],
      };
    }

    case 'connected': {
      if (phase.kind !== 'kept') return same;
      return { guard: { ...guard, phase: { kind: 'checking', sent: phase.sent } }, effects: [{ kind: 'read', sent: phase.sent }] };
    }
  }
}

/** The Connection as the guard needs it. Each call rejects only when the Connection ends. */
export interface VerbLink {
  verbServer(): Promise<VerbServer>;
  runVerb(sent: SentVerb, token: OutboxToken): Promise<VerbAnswer>;
  readOp(session: string, token: OutboxToken): Promise<VerbAnswer>;
}

/**
 * Split and New Window, sent one time across a break.
 *
 * It outlives each Connection, as the Outbox does, and runs what `step` asks
 * on the Connection in force. An answer from a Connection that ended is
 * dropped by its epoch.
 */
export interface VerbGuard {
  /**
   * Ends when tmux confirms the verb, or when the Connection breaks first: the
   * guard then keeps it for the next Connection. Rejects when tmux refuses it.
   * With no Connection it does nothing.
   */
  run(verb: Verb, session: string): Promise<void>;
  connected(link: VerbLink): void;
  lost(): void;
  close(): void;
}

export interface VerbGuardOptions {
  say: (line: string) => void;
  /** A verb sent again after a break that tmux refused. No tap waits for it. */
  onRefused: (error: string) => void;
}

export function createVerbGuard(options: VerbGuardOptions): VerbGuard {
  const token = newOutboxToken();
  let guard = IDLE;
  let link: VerbLink | null = null;
  let epoch = 0;
  let closed = false;
  const taps = new Map<Op, { resolve: () => void; reject: (error: Error) => void }>();
  const wake: (() => void)[] = [];
  /** Taps run one after another: the guard has one unconfirmed verb at a time. */
  let queue: Promise<unknown> = Promise.resolve();

  function apply(event: GuardEvent): void {
    if (closed) return;
    const next = step(guard, event);
    guard = next.guard;
    for (const effect of next.effects) run(effect);
    for (const resolve of wake.splice(0)) resolve();
  }

  function run(effect: GuardEffect): void {
    if (effect.kind === 'say') {
      options.say(effect.line);
      return;
    }
    if (effect.kind === 'settled') {
      const tap = taps.get(effect.op);
      taps.delete(effect.op);
      const { outcome } = effect;
      if (outcome.kind === 'refused') {
        if (tap) tap.reject(new Error(outcome.error));
        else options.onRefused(outcome.error);
      } else {
        tap?.resolve();
      }
      return;
    }
    const current = link;
    if (!current) return;
    const mine = epoch;
    const asked = effect.kind === 'send' ? current.runVerb(effect.sent, token) : current.readOp(effect.sent.session, token);
    asked.then(
      (answer) => {
        if (mine === epoch) apply({ kind: 'answered', answer });
      },
      (error: unknown) => {
        // `lost` comes before a Connection's commands fail, so a failure in
        // the same epoch is not a break.
        if (mine === epoch) apply({ kind: 'answered', answer: { kind: 'failed', error: describeError(error) } });
      },
    );
  }

  async function runOne(verb: Verb, session: string): Promise<void> {
    const dropped = () => {
      if (!closed) options.say(`${describeVerb(verb)} in ${session} dropped: the Connection broke before it was sent`);
    };
    // A verb kept from a lost Connection goes first.
    while (guard.phase.kind !== 'idle') {
      if (!link || closed) return dropped();
      await new Promise<void>((resolve) => wake.push(resolve));
    }
    const current = link;
    if (!current || closed) return;
    const mine = epoch;
    const server = await current.verbServer();
    if (mine !== epoch) return dropped();
    if (closed || guard.phase.kind !== 'idle') return;
    const done = new Promise<void>((resolve, reject) => taps.set(guard.nextOp, { resolve, reject }));
    apply({ kind: 'tapped', verb, session, ...server });
    return done;
  }

  return {
    run(verb, session) {
      const turn = queue.then(() => runOne(verb, session));
      queue = turn.catch(() => {});
      return turn;
    },

    connected(next) {
      if (closed) return;
      link = next;
      epoch += 1;
      apply({ kind: 'connected' });
    },

    lost() {
      if (closed || link === null) return;
      link = null;
      epoch += 1;
      apply({ kind: 'lost' });
    },

    close() {
      if (closed) return;
      closed = true;
      link = null;
      epoch += 1;
      for (const tap of taps.values()) tap.resolve();
      taps.clear();
      for (const resolve of wake.splice(0)) resolve();
    },
  };
}
