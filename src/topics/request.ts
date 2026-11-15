/**
 * The Request id that the phone gives a Host CLI write, and what a write with
 * no answer becomes. See ADR 0021.
 */

/** A UUID that names one thing the user asked for. The Host applies it one time. */
export type RequestId = string & { readonly __brand: 'RequestId' };

/** The capability name in `environment show --json` of a Host CLI that takes `--request`. */
export const REQUEST_CAPABILITY = 'request';

/**
 * A new id, in the UUID layout that the Host CLI accepts. Hermes has no
 * `crypto.randomUUID`. The id is a name and not a secret, so `Math.random`
 * is enough.
 */
export function newRequestId(): RequestId {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const text = hex.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}` as RequestId;
}

/**
 * Exit status 4: the Host says that the Request changed its records and did
 * not finish, and that its command is not safe to run again. `message` is the
 * Host's words. The change may have reached the Host.
 */
export interface UnknownOutcome {
  kind: 'unknown';
  message: string;
}

/**
 * The exec of a write that went out with `--request` ended with no answer. The
 * same Request can go out again: the Host applies it one time.
 */
export class RequestUnanswered extends Error {
  constructor(
    readonly request: RequestId,
    readonly cause: unknown,
  ) {
    super('The Host did not answer the Request.');
    this.name = 'RequestUnanswered';
  }
}

/**
 * A write went out and no answer came back. It is not a failed dial, where
 * nothing went out. `resent` is true when the write had a Request id and its
 * second send also got no answer.
 */
export class WriteOutcomeUnknown extends Error {
  constructor(
    readonly resent: boolean,
    readonly cause: unknown,
  ) {
    super('The Host did not answer.');
    this.name = 'WriteOutcomeUnknown';
  }
}

/** One thing the user asked for: what it sends, and the Request id that stays with it. */
export interface Intent {
  /** What the write sends, as one string to compare. */
  key: string;
  request: RequestId;
}

/**
 * The Intent for what the user sends now. It is the held one while the user
 * sends the same thing, so a Try again is the same Request. A change makes a
 * new one, because the Host refuses an id that comes with other arguments.
 */
export function intentFor(held: Intent | null, key: string, make: () => RequestId = newRequestId): Intent {
  return held?.key === key ? held : { key, request: make() };
}

/**
 * The Intent to hold after the Host answered. A refusal holds none: the Host
 * keeps a refusal with its id for 24 hours, so a second send must have a new
 * id to get a new answer.
 */
export function intentAfter(intent: Intent, outcome: { kind: string }): Intent | null {
  return outcome.kind === 'failed' ? null : intent;
}
