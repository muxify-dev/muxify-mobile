import type { Clock } from '@/lib/clock';
import { systemClock } from '@/lib/clock';

/**
 * Somewhere to say what happened.
 *
 * The narrow half of the Log: every module that does something worth knowing
 * about afterwards takes one of these and says so in a line. `tag` names the
 * part of the app speaking — `attach`, `pane %3`, `screen` — so a reader can
 * follow one thread through the whole record, or see two threads disagree.
 *
 * Deliberately one method. A module that wants levels, structured fields or a
 * sink of its own is a module that has started building a logging framework,
 * and this is a notebook.
 */
export interface Log {
  record(tag: string, text: string): void;
}

export interface LogEntry {
  /** When, as the clock gave it: milliseconds since the epoch. */
  at: number;
  tag: string;
  text: string;
}

/**
 * The Log itself: what was recorded, and the way to read it back.
 *
 * The wide half. Only the place that hands the Log to the user reads it, and
 * that place is the Host Screen's Copy log action; everything else sees a Log
 * and can only write.
 */
export interface LogBook extends Log {
  /** Everything held, oldest first. A copy: the Log keeps moving. */
  entries(): readonly LogEntry[];
  /** The whole Log as text, one line per entry, oldest first. */
  render(): string;
  clear(): void;
}

/** A Log that keeps nothing. What a module gets when nobody asked. */
export const silentLog: Log = { record: () => {} };

/**
 * How many lines the Log keeps before the oldest go.
 *
 * Two thousand is about ten minutes of a busy Session or an afternoon of a
 * quiet one, and comes to a couple of hundred kilobytes of text — which a
 * clipboard carries and a chat window accepts. The Log is for what just went
 * wrong, and what went wrong an hour ago is what the next reproduction is for.
 */
export const LOG_CAPACITY = 2000;

/**
 * The most one line may say.
 *
 * A line is a sentence about an event, not the event. A capture, a reply or a
 * stack trace pasted whole would push a hundred real lines out of the Log to
 * make room for one nobody will read to the end.
 */
export const LOG_LINE_LIMIT = 400;

/**
 * The Log: Muxify's own record of what it did, for when the screen does not say.
 *
 * A bounded list of one-line entries, kept in memory for the life of the app
 * and copied out by the user from the Host Screen. It exists because the
 * failures worth having are the ones that cannot be reproduced on demand: a
 * Pane that came up blank once on a Tuesday is a Pane whose Surface, Topology
 * and sizing all made a decision in the half-second before, and by the time
 * anyone is looking those decisions are gone. The Log is where they are kept.
 *
 * It says what the app *decided*, never what the user *typed* or the Host
 * *showed*: which Pane got a Surface, what grid was reported, which command
 * went out and whether tmux liked it. Pane content and keystrokes are the
 * user's and stay out of it, so a Log can be pasted anywhere without a second
 * look. See ADR 0010.
 *
 * Nothing here is ever awaited or thrown from. A record that could fail would
 * be one more thing to go wrong at exactly the moment it is meant to describe.
 */
export function createLog(options: { capacity?: number; clock?: Clock } = {}): LogBook {
  const clock = options.clock ?? systemClock;
  const capacity = Math.max(1, options.capacity ?? LOG_CAPACITY);
  let entries: LogEntry[] = [];

  return {
    record(tag: string, text: string): void {
      const line =
        text.length > LOG_LINE_LIMIT ? `${text.slice(0, LOG_LINE_LIMIT - 1)}…` : text;
      entries.push({ at: clock.now(), tag, text: line });
      // The oldest go first: what happened long ago is what the next
      // reproduction is for, and what happened just now is why anyone looks.
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    },

    entries: () => [...entries],

    render: () => entries.map(formatEntry).join('\n'),

    clear(): void {
      entries = [];
    },
  };
}

/**
 * A Log that speaks as one part of the app.
 *
 * What a module keeps rather than the Log itself: a module has one name, and
 * writing it out at every call is a name that eventually gets misspelt in one
 * place and splits the thread.
 */
export function speakingAs(log: Log, tag: string): (text: string) => void {
  return (text) => log.record(tag, text);
}

/** One entry as its line: the time of day, the speaker, what it said. */
export function formatEntry(entry: LogEntry): string {
  return `${timeOfDay(entry.at)} ${entry.tag.padEnd(10)} ${entry.text}`;
}

/**
 * `16:50:12.345`, in the phone's own time.
 *
 * Local rather than UTC because the person reading the Log is the person who
 * was holding the phone, and "it went blank at ten to five" is what they
 * remember.
 */
export function timeOfDay(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${millis}`;
}
