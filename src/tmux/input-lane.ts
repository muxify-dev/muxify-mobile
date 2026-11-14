/**
 * The rules of typed input for one Pane, as a value and one function.
 *
 * A key the user typed has three possible ends: tmux confirms that it reached
 * the Pane, or the user sees it and decides (held), or the user is told that
 * it was thrown away (discarded). A Lane is everything known about one Pane's
 * keys, and `step` is the only place that changes it. No clock, no promise and
 * no tmux words in here: the Outbox runs the effects and feeds the answers
 * back in.
 */
import { bytesToUtf8 } from '@/lib/utf8';

import type { KeyPress } from './key-press';

/**
 * The number of a Batch. One count for the whole Outbox, which only grows.
 *
 * A Pane keeps the highest Seq it took, and a respawned Pane keeps it too. So
 * a number is never used twice: an old number on a Pane then never covers
 * keys that it did not get.
 */
export type Seq = number & { readonly __brand: 'Seq' };

/** One thing on its way into a Pane. Text is bytes; a key is a name that tmux encodes for the program. */
export type Key =
  | {
      readonly kind: 'text';
      readonly bytes: readonly number[];
      /** Bytes that a scroll or a tap made. They are sent while the Pane is live and never again. */
      readonly gesture: boolean;
    }
  | { readonly kind: 'key'; readonly key: string | KeyPress };

/** A Key that waits, with the time of its first byte. */
export type Typed = Key & { readonly typedAt: number };

/**
 * One Key that was written to a Connection under a Seq.
 *
 * It never changes after the first write. A second write, after a break,
 * carries the same Seq and the same Key, so tmux can refuse the copy.
 */
export interface Batch {
  readonly seq: Seq;
  readonly key: Key;
  readonly typedAt: number;
}

/** What tmux says about a Pane at one moment. */
export interface PaneMark {
  /** Changes when the tmux server starts again. */
  readonly serverPid: number;
  /** Changes when the Pane is another Pane with the same id, also after `respawn-pane`. */
  readonly panePid: number;
  readonly program: string;
  /** The highest Seq of this Outbox that the Pane took, or null for none. */
  readonly ack: Seq | null;
}

export type MarkRead = PaneMark | 'gone';

/** `refused`: tmux answered with an error that is not a missing Pane. */
export type DeliverResult = MarkRead | { readonly refused: string };

export type HoldReason =
  | 'risky-keys'
  | 'stale'
  | 'program-changed'
  /** The Pane's number went back, so the Outbox cannot say if the oldest key arrived. */
  | 'unsure-delivered'
  /** tmux never told this Outbox which Pane had the id before the break. */
  | 'unwitnessed'
  | 'refused';

export type DiscardReason = 'pane-gone' | 'server-restarted' | 'pane-replaced';

export type Phase =
  /** No Connection. Keys collect. */
  | { readonly kind: 'adrift' }
  /**
   * A Connection, and the Pane's mark is being read. Nothing is sent.
   * `crossed`: there are keys from before this Connection, which must be judged.
   */
  | { readonly kind: 'checking'; readonly crossed: boolean }
  /** Keys flow, one Batch at a time. */
  | { readonly kind: 'live' }
  /** The user must decide. Keys typed now wait behind the held ones. */
  | { readonly kind: 'held'; readonly reasons: readonly HoldReason[] };

export interface Lane {
  readonly paneId: string;
  readonly phase: Phase;
  /** The last mark tmux gave for this Pane: what `judge` compares the next one with. */
  readonly witness: PaneMark | null;
  /** The highest Seq of this Lane that a mark confirmed. */
  readonly delivered: Seq;
  /** Written to a Connection and not confirmed. It stays through a break. */
  readonly unconfirmed: Batch | null;
  /** Typed and never written. */
  readonly waiting: readonly Typed[];
  /**
   * A Seq that a late line of a lost Connection must find on the Pane, after
   * the user took back or the Lane discarded the Batch with that Seq. Written
   * first on each Connection until a mark shows it.
   */
  readonly owedBurn: Seq | null;
  /** Keys that were thrown away, kept until the user dismisses the notice. */
  readonly dropped: { readonly keys: readonly Key[]; readonly reason: DiscardReason } | null;
}

export type LaneEvent =
  | { readonly kind: 'typed'; readonly key: Key }
  | { readonly kind: 'connected' }
  | { readonly kind: 'lost' }
  /** The answer to a `deliver` or a `read` effect. */
  | { readonly kind: 'answered'; readonly result: DeliverResult }
  /** The answer to a `burn` effect. */
  | { readonly kind: 'burned'; readonly result: DeliverResult }
  /** Send on a held Lane. */
  | { readonly kind: 'released' }
  /** Move to Composer or Discard on a held Lane. The caller reads `pendingKeys` first. */
  | { readonly kind: 'taken' }
  | { readonly kind: 'dismissed' };

export type Effect =
  | { readonly kind: 'deliver'; readonly batch: Batch }
  | { readonly kind: 'read' }
  /**
   * Raise the Pane's number to this Seq without typing anything. A line that
   * a dead Connection wrote can still arrive, and it must not type keys that
   * the user took back.
   */
  | { readonly kind: 'burn'; readonly seq: Seq }
  | { readonly kind: 'gestures-dropped'; readonly count: number };

export interface LaneContext {
  readonly now: number;
  readonly ttlMs: number;
  /** The most text bytes in one Batch, which keeps a line below what tmux can parse. */
  readonly maxBatchBytes: number;
  /** The Seq that a Batch takes if this step writes a new one. */
  readonly nextSeq: Seq;
}

const NO_SEQ = 0 as Seq;

export function newLane(paneId: string, connected: boolean): Lane {
  return {
    paneId,
    phase: connected ? { kind: 'checking', crossed: false } : { kind: 'adrift' },
    witness: null,
    delivered: NO_SEQ,
    unconfirmed: null,
    waiting: [],
    owedBurn: null,
    dropped: null,
  };
}

const isGesture = (key: Key) => key.kind === 'text' && key.gesture;

const untimed = (key: Typed): Key =>
  key.kind === 'text' ? { kind: 'text', bytes: key.bytes, gesture: key.gesture } : { kind: 'key', key: key.key };

/** Everything the Pane has not provably got, oldest first, without gesture bytes. */
export function pendingKeys(lane: Lane): Key[] {
  const keys = [...(lane.unconfirmed ? [lane.unconfirmed.key] : []), ...lane.waiting.map(untimed)];
  return keys.filter((key) => !isGesture(key));
}

function append(waiting: readonly Typed[], key: Key, now: number): Typed[] {
  const last = waiting[waiting.length - 1];
  if (last && last.kind === 'text' && key.kind === 'text' && last.gesture === key.gesture) {
    return [...waiting.slice(0, -1), { ...last, bytes: [...last.bytes, ...key.bytes] }];
  }
  return [...waiting, { ...key, typedAt: now }];
}

/** Writes the next waiting Key, if the Lane is live and nothing is in flight. */
function pump(lane: Lane, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  if (lane.phase.kind !== 'live' || lane.unconfirmed !== null) return { lane, effects: [] };
  const [head, ...rest] = lane.waiting;
  if (head === undefined) return { lane, effects: [] };
  const key = untimed(head);
  const cut =
    key.kind === 'text' && key.bytes.length > ctx.maxBatchBytes ? characterStart(key.bytes, ctx.maxBatchBytes) : null;
  const batch: Batch = {
    seq: ctx.nextSeq,
    key: cut !== null && key.kind === 'text' ? { ...key, bytes: key.bytes.slice(0, cut) } : key,
    typedAt: head.typedAt,
  };
  const waiting =
    cut !== null && head.kind === 'text' ? [{ ...head, bytes: head.bytes.slice(cut) }, ...rest] : rest;
  return { lane: { ...lane, unconfirmed: batch, waiting }, effects: [{ kind: 'deliver', batch }] };
}

/**
 * The last place at or before `at` where a UTF-8 character starts, so that a
 * split Batch previews and moves to the Composer as the characters typed. A
 * continuation byte is `10xxxxxx`. Bytes with no start in reach split at `at`.
 */
function characterStart(bytes: readonly number[], at: number): number {
  let start = at;
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) start -= 1;
  return start === 0 ? at : start;
}

/** Throws the gesture bytes away. They are of the moment they were made in. */
function withoutGestures(lane: Lane): { lane: Lane; effects: Effect[] } {
  const waiting = lane.waiting.filter((key) => !isGesture(key));
  const unconfirmed = lane.unconfirmed && isGesture(lane.unconfirmed.key) ? null : lane.unconfirmed;
  const count = lane.waiting.length - waiting.length + (unconfirmed === lane.unconfirmed ? 0 : 1);
  if (count === 0) return { lane, effects: [] };
  return { lane: { ...lane, waiting, unconfirmed }, effects: [{ kind: 'gestures-dropped', count }] };
}

function discard(lane: Lane, reason: DiscardReason, witness: PaneMark | null): Lane {
  const keys = pendingKeys(lane);
  return {
    ...lane,
    phase: { kind: 'live' },
    witness,
    unconfirmed: null,
    waiting: [],
    dropped: keys.length === 0 ? lane.dropped : { keys: [...(lane.dropped?.keys ?? []), ...keys], reason },
  };
}

/** A problem with the Batch in flight. A gesture is not worth a question, so it goes. */
function hold(lane: Lane, reason: HoldReason, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  if (lane.unconfirmed && isGesture(lane.unconfirmed.key)) {
    const next = pump({ ...lane, unconfirmed: null }, ctx);
    return { lane: next.lane, effects: [{ kind: 'gestures-dropped', count: 1 }, ...next.effects] };
  }
  return { lane: { ...lane, phase: { kind: 'held', reasons: [reason] } }, effects: [] };
}

/** Starts a live Lane again: the unconfirmed Batch goes first, with the Seq it has. */
function resume(lane: Lane, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  const live: Lane = { ...lane, phase: { kind: 'live' } };
  if (live.unconfirmed) return { lane: live, effects: [{ kind: 'deliver', batch: live.unconfirmed }] };
  return pump(live, ctx);
}

/** Bars a late line that carries this Seq, until a mark shows that the Pane has it. */
function owe(lane: Lane, seq: Seq): { lane: Lane; effects: Effect[] } {
  const owedBurn = Math.max(lane.owedBurn ?? NO_SEQ, seq) as Seq;
  return { lane: { ...lane, owedBurn }, effects: [{ kind: 'burn', seq: owedBurn }] };
}

/** Any mark at or above the owed Seq bars the late line, whichever line wrote it. */
function settleBurn(lane: Lane, result: DeliverResult): Lane {
  if (lane.owedBurn === null) return lane;
  const paid = result === 'gone' || (!('refused' in result) && result.ack !== null && result.ack >= lane.owedBurn);
  return paid ? { ...lane, owedBurn: null } : lane;
}

/** A `deliver` or `read` answer: the Batch in flight is confirmed, or the Lane is judged. */
function answer(lane: Lane, result: DeliverResult, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  if (lane.phase.kind === 'live') {
    if (lane.unconfirmed === null) return { lane, effects: [] };
    if (result === 'gone') return { lane: discard(lane, 'pane-gone', null), effects: [] };
    if ('refused' in result) return hold(lane, 'refused', ctx);
    if (result.ack === null || result.ack < lane.unconfirmed.seq) return hold(lane, 'unsure-delivered', ctx);
    return pump({ ...lane, delivered: lane.unconfirmed.seq, unconfirmed: null, witness: result }, ctx);
  }
  if (lane.phase.kind !== 'checking') return { lane, effects: [] };

  if (result !== 'gone' && 'refused' in result) {
    return lane.phase.crossed
      ? { lane: { ...lane, phase: { kind: 'held', reasons: ['refused'] } }, effects: [] }
      : resume(lane, ctx);
  }
  const { acked, verdict } = judge({ ...lane, crossed: lane.phase.crossed, read: result, now: ctx.now, ttlMs: ctx.ttlMs });
  const confirmed: Lane =
    acked && lane.unconfirmed ? { ...lane, delivered: lane.unconfirmed.seq, unconfirmed: null } : lane;
  if (verdict.kind === 'discard') {
    // A Pane that is gone takes no late line. Any other Pane can, and it
    // must not type keys that the card says were discarded.
    const discarded = discard(confirmed, verdict.reason, result === 'gone' ? null : result);
    return result !== 'gone' && confirmed.unconfirmed
      ? owe(discarded, confirmed.unconfirmed.seq)
      : { lane: discarded, effects: [] };
  }
  const witnessed: Lane = { ...confirmed, witness: result === 'gone' ? null : result };
  if (verdict.kind === 'hold') {
    return { lane: { ...witnessed, phase: { kind: 'held', reasons: verdict.reasons } }, effects: [] };
  }
  return resume(witnessed, ctx);
}

export function step(lane: Lane, event: LaneEvent, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  switch (event.kind) {
    case 'typed': {
      // A scroll of a Pane that is not live moved nothing, and must not move it later.
      if (isGesture(event.key) && lane.phase.kind !== 'live') {
        return { lane, effects: [{ kind: 'gestures-dropped', count: 1 }] };
      }
      return pump({ ...lane, waiting: append(lane.waiting, event.key, ctx.now) }, ctx);
    }

    case 'connected': {
      const crossed = lane.unconfirmed !== null || lane.waiting.length > 0;
      const burn: Effect[] = lane.owedBurn === null ? [] : [{ kind: 'burn', seq: lane.owedBurn }];
      return { lane: { ...lane, phase: { kind: 'checking', crossed } }, effects: [...burn, { kind: 'read' }] };
    }

    case 'burned':
      return { lane: settleBurn(lane, event.result), effects: [] };

    case 'lost': {
      const next = withoutGestures(lane);
      return { lane: { ...next.lane, phase: { kind: 'adrift' } }, effects: next.effects };
    }

    case 'answered':
      return answer(settleBurn(lane, event.result), event.result, ctx);

    case 'released':
      return lane.phase.kind === 'held' ? resume(lane, ctx) : { lane, effects: [] };

    case 'taken': {
      if (lane.phase.kind !== 'held') return { lane, effects: [] };
      const emptied: Lane = { ...lane, phase: { kind: 'live' }, unconfirmed: null, waiting: [] };
      return lane.unconfirmed ? owe(emptied, lane.unconfirmed.seq) : { lane: emptied, effects: [] };
    }

    case 'dismissed':
      return { lane: { ...lane, dropped: null }, effects: [] };
  }
}

export interface Judgement {
  /** The mark proves that the unconfirmed Batch reached the Pane. */
  readonly acked: boolean;
  readonly verdict:
    | { readonly kind: 'send' }
    | { readonly kind: 'hold'; readonly reasons: readonly HoldReason[] }
    | { readonly kind: 'discard'; readonly reason: DiscardReason };
}

/**
 * What to do with the keys of a Lane on a new Connection.
 *
 * One verdict for the whole Lane: the keys of a Pane arrive in order, so a
 * key that must wait holds every key behind it, and the user decides about
 * `ls -la⏎` as one piece.
 */
export function judge(input: {
  readonly unconfirmed: Batch | null;
  readonly waiting: readonly Typed[];
  readonly witness: PaneMark | null;
  readonly delivered: Seq;
  /** False when every key was typed on this Connection: there is nothing to doubt. */
  readonly crossed: boolean;
  readonly read: MarkRead;
  readonly now: number;
  readonly ttlMs: number;
}): Judgement {
  const { unconfirmed, waiting, witness, read } = input;
  if (read === 'gone') return { acked: false, verdict: { kind: 'discard', reason: 'pane-gone' } };
  if (!input.crossed) return { acked: false, verdict: { kind: 'send' } };
  // Before the identity checks: the option outlives `respawn-pane -k`, so a
  // Pane started again can still show that the Batch arrived before it.
  const ack = read.ack ?? NO_SEQ;
  const acked = unconfirmed !== null && ack >= unconfirmed.seq;
  if (witness && read.serverPid !== witness.serverPid) {
    return { acked, verdict: { kind: 'discard', reason: 'server-restarted' } };
  }
  if (witness && read.panePid !== witness.panePid) {
    return { acked, verdict: { kind: 'discard', reason: 'pane-replaced' } };
  }

  const pending: Typed[] = [
    ...(unconfirmed && !acked ? [{ ...unconfirmed.key, typedAt: unconfirmed.typedAt }] : []),
    ...waiting,
  ];
  if (pending.length === 0) return { acked, verdict: { kind: 'send' } };

  const reasons: HoldReason[] = [];
  if (unconfirmed && !acked && ack < input.delivered) reasons.push('unsure-delivered');
  if (witness === null) reasons.push('unwitnessed');
  else if (read.program !== witness.program) reasons.push('program-changed');
  if (pending.some((key) => input.now - key.typedAt > input.ttlMs)) reasons.push('stale');
  if (!pending.every(isSafeKey)) reasons.push('risky-keys');
  return { acked, verdict: reasons.length === 0 ? { kind: 'send' } : { kind: 'hold', reasons } };
}

const ESC = 0x1b;
const ARROWS: Record<string, string> = { Up: '↑', Down: '↓', Right: '→', Left: '←' };
const ARROW_FINALS = 'ABCD';
const ARROW_OF_FINAL = ['Up', 'Down', 'Right', 'Left'];

const isArrowBytes = (bytes: readonly number[], at: number) =>
  bytes[at] === ESC &&
  (bytes[at + 1] === 0x5b || bytes[at + 1] === 0x4f) &&
  ARROW_FINALS.includes(String.fromCharCode(bytes[at + 2] ?? 0));

/** A key name that is one printable character, which tmux types as that character. */
const isCharacter = (name: string) => [...name].length === 1 && name >= ' ' && name !== '\x7f';

/** Safe to send after a break without a question: printable text and plain arrows. */
export function isSafeKey(key: Key): boolean {
  if (key.kind === 'key') {
    if (typeof key.key === 'string') return key.key in ARROWS || isCharacter(key.key);
    const { key: name, ctrl, alt, shift } = key.key;
    return !ctrl && !alt && (isCharacter(name) || (name in ARROWS && !shift));
  }
  for (let at = 0; at < key.bytes.length; at += 1) {
    if (isArrowBytes(key.bytes, at)) at += 2;
    else if (key.bytes[at] < 0x20 || key.bytes[at] === 0x7f) return false;
  }
  return true;
}

/** One thing a key shows as, and what it is in a Draft: text, a step back, or nothing. */
interface Glyph {
  readonly show: string;
  readonly draft: string | 'erase' | null;
}

const NAMED: Record<string, Glyph> = {
  Enter: { show: '⏎', draft: '\n' },
  Tab: { show: '⇥', draft: '\t' },
  Space: { show: ' ', draft: ' ' },
  BSpace: { show: '⌫', draft: 'erase' },
  Escape: { show: 'Esc', draft: null },
};

function namedGlyph(name: string): Glyph {
  if (name in NAMED) return NAMED[name];
  if (name in ARROWS) return { show: ARROWS[name], draft: null };
  const control = /^C-(.)$/.exec(name);
  if (control) return { show: `^${control[1].toUpperCase()}`, draft: null };
  return isCharacter(name) ? { show: name, draft: name } : { show: name, draft: null };
}

function pressGlyph(press: KeyPress): Glyph {
  if (press.ctrl || press.alt) {
    const name = `${press.ctrl ? 'C-' : ''}${press.alt ? 'M-' : ''}${press.key}`;
    return { show: press.alt ? name : namedGlyph(name).show, draft: null };
  }
  const plain = namedGlyph(press.shift && isCharacter(press.key) ? press.key.toUpperCase() : press.key);
  return press.shift && plain.draft === null ? { show: `S-${press.key}`, draft: null } : plain;
}

function textGlyphs(bytes: readonly number[]): Glyph[] {
  const glyphs: Glyph[] = [];
  let run: number[] = [];
  const flush = () => {
    for (const character of bytesToUtf8(Uint8Array.from(run))) glyphs.push({ show: character, draft: character });
    run = [];
  };
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at];
    if (byte >= 0x20 && byte !== 0x7f) {
      run.push(byte);
      continue;
    }
    flush();
    if (isArrowBytes(bytes, at)) {
      glyphs.push(namedGlyph(ARROW_OF_FINAL[ARROW_FINALS.indexOf(String.fromCharCode(bytes[at + 2]))]));
      at += 2;
    } else if (byte === 0x0d) glyphs.push(NAMED.Enter);
    else if (byte === 0x09) glyphs.push(NAMED.Tab);
    else if (byte === 0x7f || byte === 0x08) glyphs.push(NAMED.BSpace);
    else if (byte === ESC) glyphs.push(NAMED.Escape);
    else glyphs.push({ show: `^${String.fromCharCode(byte + 0x40)}`, draft: null });
  }
  flush();
  return glyphs;
}

function glyphsOf(keys: readonly Key[]): Glyph[] {
  return keys.flatMap((key) => {
    if (key.kind === 'text') return key.gesture ? [] : textGlyphs(key.bytes);
    return [typeof key.key === 'string' ? namedGlyph(key.key) : pressGlyph(key.key)];
  });
}

/** The keys as the user reads them: `ls -la⏎`, `↑↑`, `^C`. For the screen only, never for the Log. */
export function previewOf(keys: readonly Key[]): string {
  return glyphsOf(keys).map((glyph) => glyph.show).join('');
}

/** What Move to Composer puts in the Draft, and the keys that a Draft cannot hold. */
export interface DraftText {
  readonly text: string;
  /** How each lost key shows, once each: `↑`, `^C`, `Esc`. */
  readonly dropped: readonly string[];
}

export function toDraftText(keys: readonly Key[]): DraftText {
  const characters: string[] = [];
  const dropped: string[] = [];
  for (const glyph of glyphsOf(keys)) {
    if (glyph.draft !== null && glyph.draft !== 'erase') characters.push(glyph.draft);
    // A Backspace with nothing before it took back a character that the Pane already has.
    else if (glyph.draft === 'erase' && characters.length > 0) characters.pop();
    else if (!dropped.includes(glyph.show)) dropped.push(glyph.show);
  }
  return { text: characters.join(''), dropped };
}

/** What the screen shows for one Pane. Read from the Lane each time, never kept. */
export type InputNotice =
  | { readonly kind: 'waiting'; readonly paneId: string; readonly preview: string }
  | {
      readonly kind: 'held';
      readonly paneId: string;
      readonly preview: string;
      readonly reasons: readonly HoldReason[];
      readonly draft: DraftText;
    }
  | { readonly kind: 'discarded'; readonly paneId: string; readonly preview: string; readonly reason: DiscardReason };

export function noticeOf(lane: Lane): InputNotice | null {
  const { paneId } = lane;
  // First, because it is the older news: these keys went before the others were typed.
  if (lane.dropped) {
    return { kind: 'discarded', paneId, preview: previewOf(lane.dropped.keys), reason: lane.dropped.reason };
  }
  const keys = pendingKeys(lane);
  if (lane.phase.kind === 'held') {
    return { kind: 'held', paneId, preview: previewOf(keys), reasons: lane.phase.reasons, draft: toDraftText(keys) };
  }
  if (lane.phase.kind === 'live' || keys.length === 0) return null;
  return { kind: 'waiting', paneId, preview: previewOf(keys) };
}
