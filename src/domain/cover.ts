import type { ConnectStep } from '@/tmux/attach';
import type { DisconnectKind, DisconnectReason } from '@/tmux/disconnect-reason';

import { RECONNECT_STEPS, type Lookup, type ReconnectStep } from './reconnect';
import type { Typing } from './typing';

/** Why the Terminal Screen cannot go on: a Connection's ending, or one of two facts about the Host. */
export type Stop =
  | DisconnectKind
  /** The route names a Host that is not saved, or no Host at all. */
  | 'host-missing'
  /** The Host presented a different key, and the user has not accepted it. */
  | 'key-changed';

/** A button on a Cover. `reconnect` and `try-again` do the same; only the words differ. */
export type CoverAction =
  | 'reconnect'
  | 'try-again'
  | 'edit-host'
  | 'accept-key'
  | 'choose-session'
  | 'go-to-host'
  | 'go-to-hosts';

/**
 * The buttons for a Stop, in the order they show, the first one prominent.
 *
 * Go to Host is always there. A retry shows only where a retry the user asks
 * for could work, which is wider than the automatic retry (`retryCouldWork`):
 * the user can see the network come back, and the app cannot. Edit Host shows
 * where the Host record could be the cause.
 */
export function actionsFor(stop: Stop): readonly CoverAction[] {
  switch (stop) {
    case 'transport-lost':
      return ['reconnect', 'go-to-host'];
    case 'host-unreachable':
      return ['try-again', 'edit-host', 'go-to-host'];
    case 'unknown':
      return ['try-again', 'go-to-host'];
    case 'authentication':
    case 'tmux-unavailable':
      return ['edit-host', 'go-to-host'];
    case 'key-changed':
      return ['accept-key', 'go-to-host'];
    case 'session-ended':
      return ['choose-session', 'go-to-host'];
    case 'host-key':
    case 'user-closed':
      return ['go-to-host'];
    case 'host-missing':
      return ['go-to-hosts'];
  }
}

export function actionLabel(action: CoverAction): string {
  switch (action) {
    case 'reconnect':
      return 'Reconnect';
    case 'try-again':
      return 'Try again';
    case 'edit-host':
      return 'Edit Host';
    case 'accept-key':
      return 'Accept new key';
    case 'choose-session':
      return 'Choose a Session';
    case 'go-to-host':
      return 'Go to Host';
    case 'go-to-hosts':
      return 'Go to Hosts';
  }
}

/** A Stop as the user reads it: a headline, the Host's or the library's own words, and the buttons. */
export interface Failure {
  stop: Stop;
  title: string;
  reason: string | null;
  actions: readonly CoverAction[];
}

/** The Session and Host a Cover talks about. */
export interface Place {
  hostName: string;
  session: string;
}

/** One row of the Connection Screen's step list. */
export interface StepMark {
  step: ReconnectStep;
  state: 'done' | 'at' | 'failed' | 'waiting';
}

/** What a Pane must not be painted under: a short wait or a failure. */
export type Notice =
  | { kind: 'none' }
  | { kind: 'banner'; label: string }
  | { kind: 'card'; failure: Failure };

/**
 * What the Terminal Screen draws over the Window while Typing is not open. See
 * CONTEXT.md.
 *
 * `connection-screen` covers everything: nothing has been painted to keep.
 * `content` keeps the last content, dimmed, and takes every touch, with a
 * Banner for a wait or a card for a failure.
 */
export type Cover =
  | { kind: 'none' }
  | {
      kind: 'connection-screen';
      title: string;
      steps: readonly StepMark[] | null;
      failure: Failure | null;
      actions: readonly CoverAction[];
    }
  | { kind: 'content'; notice: Notice };

export interface CoverFacts {
  /** Why the screen could not ask for an Attach at all, or null. */
  missing: string | null;
  /** The cold-start visit, or null when this screen was not opened by one. */
  lookup: Lookup | null;
  /** The current Attach, or null before there is one. */
  attach: { typing: Typing; step: ConnectStep; paintedOnce: boolean } | null;
  place: Place;
}

/** The steps a first connect goes through, as the Attach publishes them. */
export const ATTACH_STEPS: readonly ReconnectStep[] = RECONNECT_STEPS.filter(
  (step) => step !== 'looking-for-session',
);

const NONE: Cover = { kind: 'none' };
const DIMMED: Cover = { kind: 'content', notice: { kind: 'none' } };

/**
 * The one Cover for every combination of the facts.
 *
 * No content painted yet: the Connection Screen, with the step list and the
 * failure if there is one. Content painted: that content dimmed, with a Banner
 * while it waits and a card when it has stopped. A Session switch dims and
 * says nothing: the Title Sheet is over it and shows the switch.
 */
export function coverOf({ missing, lookup, attach, place }: CoverFacts): Cover {
  if (missing !== null) {
    const failure = failureOf('host-missing', missing, null);
    return { kind: 'connection-screen', title: 'Terminal', steps: null, failure, actions: failure.actions };
  }

  if (lookup !== null && lookup.kind !== 'found') {
    const failure = lookup.kind === 'failed' ? lookupFailure(lookup, place) : null;
    return screen('Trying to reconnect', marks(RECONNECT_STEPS, lookup.step, failure !== null), failure);
  }

  const steps = lookup === null ? ATTACH_STEPS : RECONNECT_STEPS;
  const title = (wait: string) => (lookup === null ? wait : 'Trying to reconnect');
  if (attach === null) return screen(title('Connecting'), marks(steps, lookup === null ? 'connecting' : 'attaching', false), null);

  const at: ReconnectStep = lookup === null ? attach.step : 'attaching';
  const { typing, paintedOnce } = attach;
  switch (typing.kind) {
    case 'open':
      return paintedOnce ? NONE : screen(title('Connecting'), marks(steps, at, false), null);
    case 'waiting': {
      if (typing.for === 'switching') return DIMMED;
      if (typing.for === 'host-key') {
        const failure = failureOf(
          'key-changed',
          `${place.hostName} presented a different host key`,
          KEY_CHANGED_REASON,
        );
        return paintedOnce ? card(failure) : screen(title('Connecting'), marks(steps, at, true), failure);
      }
      const label = WAIT_LABELS[typing.for];
      return paintedOnce
        ? { kind: 'content', notice: { kind: 'banner', label } }
        : screen(title(label), marks(steps, at, false), null);
    }
    case 'stopped': {
      // Closed on purpose: the screen is already on its way out.
      if (typing.reason === null || typing.reason.kind === 'user-closed') return NONE;
      const failure = stopFailure(typing.reason, place);
      return paintedOnce ? card(failure) : screen(title('Connecting'), marks(steps, at, true), failure);
    }
  }
}

const WAIT_LABELS = { connecting: 'Connecting', reconnecting: 'Reconnecting', restoring: 'Restoring' } as const;

const KEY_CHANGED_REASON = 'It may have been rebuilt, or something may be intercepting the connection.';

function screen(title: string, steps: readonly StepMark[], failure: Failure | null): Cover {
  return { kind: 'connection-screen', title, steps, failure, actions: failure?.actions ?? ['go-to-host'] };
}

function card(failure: Failure): Cover {
  return { kind: 'content', notice: { kind: 'card', failure } };
}

function marks(steps: readonly ReconnectStep[], at: ReconnectStep, failed: boolean): StepMark[] {
  const current = steps.indexOf(at);
  return steps.map((step, index) => ({
    step,
    state: index < current ? 'done' : index > current ? 'waiting' : failed ? 'failed' : 'at',
  }));
}

function failureOf(stop: Stop, title: string, reason: string | null): Failure {
  return { stop, title, reason, actions: actionsFor(stop) };
}

/** An Attach's ending, in the words the user reads. */
export function stopFailure(reason: DisconnectReason, { hostName, session }: Place): Failure {
  const detail = reason.detail === '' ? null : reason.detail;
  switch (reason.kind) {
    case 'transport-lost':
      return failureOf(reason.kind, 'Connection lost', detail);
    case 'host-unreachable':
      return failureOf(reason.kind, `Could not reach ${hostName}`, detail);
    case 'authentication':
      return failureOf(reason.kind, `${hostName} did not accept the Identity`, detail);
    case 'host-key':
      return failureOf(reason.kind, `${hostName}'s host key was refused`, detail);
    case 'tmux-unavailable':
      return failureOf(reason.kind, `tmux is not on ${hostName}`, detail);
    case 'session-ended':
      return failureOf(reason.kind, `${session} has ended`, detail);
    case 'user-closed':
    case 'unknown':
      return failureOf(reason.kind, 'Disconnected', detail);
  }
}

/**
 * A Host Problem in the words the user reads: the headline and the reason the
 * Cover would give for the same fault, so a screen and the Cover never word
 * one fault two ways.
 */
export function hostProblemWords(reason: DisconnectReason, hostName: string): { title: string; detail: string | null } {
  const { title, reason: detail } = stopFailure(reason, { hostName, session: '' });
  return { title, detail };
}

/** Where the cold-start visit stopped, in the words the user reads. */
function lookupFailure(lookup: Extract<Lookup, { kind: 'failed' }>, { hostName, session }: Place): Failure {
  switch (lookup.step) {
    case 'connecting':
      return failureOf('host-unreachable', `Could not reach ${hostName}`, lookup.reason);
    case 'checking-host-key':
      return failureOf('key-changed', `${hostName} presented a different host key`, KEY_CHANGED_REASON);
    case 'signing-in':
      return failureOf('authentication', `${hostName} did not accept the Identity`, null);
    case 'looking-for-session':
      return lookup.reason === null
        ? failureOf('session-ended', `${session} is no longer on ${hostName}`, null)
        : failureOf('unknown', `Could not look for ${session} on ${hostName}`, lookup.reason);
  }
}
