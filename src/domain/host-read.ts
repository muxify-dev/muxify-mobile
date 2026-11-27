/**
 * A Host Read: one question the user asks of a Host, from the tap or
 * keystroke until its answer, its failure or a newer question. See ADR 0040.
 *
 * It is pending from the ask, so a screen shows its progress line in the
 * render of the tap. The last answer stays until a current answer replaces
 * it. Each ask gets a ticket, and only the newest ticket's answer or failure
 * changes the read, so a late answer to a replaced ask changes nothing.
 */

/** A Host's answer, with the key it answers. */
export interface HostReadAnswer<K, D> {
  key: K;
  data: D;
}

/**
 * Why the newest ask failed. `hostProblem` is true when the read could not
 * use the Host at all: the Connections keep that as the Host Problem, and a
 * screen that shows the Host Problem in its own place does not show it again.
 */
export interface HostReadError<K> {
  key: K;
  reason: string;
  hostProblem: boolean;
}

export interface HostRead<K, D> {
  /** The number of the newest ask. Only its answer or failure changes the read. */
  ticket: number;
  /** The key of the newest ask, which Try again asks again. Null before the first ask. */
  asked: K | null;
  /** The ask that runs, and when it started. Null when nothing runs. */
  pending: { key: K; since: number } | null;
  /** The last answer. It stays through a newer ask and a failure. */
  answer: HostReadAnswer<K, D> | null;
  /** A current answer that the screen holds back, so the rows do not move under the finger. */
  held: HostReadAnswer<K, D> | null;
  /** The failure of the newest ask. Try again keeps it on screen until its result. */
  error: HostReadError<K> | null;
}

export function unasked<K, D>(): HostRead<K, D> {
  return { ticket: 0, asked: null, pending: null, answer: null, held: null, error: null };
}

export function isPending(read: HostRead<unknown, unknown>): boolean {
  return read.pending !== null;
}

/**
 * A new ask. It replaces any ask that runs and clears the failure of the
 * older key. A held answer goes on screen: the user is typing, so the rows
 * can move, and the held answer is newer than the one on screen.
 */
export function ask<K, D>(read: HostRead<K, D>, key: K, now: number): HostRead<K, D> {
  return { ...release(read), ticket: read.ticket + 1, asked: key, pending: { key, since: now }, error: null };
}

/** The newest key asked again, with its failure kept on screen, or null when the tap must be ignored. */
export function retry<K, D>(read: HostRead<K, D>, now: number): HostRead<K, D> | null {
  if (read.pending !== null || read.asked === null) return null;
  return { ...read, ticket: read.ticket + 1, pending: { key: read.asked, since: now }, held: null };
}

/** The ask stops, and any answer to it that still comes is dropped. */
export function cancel<K, D>(read: HostRead<K, D>): HostRead<K, D> {
  return read.pending === null ? read : { ...read, ticket: read.ticket + 1, pending: null };
}

/** The answer to the ask with `ticket`. `hold` keeps it in `held` instead of on screen. */
export function answered<K, D>(read: HostRead<K, D>, ticket: number, data: D, hold: boolean): HostRead<K, D> {
  if (ticket !== read.ticket || read.pending === null) return read;
  const answer = { key: read.pending.key, data };
  return hold
    ? { ...read, pending: null, held: answer, error: null }
    : { ...read, pending: null, answer, held: null, error: null };
}

export function failed<K, D>(read: HostRead<K, D>, ticket: number, reason: string, hostProblem = false): HostRead<K, D> {
  if (ticket !== read.ticket || read.pending === null) return read;
  return { ...read, pending: null, error: { key: read.pending.key, reason, hostProblem } };
}

/** The held answer goes on screen. */
export function release<K, D>(read: HostRead<K, D>): HostRead<K, D> {
  return read.held === null ? read : { ...read, answer: read.held, held: null };
}

/**
 * An answer the phone kept from an earlier visit. It shows only while the read
 * has no answer, and only for the key that runs, if one runs.
 */
export function seed<K, D>(read: HostRead<K, D>, answer: HostReadAnswer<K, D>): HostRead<K, D> {
  if (read.answer !== null || (read.pending !== null && read.pending.key !== answer.key)) return read;
  return { ...read, answer };
}

/** A read that ends after this long says its result to VoiceOver. A faster one stays quiet, so typing does not make it speak. */
export const ANNOUNCE_AFTER_MS = 1000;
