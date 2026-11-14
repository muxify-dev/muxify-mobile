/**
 * Candidate 2: the input Outbox as a pure Lane state machine per Pane.
 *
 * Module map (new or changed):
 *   src/tmux/input-lane.ts        NEW  pure: Lane, step(), judge(), toDraftText(), previewOf()
 *   src/tmux/input-outbox.ts      NEW  shell: one Lane per Pane id, runs Effects on the OutboxLink
 *   src/tmux/commands.ts          CHG  deliverCommands(), paneMarkCommand(), parsePaneMark()
 *   src/tmux/control-connection.ts CHG runChain(): one line, one reply per command
 *   src/tmux/tmux-client.ts       CHG  deliver(), readMark() replace sendKeys()/sendKey()
 *   src/tmux/attach.ts            CHG  owns the Outbox; AttachState.input; heldInput(); dismissInput()
 *   src/tmux/pane-view.ts         CHG  loses outgoing/sending/flushTyped and PaneReader.sendKeys/sendKey
 *   src/app/terminal.tsx          CHG  draws AttachState.input; call sites of view.type/press do not change
 */

import type { KeyPress } from '@/tmux/key-press';
import type { TmuxArgv } from '@/tmux/commands';
import type { CommandReply } from '@/tmux/control-connection';

// ───────────────────────────────────────────────────────────── input-lane.ts
// Pure. No clock, no promises, no tmux words. `now` comes in with each event.

/** The number of a Batch in its Lane. 1 is the first. 0 means "nothing delivered". */
export type Seq = number & { readonly __brand: 'Seq' };

/** Made once per Outbox. Tells this Outbox's acks from those of another phone or an earlier app run. */
export type OutboxToken = string & { readonly __brand: 'OutboxToken' };

/** One thing the user typed. Text is bytes for `send-keys -H`. A key is a name that tmux encodes. */
export type Key =
  | { readonly kind: 'text'; readonly bytes: readonly number[] }
  | { readonly kind: 'key'; readonly key: string | KeyPress };

/** A Key that waits, with the time of its first byte. Adjacent text merges and keeps the older time. */
export type Typed = Key & { readonly typedAt: number };

/**
 * Keys that were written to a Connection under one Seq.
 *
 * Sealed: a Batch never changes after its first write. A second write uses the
 * same Seq and the same keys, so an ack for Seq n always means these keys.
 */
export interface Batch {
  readonly seq: Seq;
  readonly keys: readonly Key[];
  /** The oldest `typedAt` in the Batch. */
  readonly typedAt: number;
}

/** What `@muxify-in` held, parsed. */
export interface Ack {
  readonly token: OutboxToken;
  readonly seq: Seq;
}

/**
 * What tmux says about a Pane at one moment. The only fact the Outbox reads from tmux.
 *
 * It comes back with every delivered Batch (last command of the line) and from
 * the read on each new Connection. One type, one parser, one path into the Lane.
 */
export interface PaneMark {
  /** `#{pid}`: changes when the tmux server restarts. */
  readonly serverPid: number;
  /** `#{pane_pid}`: changes when the Pane is a different Pane, also after `respawn-pane`. */
  readonly panePid: number;
  /** `#{pane_current_command}`. */
  readonly program: string;
  /** `@muxify-in`, or null when the Pane has none. */
  readonly ack: Ack | null;
}

/** `display-message -t %9` does not fail for a Pane that is gone: it prints an empty `pane_pid`. */
export type MarkRead = PaneMark | 'gone';

/** `refused`: tmux answered `%error` for a reason other than a missing Pane. */
export type DeliverResult = MarkRead | { readonly refused: string };

export type HoldReason =
  | 'risky-keys' // Enter, control bytes, a named key that is not an arrow
  | 'stale' // the oldest key is older than the TTL
  | 'program-changed' // the Pane runs a different program than the last mark showed
  | 'unsure-delivered' // the unconfirmed Batch has no ack that this Outbox can read: Send can type it twice
  | 'unwitnessed' // no mark from before the break: the Outbox cannot prove that this is the same Pane
  | 'refused';

export type DiscardReason = 'pane-gone' | 'server-restarted' | 'pane-replaced';

export type Phase =
  /** No Connection. Keys collect in `waiting`. */
  | { readonly kind: 'adrift' }
  /** A new Connection. The mark read is in flight. Nothing is sent. */
  | { readonly kind: 'checking' }
  /** Keys flow. `unconfirmed !== null` means one line is in flight. */
  | { readonly kind: 'live' }
  /** The user must decide. Keys typed now join `waiting`, behind the held ones. */
  | { readonly kind: 'held'; readonly reasons: readonly HoldReason[] };

export interface Lane {
  readonly paneId: string;
  readonly phase: Phase;
  /** The last mark this Lane got. The identity and program that `judge` compares with. */
  readonly witness: PaneMark | null;
  /** The highest Seq that a mark confirmed. */
  readonly delivered: Seq;
  /** Written to a Connection, not yet confirmed. At most one. Stays through a break. */
  readonly unconfirmed: Batch | null;
  /** Typed, never written. */
  readonly waiting: readonly Typed[];
  /** Keys that were discarded, kept until the user dismisses the notice. Independent of `phase`. */
  readonly dropped: { readonly keys: readonly Key[]; readonly reason: DiscardReason } | null;
}

export type LaneEvent =
  | { readonly kind: 'typed'; readonly key: Key }
  | { readonly kind: 'connected' }
  | { readonly kind: 'lost' }
  /** The answer to a `deliver` or a `read` Effect. */
  | { readonly kind: 'answered'; readonly result: DeliverResult }
  /** Send on a held Lane. */
  | { readonly kind: 'released' }
  /** Move to Composer or Discard: the Outbox reads `pendingKeys` first, then empties the Lane. */
  | { readonly kind: 'taken' }
  | { readonly kind: 'dismissed' };

/** What the shell must do. At most one per step. */
export type Effect = { readonly kind: 'deliver'; readonly batch: Batch } | { readonly kind: 'read' };

export interface LaneContext {
  readonly now: number;
  readonly token: OutboxToken;
  readonly ttlMs: number;
  /** Largest count of text bytes in one Batch. Keeps the line below tmux's limit. */
  readonly maxBatchBytes: number;
}

export function newLane(paneId: string, connected: boolean): Lane {
  // TODO connected: phase 'checking' (the caller runs a `read` Effect, so the Lane has a witness
  //      before a break can come). Not connected: phase 'adrift', witness null.
  throw new Error('not implemented');
}

/**
 * The whole behavior of a Lane.
 *
 * TODO
 * typed:      append to `waiting` (merge into a last text item). If live and unconfirmed === null: seal + deliver.
 *             In adrift / checking / held: no Effect. A scroll or a wheel byte is a Key like any other.
 * connected:  phase = checking; Effect read.               (also for an empty Lane: it refreshes the witness)
 * lost:       phase = adrift, from every phase. A held Lane is judged again on the next Connection,
 *             so a Send that a second break interrupted asks again. `released` thus always has a Connection.
 * answered, phase live:
 *             'gone'            -> discard everything pending ('pane-gone').
 *             {refused}         -> phase held ['refused'].
 *             mark covers unconfirmed.seq (ack.token === ctx.token && ack.seq >= seq)
 *                               -> delivered = seq; unconfirmed = null; witness = mark; seal next from waiting + deliver.
 *             mark does not cover (not seen in the probe; the line ran to its end) -> held ['unsure-delivered'].
 * answered, phase checking:
 *             j = judge(...). If j.acked: delivered = unconfirmed.seq; unconfirmed = null.
 *             send    -> witness = mark; phase live; deliver unconfirmed again (same Seq), else seal next.
 *             hold    -> witness = mark; phase held(j.reasons).
 *             discard -> dropped = {pendingKeys, reason}; unconfirmed = null; waiting = []; witness = mark or null;
 *                        delivered = 0; phase live. Keys typed after this go to the Pane that has this id now.
 * answered in adrift / held: ignore (an answer from a Connection that ended).
 * released:   only in held: phase live; deliver unconfirmed again (same Seq), else seal next.
 * taken:      unconfirmed = null; waiting = []; phase live if it was held, else unchanged.
 * dismissed:  dropped = null.
 *
 * seal: take keys from the front of `waiting` up to maxBatchBytes; Seq = max(delivered, unconfirmed.seq) + 1.
 */
export function step(lane: Lane, event: LaneEvent, ctx: LaneContext): { lane: Lane; effects: Effect[] } {
  throw new Error('not implemented');
}

export interface Judgement {
  /** drop-acked: the mark proves that the unconfirmed Batch reached the Pane. */
  readonly acked: boolean;
  readonly verdict:
    | { readonly kind: 'send' }
    | { readonly kind: 'hold'; readonly reasons: readonly HoldReason[] }
    | { readonly kind: 'discard'; readonly reason: DiscardReason };
}

/**
 * The classification. One verdict for everything pending on the Lane, because order per Pane
 * makes a held Batch hold all Batches behind it.
 *
 * TODO, in this order:
 * 1. read === 'gone'                                   -> discard 'pane-gone'
 * 2. witness && read.serverPid !== witness.serverPid   -> discard 'server-restarted'
 * 3. witness && read.panePid !== witness.panePid       -> discard 'pane-replaced'
 * 4. unconfirmed:
 *      ack is mine and ack.seq >= unconfirmed.seq      -> acked = true
 *      ack is mine and ack.seq <  unconfirmed.seq      -> not delivered; it stays pending
 *      ack === null and delivered === 0 and witness    -> not delivered; it stays pending
 *      else (other token, or an ack that went away)    -> reason 'unsure-delivered'
 * 5. nothing pending after 4                           -> send (the Lane goes live with nothing to do)
 * 6. reasons for the pending keys:
 *      witness === null                                -> 'unwitnessed'
 *      read.program !== witness.program                -> 'program-changed'
 *      now - oldest typedAt > ttlMs                    -> 'stale'
 *      some key is not safe (see isSafeKey)            -> 'risky-keys'
 * 7. no reasons -> send; else hold(reasons)
 */
export function judge(input: {
  readonly unconfirmed: Batch | null;
  readonly waiting: readonly Typed[];
  readonly witness: PaneMark | null;
  readonly delivered: Seq;
  readonly token: OutboxToken;
  readonly read: MarkRead;
  readonly now: number;
  readonly ttlMs: number;
}): Judgement {
  throw new Error('not implemented');
}

/**
 * Safe to send again without a question: printable text and arrows.
 * TODO text: each byte >= 0x20 and !== 0x7f, or the bytes are exactly `ESC [ A..D` / `ESC O A..D`.
 *      key:  the name is Up, Down, Left or Right with no modifier.
 */
export function isSafeKey(key: Key): boolean {
  throw new Error('not implemented');
}

/** The unconfirmed Batch's keys, then the waiting keys: everything the Pane has not provably got, in order. */
export function pendingKeys(lane: Lane): Key[] {
  throw new Error('not implemented');
}

/** What Move to Composer puts in the Draft. Enter is a newline, Tab is a tab. Other keys cannot go in a Draft. */
export interface DraftText {
  readonly text: string;
  /** Labels of the keys that Move to Composer drops: `↑`, `^C`, `Esc`. Shown on the button before the tap. */
  readonly dropped: readonly string[];
}
export function toDraftText(keys: readonly Key[]): DraftText {
  throw new Error('not implemented');
}

/** What the screen shows for one Pane. Derived from the Lane on each change; never stored. */
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

/**
 * TODO dropped !== null -> 'discarded' (it wins: it is the older news);
 *      phase held -> 'held'; phase adrift or checking with pending keys -> 'waiting'; else null.
 *      `preview` is the keys as text with labels for keys (`ls -la⏎`, `↑↑`). It never goes to the Log.
 */
export function noticeOf(lane: Lane): InputNotice | null {
  throw new Error('not implemented');
}

// ─────────────────────────────────────────────────────────── input-outbox.ts

/** The Connection as the Outbox needs it. TmuxClient implements it; a fake implements it in Jest. */
export interface OutboxLink {
  /** Writes one line: the Batch's keys, the ack, the mark read. Rejects only when the Connection ends. */
  deliver(paneId: string, batch: Batch, token: OutboxToken): Promise<DeliverResult>;
  /** Reads the mark alone. Rejects only when the Connection ends. */
  readMark(paneId: string): Promise<MarkRead>;
}

/** A Pane's way in. What a PaneView gets in place of `PaneReader.sendKeys` / `sendKey`. */
export interface PaneInput {
  type(bytes: Uint8Array): void;
  press(key: string | KeyPress): void;
}

export interface Outbox {
  /** The way into one Pane. Makes the Lane; while connected it also reads the Pane's first mark. */
  lane(paneId: string): PaneInput;
  /** A new Connection is ready. Every Lane checks itself before it sends. */
  connected(link: OutboxLink): void;
  /** The Connection ended. Lanes keep everything. */
  lost(): void;
  /** Send on a held Lane. No-op when the Lane is not held. */
  release(paneId: string): void;
  /** Removes and returns everything pending on a Lane. Move to Composer and Discard both use it. */
  take(paneId: string): Key[];
  /** Removes a 'discarded' notice. */
  dismiss(paneId: string): void;
}

export interface OutboxOptions {
  readonly token: OutboxToken;
  readonly now: () => number;
  /** Start value 30 000. */
  readonly ttlMs: number;
  /** Called with every notice, in Pane id order, after each change that alters them. */
  readonly onNotices: (notices: InputNotice[]) => void;
  /** Counts and Seqs only. Never keys. */
  readonly say: (line: string) => void;
}

/**
 * TODO
 * state: lanes = Map<paneId, Lane>; link: OutboxLink | null; epoch = 0 (bumped by connected and lost).
 * apply(paneId, event): { lane, effects } = step(lanes.get(paneId), event, ctx); store; run effects; publish.
 * run(effect): const mine = epoch;
 *     (effect.kind === 'deliver' ? link.deliver(paneId, effect.batch, token) : link.readMark(paneId))
 *       .then((result) => { if (mine === epoch) apply(paneId, { kind: 'answered', result }); })
 *       .catch(() => {});   // the Connection ended; `lost()` is the one signal for that
 * Lanes are never removed: a Lane with nothing pending is a witness and four small fields.
 */
export function createOutbox(options: OutboxOptions): Outbox {
  throw new Error('not implemented');
}

// ───────────────────────────────────────────────────────────── commands.ts

export const INPUT_OPTION = '@muxify-in';

/** `#{@muxify-in}\t#{pid}\t#{pane_pid}\t#{pane_current_command}`. The program is last: it is the free text. */
export const PANE_MARK_FORMAT: string = '';

export function paneMarkCommand(paneId: string): TmuxArgv {
  // ['display-message', '-p', '-t', paneId, PANE_MARK_FORMAT]
  throw new Error('not implemented');
}

/**
 * The commands of one Batch line, in order:
 *   send-keys -t %N -H 6c 73   (one per Key; a key is `send-keys -t %N Up`)
 *   set-option -p -t %N @muxify-in <token>:<seq>
 *   display-message -p -t %N <PANE_MARK_FORMAT>
 * A failed command stops the line, so an ack is on the Pane only if every key before it went in.
 * `keys` are rendered: a KeyPress is already a name or bytes (TmuxClient does that with its KeyNaming).
 */
export function deliverCommands(
  paneId: string,
  keys: readonly ({ bytes: Uint8Array } | { key: string })[],
  ack: Ack,
): TmuxArgv[] {
  throw new Error('not implemented');
}

/**
 * The boundary parse. TODO split on '\t' into at most 4 parts; empty `pane_pid` -> 'gone';
 * `@muxify-in` that is empty or not `<token>:<digits>` -> ack null.
 */
export function parsePaneMark(line: string): MarkRead {
  throw new Error('not implemented');
}

// ────────────────────────────────────────────────────── control-connection.ts

export interface CommandRunner {
  run(argv: TmuxArgv): Promise<CommandReply>;
  runAll(commands: TmuxArgv[]): Promise<CommandReply[]>;
  /**
   * Writes the commands as ONE line, joined with ` ; `, and resolves with one reply per command that ran.
   *
   * tmux answers a line with one block per command and stops at the first `%error`. So the result has
   * `commands.length` replies, or fewer with the last one `ok: false`.
   *
   * TODO Pending becomes { line, what, expect: number, got: CommandReply[], settle, fail }.
   *      `receive` pushes the reply onto pending[0].got; it shifts and settles the entry when
   *      got.length === expect or the reply is not ok. `run` and `runAll` are entries with expect 1,
   *      so no caller of them changes. `what` is the commands' describeCommand joined with ` ; `,
   *      which keeps typed bytes out of the Log.
   */
  runChain(commands: TmuxArgv[]): Promise<CommandReply[]>;
}

// ─────────────────────────────────────────────────────────── tmux-client.ts

export interface TmuxClientInput extends OutboxLink {
  // deliver: render each KeyPress with keyNaming(); replies = await runner.runChain(deliverCommands(...));
  //          last = replies.at(-1); !last.ok -> /can't find pane/.test(detail) ? 'gone' : { refused: detail };
  //          else parsePaneMark(last.text[0]).
  // readMark: parsePaneMark((await runner.run(paneMarkCommand(paneId))).text[0]).
  // sendKeys() and sendKey() are deleted in the same change. Each other caller of them moves to the Lane
  // (rg 'sendKeys\(|sendKey\(' src before the change).
}

// ──────────────────────────────────────────────────────────────── attach.ts

export interface AttachInputAdditions {
  // AttachState gains:  input: InputNotice[]   (every Pane, not only the active one)
  /** The three buttons of a held notice. */
  heldInput(paneId: string, action: 'send' | 'compose' | 'discard'): void;
  // TODO send:    outbox.release(paneId)
  //      compose: if (busy(composer.draft(paneId))) return;
  //               const { text } = toDraftText(outbox.take(paneId));
  //               composer.edit(paneId, composer.draft(paneId).text + text)
  //      discard: outbox.take(paneId)
  /** The one button of a 'discarded' notice. */
  dismissInput(paneId: string): void;
  // Wiring: const outbox = createOutbox(...) beside `composer`, made once per Attach.
  //   viewFor:   const lane = outbox.lane(paneId);
  //              createPaneView(paneId, reader, { type: (b) => { sizing.reclaim(); lane.type(b); }, press: ... }, ...)
  //   connect(): after the Client is sized -> outbox.connected(client)
  //   teardown(): outbox.lost()   (beside composer.interrupt())
}
