import { describeError } from '@/lib/describe-error';

import type { OutboxToken } from './commands';
import {
  confirmedKey,
  messageFates,
  newLane,
  noticeOf,
  pendingKeys,
  step,
  type Batch,
  type DeliverResult,
  type Effect,
  type InputNotice,
  type Key,
  type Lane,
  type LaneEvent,
  type MessageFate,
  type MessageId,
  type Seq,
} from './input-lane';
import type { KeyPress } from './key-press';

/** The Connection as the Outbox needs it. Each call rejects only when the Connection ends. */
export interface OutboxLink {
  deliver(paneId: string, batch: Batch, token: OutboxToken): Promise<DeliverResult>;
  readMark(paneId: string, token: OutboxToken): Promise<DeliverResult>;
  /** Answers with the Pane's mark after the burn. */
  burn(paneId: string, seq: Seq, token: OutboxToken): Promise<DeliverResult>;
}

/** The way into one Pane, which is all a Pane view knows of the Outbox. */
export interface PaneInput {
  /** `gesture`: the bytes come from a scroll or a tap, and are not sent after a break. */
  type(bytes: Uint8Array, gesture?: boolean): void;
  press(key: string | KeyPress): void;
  /** `message`: a Composer Send, which presses Enter after it. */
  paste(text: string, message: MessageId | null): void;
  /** `C-l`, and then the Scrollback goes. */
  clear(): void;
}

/**
 * Every key on its way into a Pane, for as long as the Attach lives.
 *
 * It outlives each Connection, which is the point: a key that was typed is
 * here until tmux confirms it or the user has seen what became of it. The
 * rules are in `input-lane.ts`. This part keeps one Lane per Pane, runs what
 * a Lane asks for on the Connection in force, and drops an answer that comes
 * from a Connection that ended.
 */
export interface Outbox {
  /** Makes the Pane's Lane if it has none. While connected, that reads the Pane's mark. */
  lane(paneId: string): PaneInput;
  connected(link: OutboxLink): void;
  lost(): void;
  /** Send on a held Lane. False when the Lane is not held. */
  release(paneId: string): boolean;
  /** Empties a held Lane and answers with its keys. Move to Composer and Discard. */
  take(paneId: string): Key[];
  /** Removes a discarded notice. */
  dismiss(paneId: string): void;
  /** Ends the Outbox. Answers how many keys it still had, which are discarded. */
  close(): number;
}

export interface OutboxOptions {
  now: () => number;
  /** How old a key can be and still go to its Pane without a question. */
  ttlMs: number;
  /** Every notice, in the order the Panes got a Lane, each time the notices change. */
  onNotices: (notices: InputNotice[]) => void;
  /** A Composer message left its Lane. */
  onMessage: (paneId: string, id: MessageId, fate: MessageFate) => void;
  /** tmux confirmed a clear of the Pane. */
  onCleared: (paneId: string) => void;
  /** For the Log: Pane ids, counts and Seqs. Never the keys. */
  say: (line: string) => void;
}

/**
 * The most typed bytes in one line. Measured on tmux 3.8: a line with 8000
 * bytes ran and one with 16000 was `yacc stack overflow`.
 */
const MAX_BATCH_BYTES = 2048;

export function newOutboxToken(): OutboxToken {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0') as OutboxToken;
}

export function createOutbox(options: OutboxOptions): Outbox {
  const { say } = options;
  const token = newOutboxToken();
  const lanes = new Map<string, Lane>();
  let link: OutboxLink | null = null;
  /** Which Connection an answer belongs to. An answer from an earlier one is not news. */
  let epoch = 0;
  let nextSeq = 1;
  let published = '[]';
  let closed = false;

  function publish(): void {
    const notices = [...lanes.values()].flatMap((lane) => noticeOf(lane) ?? []);
    const next = JSON.stringify(notices);
    if (next === published) return;
    published = next;
    options.onNotices(notices);
  }

  function apply(paneId: string, event: LaneEvent): void {
    const before = lanes.get(paneId);
    if (closed || !before) return;
    const next = step(before, event, {
      now: options.now(),
      ttlMs: options.ttlMs,
      maxBatchBytes: MAX_BATCH_BYTES,
      nextSeq: nextSeq as Seq,
    });
    if (next.lane.unconfirmed?.seq === nextSeq) nextSeq += 1;
    lanes.set(paneId, next.lane);
    note(before, next.lane);
    for (const effect of next.effects) run(paneId, effect);
    publish();
    for (const { id, fate } of messageFates(before, next.lane)) options.onMessage(paneId, id, fate);
    if (confirmedKey(before, next.lane)?.kind === 'clear') options.onCleared(paneId);
  }

  function note(before: Lane, after: Lane): void {
    const count = pendingKeys(after).length;
    if (after.phase.kind === 'held' && before.phase.kind !== 'held') {
      say(`${after.paneId} holds ${count} keys for the user: ${after.phase.reasons.join(', ')}`);
    }
    if (after.dropped && after.dropped !== before.dropped) {
      say(`${after.paneId} discarded ${after.dropped.keys.length} keys: ${after.dropped.reason}`);
    }
    if (after.phase.kind === 'live' && before.phase.kind === 'checking' && before.phase.crossed && count > 0) {
      say(`${after.paneId} sends ${count} keys from before this Connection`);
    }
  }

  function run(paneId: string, effect: Effect): void {
    if (effect.kind === 'gestures-dropped') {
      say(`${paneId} dropped ${effect.count} scroll or tap events`);
      return;
    }
    const current = link;
    if (!current) return;
    const mine = epoch;
    if (effect.kind === 'burn') {
      // A burn that fails stays owed on the Lane, and the next Connection writes it again.
      current.burn(paneId, effect.seq, token).then(
        (result) => {
          if (mine === epoch) apply(paneId, { kind: 'burned', result });
        },
        () => {},
      );
      return;
    }
    const asked = effect.kind === 'deliver' ? current.deliver(paneId, effect.batch, token) : current.readMark(paneId, token);
    asked.then(
      (result) => {
        if (mine === epoch) apply(paneId, { kind: 'answered', result });
      },
      (error: unknown) => {
        // The Attach says `lost` before a Connection's commands fail. A failure
        // in the same epoch is thus not a break, and the key must not be stuck.
        if (mine === epoch) apply(paneId, { kind: 'answered', result: { refused: describeError(error) } });
      },
    );
  }

  function everyLane(event: LaneEvent): void {
    for (const paneId of [...lanes.keys()]) apply(paneId, event);
  }

  function ensure(paneId: string): void {
    if (closed || lanes.has(paneId)) return;
    lanes.set(paneId, newLane(paneId, link !== null));
    if (link) run(paneId, { kind: 'read' });
  }

  return {
    lane(paneId: string): PaneInput {
      ensure(paneId);
      const typed = (key: Key) => apply(paneId, { kind: 'typed', key });
      return {
        type: (bytes, gesture = false) => {
          if (bytes.length > 0) typed({ kind: 'text', bytes: Array.from(bytes), gesture });
        },
        press: (key) => typed({ kind: 'key', key }),
        paste: (text, message) => {
          if (text.length > 0) typed({ kind: 'paste', text, message });
        },
        clear: () => typed({ kind: 'clear' }),
      };
    },

    connected(next: OutboxLink): void {
      if (closed) return;
      link = next;
      epoch += 1;
      everyLane({ kind: 'connected' });
    },

    lost(): void {
      if (closed || link === null) return;
      link = null;
      epoch += 1;
      everyLane({ kind: 'lost' });
    },

    release(paneId: string): boolean {
      if (closed || lanes.get(paneId)?.phase.kind !== 'held') return false;
      apply(paneId, { kind: 'released' });
      return true;
    },

    take(paneId: string): Key[] {
      const lane = lanes.get(paneId);
      if (closed || lane?.phase.kind !== 'held') return [];
      const keys = pendingKeys(lane);
      say(`${paneId} gave its ${keys.length} held keys back to the user`);
      apply(paneId, { kind: 'taken' });
      return keys;
    },

    dismiss: (paneId) => apply(paneId, { kind: 'dismissed' }),

    close(): number {
      if (closed) return 0;
      closed = true;
      link = null;
      epoch += 1;
      let count = 0;
      for (const lane of lanes.values()) count += pendingKeys(lane).length;
      lanes.clear();
      return count;
    },
  };
}
