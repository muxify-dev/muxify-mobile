/**
 * A Host Write: one change the user asks of a Host, from the tap until the
 * user knows what became of it. See ADR 0020.
 *
 * A write is never sent again by itself, because it may have reached the Host
 * (ADR 0012). So the state says what the user may do next: nothing while it
 * runs, Retry when nothing reached the Host or the Host refused, and Check
 * when the phone cannot know.
 */

/**
 * Where a running write is. `connecting`: no command has left the phone.
 * `sending`: a command is on its way and may reach the Host. `checking`: a
 * read to find out whether an unsure write reached the Host. `attaching`: the
 * write reached the Host and the Attach opens what it made.
 */
export type HostWriteStep = 'connecting' | 'sending' | 'checking' | 'attaching';

export type HostWrite =
  | { kind: 'idle' }
  | { kind: 'running'; step: HostWriteStep; since: number }
  /**
   * Nothing reached the Host, the Host refused, or the Attach failed after
   * the write. `fields` holds the reasons that belong under one field each.
   */
  | { kind: 'failed'; reason: string; fields?: Readonly<Record<string, string>> }
  /** A command may have reached the Host, and no answer came. */
  | { kind: 'unsure'; reason: string };

/** How a run ended, as the runner sees it. */
export type HostWriteEnd =
  | { kind: 'done' }
  | { kind: 'refused'; reason: string; fields?: Readonly<Record<string, string>> }
  | { kind: 'threw'; reason: string };

export const IDLE: HostWrite = { kind: 'idle' };

/** A new send, or null when the tap must be ignored: one write runs at a time, and an unsure one is checked, not sent again. */
export function send(write: HostWrite, now: number): HostWrite | null {
  if (write.kind === 'running' || write.kind === 'unsure') return null;
  return { kind: 'running', step: 'connecting', since: now };
}

/** A check of an unsure write, or null when there is nothing to check. */
export function check(write: HostWrite, now: number): HostWrite | null {
  return write.kind === 'unsure' ? { kind: 'running', step: 'checking', since: now } : null;
}

export function reached(write: HostWrite, step: HostWriteStep): HostWrite {
  return write.kind === 'running' ? { ...write, step } : write;
}

export function ended(write: HostWrite, end: HostWriteEnd): HostWrite {
  if (write.kind !== 'running') return write;
  switch (end.kind) {
    case 'done':
      return IDLE;
    case 'refused':
      return end.fields ? { kind: 'failed', reason: end.reason, fields: end.fields } : { kind: 'failed', reason: end.reason };
    case 'threw':
      // A break while a command was out, or while finding out, leaves the Host's state unknown.
      return write.step === 'sending' || write.step === 'checking'
        ? { kind: 'unsure', reason: end.reason }
        : { kind: 'failed', reason: end.reason };
  }
}

/** Seconds after which a running write shows how long it has run. */
export const SHOW_ELAPSED_AFTER_S = 5;

/** The words of one kind of write, for the sentences that report it. */
export interface HostWriteWords {
  /** The Host's name, or null while it is not known. */
  host: string | null;
  /** What `sending` does, such as "Creating Fix login". */
  sending: string;
  /** What `attaching` does, such as "Opening fix-login". */
  attaching?: string;
  /** What may be true when the write is unsure, such as "The Topic may exist." */
  mayHaveHappened: string;
}

/** The sentence that reports a write, or null when there is nothing to report. */
export function hostWriteLine(write: HostWrite, words: HostWriteWords, now: number): string | null {
  const host = words.host ?? 'the Host';
  switch (write.kind) {
    case 'idle':
      return null;
    case 'running': {
      const doing = {
        connecting: `Connecting to ${host}`,
        sending: `${words.sending} on ${host}`,
        checking: `Checking ${host}`,
        attaching: words.attaching ?? 'Opening the Session',
      }[write.step];
      const seconds = Math.floor((now - write.since) / 1000);
      return seconds >= SHOW_ELAPSED_AFTER_S ? `${doing}… ${seconds} s` : `${doing}…`;
    }
    case 'failed':
      return write.fields ? null : write.reason;
    case 'unsure':
      return `${write.reason} ${words.mayHaveHappened}`;
  }
}
