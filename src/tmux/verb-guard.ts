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
  | {
      readonly kind: 'read';
      readonly held: number;
      readonly serverPid: number;
      readonly error: string | null;
      /** The Pane the Session's Op made, when a guarded line recorded it. */
      readonly madePane: string | null;
      /** The Pane active now. Only right after the verb is it the one the verb made. */
      readonly activePane: string | null;
    }
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

/**
 * What became of a tap. Its promise reports every one but `dropped` as it
 * ends, and the fate of a verb that was kept for a break arrives after it.
 */
export type Outcome =
  /** tmux ran it, and `paneId` is the Pane it made: the new Pane of a split, the first Pane of a New Window. */
  | { readonly kind: 'made'; readonly paneId: string }
  /** The Connection broke before tmux answered. The verb is kept, and its fate comes with the next Connection. */
  | { readonly kind: 'waits' }
  | { readonly kind: 'refused'; readonly error: string }
  /** It will never run, or ran and left no Pane to name. */
  | { readonly kind: 'dropped'; readonly reason: string };

/** How a verb ended: every Outcome but `waits`, which is not an end. Each tap gets exactly one. */
export type VerbFate = Exclude<Outcome, { readonly kind: 'waits' }>;

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

/**
 * A verb that tmux ran, as the read says. Which Pane it made is what the line
 * recorded; a line that could not record it (tmux below 3.2) was read right
 * after the verb, when the active Pane is the one it made.
 */
function ranOutcome(sent: SentVerb, answer: Extract<VerbAnswer, { kind: 'read' }>): Outcome {
  const paneId = answer.madePane ?? (sent.guarded ? null : answer.activePane);
  return paneId === null ? { kind: 'dropped', reason: 'tmux ran it but did not say which Pane it made' } : { kind: 'made', paneId };
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
          const ran = ranOutcome(sent, answer);
          return idle(...(ran.kind === 'dropped' ? [{ kind: 'say' as const, line: `${label(sent)} ${ran.reason}` }] : []), {
            kind: 'settled',
            op: sent.op,
            outcome: ran,
          });
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
          const reason = 'the tmux server started again';
          return idle(
            { kind: 'say', line: `${label(sent)} dropped: ${reason}` },
            { kind: 'settled', op: sent.op, outcome: { kind: 'dropped', reason } },
          );
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
        if (answer.kind === 'read') {
          const ran = ranOutcome(sent, answer);
          return idle(
            { kind: 'say', line: `${label(sent)} ran before the break${ran.kind === 'dropped' ? `, but ${ran.reason}` : ''}` },
            { kind: 'settled', op: sent.op, outcome: ran },
          );
        }
        const reason = answer.kind === 'gone' ? 'the Session is gone' : `the Session's Op did not read: ${answer.error}`;
        return idle(
          { kind: 'say', line: `${label(sent)} dropped: ${reason}` },
          { kind: 'settled', op: sent.op, outcome: { kind: 'dropped', reason } },
        );
      }
      return same;
    }

    case 'lost': {
      if (phase.kind === 'checking') return { guard: { ...guard, phase: { kind: 'kept', sent: phase.sent } }, effects: [] };
      if (phase.kind !== 'sending') return same;
      const { sent } = phase;
      if (!sent.guarded) {
        const reason = 'tmux is older than 3.2 and cannot refuse a copy, so it is not sent again';
        return idle(
          { kind: 'say', line: `${label(sent)} dropped: ${reason}` },
          { kind: 'settled', op: sent.op, outcome: { kind: 'dropped', reason } },
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
   *
   * `onFate` hears how the verb ended, once, also when that is after the
   * promise: a verb kept through a break ends with the next Connection. It
   * says `dropped` for a verb that was never sent. A guard that is closed says
   * nothing.
   */
  run(verb: Verb, session: string, onFate?: (fate: VerbFate) => void): Promise<void>;
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
  /** Who hears how each sent verb ends. It outlives the tap's promise, which a break can end early. */
  const fates = new Map<Op, (fate: VerbFate) => void>();
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
      if (outcome.kind !== 'waits') {
        const hear = fates.get(effect.op);
        fates.delete(effect.op);
        hear?.(outcome);
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

  async function runOne(verb: Verb, session: string, onFate?: (fate: VerbFate) => void): Promise<void> {
    const drop = (reason: string) => {
      if (closed) return;
      options.say(`${describeVerb(verb)} in ${session} dropped: ${reason}`);
      onFate?.({ kind: 'dropped', reason });
    };
    // A verb kept from a lost Connection goes first.
    while (guard.phase.kind !== 'idle') {
      if (!link || closed) return drop('the Connection broke before it was sent');
      await new Promise<void>((resolve) => wake.push(resolve));
    }
    const current = link;
    if (!current || closed) return drop('there was no Connection');
    const mine = epoch;
    const server = await current.verbServer();
    if (mine !== epoch) return drop('the Connection broke before it was sent');
    if (closed) return;
    if (guard.phase.kind !== 'idle') return drop('another verb was waiting for tmux');
    const done = new Promise<void>((resolve, reject) => taps.set(guard.nextOp, { resolve, reject }));
    if (onFate) fates.set(guard.nextOp, onFate);
    apply({ kind: 'tapped', verb, session, ...server });
    return done;
  }

  return {
    run(verb, session, onFate) {
      const turn = queue.then(() => runOne(verb, session, onFate));
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
      fates.clear();
      for (const resolve of wake.splice(0)) resolve();
    },
  };
}
