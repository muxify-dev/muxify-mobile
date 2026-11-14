# Input Outbox, candidate 2: a pure Lane per Pane, one mark from tmux

## Problem

A key typed in Muxify Mobile can vanish when the Connection breaks. The Pane view owns the queue
(`outgoing`, pane-view.ts:346), removes a batch before it sends it (:641), drops it on an error
(:647), and loses the whole queue when the Attach replaces the Connection (:914). The Control
Connection cannot say if a stranded command ran (control-connection.ts:170). Keys typed while
disconnected are refused one by one.

Constraints from the grounding: the Attach owns the Outbox, keyed by Pane id, and it survives a
replacement. Batching stays Nagle-style with no timers. A reply from tmux is the only proof of
delivery. The classification is a pure function. The Log must not show typed bytes.

I ran a probe on tmux 3.8 with a throwaway server (`TMUX_TMPDIR` in a temp folder). It gave four
facts that this design uses:

- `send-keys -H .. ; send-keys Up ; set-option -p .. ; display-message -p ..` gives four reply
  blocks. The last block has the text of `display-message`.
- When the first command fails, the line gives one `%error` and no more blocks.
- `display-message -p -t %9` for a Pane that does not exist **does not fail**. It prints the format
  with an empty `#{pane_pid}`. A missing Pane must be read from the value, not from an error.
- `respawn-pane -k` keeps `@muxify-in` and changes `#{pane_pid}`. So the ack alone does not prove
  that the Pane is the same one.

## Usage (caller's view)

The Pane view gets a way in. It does not know about batches, acks or the Connection.

```ts
// attach.ts, viewFor
const lane = outbox.lane(paneId);
const view = createPaneView(paneId, reader, {
  type: (bytes) => { sizing.reclaim(); lane.type(bytes); },
  press: (key) => { sizing.reclaim(); lane.press(key); },
}, events, { clock, log });
```

The Attach tells the Outbox two things about the Connection, and nothing else.

```ts
// attach.ts
const outbox = createOutbox({ token, now: clock.now, ttlMs: 30_000, say,
  onNotices: (input) => change({ input }) });   // made once, beside `composer`

/* connect(), after the Client is sized */  outbox.connected(client);
/* teardown(), beside composer.interrupt() */ outbox.lost();
```

The screen draws `AttachState.input` and calls back with one of three actions.

```tsx
// terminal.tsx
{state.input.map((notice) =>
  notice.kind === 'held' ? (
    <HeldInput key={notice.paneId} text={notice.preview} reasons={notice.reasons}
      onSend={() => attach.heldInput(notice.paneId, 'send')}
      onCompose={() => attach.heldInput(notice.paneId, 'compose')}   // label names notice.draft.dropped
      onDiscard={() => attach.heldInput(notice.paneId, 'discard')} />
  ) : notice.kind === 'discarded' ? (
    <DiscardedInput key={notice.paneId} text={notice.preview} reason={notice.reason}
      onDismiss={() => attach.dismissInput(notice.paneId)} />
  ) : null /* 'waiting': data for the loading task, not drawn by this one */)}
```

`handlePaneInput`, `pressKey` and `pressSymbol` do not change. They call `view.type` and
`view.press` as they do today.

A test of the rules needs no fake at all.

```ts
let { lane } = step(newLane('%0', false), { kind: 'typed', key: text('ls\r') }, ctx);
({ lane } = step(lane, { kind: 'connected' }, ctx));
({ lane } = step(lane, { kind: 'answered', result: sameShell }, ctx));
expect(lane.phase).toEqual({ kind: 'held', reasons: ['unwitnessed', 'risky-keys'] });
```

## Shape

**Data.** The Outbox is a `Map<paneId, Lane>` that the Attach owns. A Lane is a small value:

```ts
interface Lane {
  phase: adrift | checking | live | held(reasons);
  witness: PaneMark | null;   // the last mark tmux gave for this Pane
  delivered: Seq;             // the highest Seq that a mark confirmed
  unconfirmed: Batch | null;  // written to a Connection, not confirmed. At most one.
  waiting: Typed[];           // typed, never written
  dropped: { keys, reason } | null;   // a 'discarded' notice that the user has not dismissed
}
```

Each access is direct. Typing appends to `waiting`. A reply compares one Seq with `unconfirmed`. A
reconnect reads `unconfirmed`, `waiting` and `witness`. The screen maps the Lanes to notices. There
is no index and no second copy.

**One function holds the behavior.** `step(lane, event, ctx) -> { lane, effects }` is pure
(per boundary-discipline). Events: `typed`, `connected`, `lost`, `answered`, `released`, `taken`,
`dismissed`. Effects: `deliver(batch)` or `read`. The Outbox shell stores the Lane, runs the
effect on the `OutboxLink`, and feeds the answer back as `answered`. It drops an answer from a
Connection that ended (one epoch number). It has no rules of its own.

**Batching and in-flight.** Same Nagle rule, no timers. In `live`, a typed key seals a Batch and
sends it when `unconfirmed` is null. Keys typed during the round trip collect in `waiting` and go
as the next Batch. A Batch is now *everything that waited*, text and named keys together, as one
line. Today a named key costs its own round trip. A Batch is sealed: it gets its Seq at the first
write and never changes after that. A second write, after a reconnect, uses the same Seq and keys.
So an ack for Seq 7 always means the same keys (per make-operations-idempotent). A Batch holds at
most `maxBatchBytes` of text, so the line stays below tmux's line limit.

**The wire line.** One line per Batch, built in `commands.ts`:

```
send-keys -t %3 -H 6c 73 ; send-keys -t %3 Up ; set-option -p -t %3 @muxify-in k7f2:7 ; display-message -p -t %3 '#{@muxify-in}\t#{pid}\t#{pane_pid}\t#{pane_current_command}'
```

A failed command stops the line. So the ack is on the Pane only if each key before it went in. The
last command reads the **mark** back. The reply of a delivered Batch thus says three things: the
ack that is on the Pane now, the Pane's identity, and the program it runs.

**One mark, one path.** `PaneMark { serverPid, panePid, program, ack }` is the only thing the
Outbox reads from tmux. The read on a new Connection is the same `display-message` alone. So there
is one format, one parser (`parsePaneMark`, at the boundary), and one event (`answered`). A Batch
leaves the Lane as delivered in exactly one way: a mark whose ack covers its Seq. The reply to a
delivery and the read after a reconnect are the same case.

**Identity.** The ack value is `<token>:<seq>`. The token is made once per Outbox, so the ack of
another phone or of an earlier app run is not read as this Outbox's ack. The Pane's identity is
`serverPid` + `panePid` from the mark. The Lane compares the new mark with its `witness`. The
witness is fresh without a Topology change: each delivered Batch renews it, and `outbox.lane()`
reads it when a view is made, so a Pane that was on screen has a witness before the user types.

**Control Connection: one reply per command.** `runChain(commands)` writes one line and makes one
Pending with `expect = commands.length`. `receive` collects replies into the first Pending and
settles it when the count is complete or a reply is `%error`. `run` and `runAll` are entries with
`expect: 1`, so their callers do not change. The Log line is each command's `describeCommand`,
joined, so typed bytes stay a count.

**On a new Connection.** `connected` puts each Lane in `checking` and reads its mark. Nothing is
sent before the answer. Then `judge` gives one verdict for all that is pending on the Lane:

| Verdict | When | What happens |
| --- | --- | --- |
| drop-acked | ack is this Outbox's and covers `unconfirmed.seq` | `unconfirmed` is removed. The rest is judged. |
| discard | mark is `gone`; `serverPid` changed; `panePid` changed | Keys move to `dropped`. Notice until dismissed. The Lane starts new at Seq 1. |
| hold | a key that is not printable text or an arrow; oldest key older than the TTL; program changed; no witness; ack unreadable for `unconfirmed` | Phase `held`. Nothing is sent. |
| send | none of the above | Phase `live`. `unconfirmed` goes again with its Seq, then `waiting`. |

The inputs of `judge` are the Lane's `unconfirmed`, `waiting`, `witness` and `delivered`, the
token, the mark, `now` and the TTL. The verdict is for the whole Lane, not per Batch. Order per
Pane makes a held Batch hold everything behind it, and the user decides about one piece of text
(`ls -la⏎`), not about a lone Enter.

**Keys typed while disconnected** are `typed` events in phase `adrift`. They join `waiting` behind
`unconfirmed`. Keys typed while a Lane is `held` join `waiting` too, and the notice grows. There is
no second path for them.

**Held input on the screen.** `AttachState.input: InputNotice[]` is derived from the Lanes on each
change (`noticeOf`), for every Pane and not only the active one, because a Lane can hold keys for
a Pane in a Window that is not shown. The three actions:

- **Send**: `outbox.release(paneId)`. The Lane goes `live`. If the reason was `unsure-delivered`,
  the notice says that the first keys can arrive twice. The user decides that, not the app.
- **Move to Composer**: `outbox.take(paneId)` returns the keys and empties the Lane.
  `toDraftText` makes text from them (Enter is a newline) and the Attach appends it to the Pane's
  Draft. Keys that cannot be in a Draft (`↑`, `^C`) are in `notice.draft.dropped`, so the button
  names them before the tap.
- **Discard**: `outbox.take(paneId)`, and the result is not used.

**Pane view.** It keeps the rule that a key typed while scrolled back is spent on the jump to the
latest row, and then calls `input.type` / `input.press`. It loses `outgoing`, `sending`,
`flushTyped`, the `outgoing = []` in `dispose`, and `PaneReader.sendKeys` / `sendKey`.
`TmuxClient.sendKeys` / `sendKey` are deleted in the same change
(per migrate-callers-then-delete-legacy-apis).

**Interface depth.** The Outbox has six methods. Behind them are the numbering, sealing, the ack
format, the identity check, the TTL, the key policy and the reconnect order. The Pane view sees two
methods. The screen sees a list of notices and two Attach methods. No wire type crosses the
`OutboxLink`: it speaks `Batch` and `PaneMark`.

## Tests

Jest, beside the code:

- `input-lane.test.ts`, no fakes. Each row of the verdict table. A Batch keeps its Seq on a second
  write. Keys typed in `adrift` and `held` keep their order. `discard` lets later keys flow at
  Seq 1. `toDraftText` and `isSafeKey` by table.
- `input-outbox.test.ts`, fake `OutboxLink`. One line in flight at a time. An answer from an ended
  Connection changes nothing. `lost` then `connected` sends the read before any Batch. Notices
  reach `onNotices`.
- `control-connection.test.ts`. A chain of three settles with three replies. An `%error` on the
  second settles with two and leaves the next Pending in step. `finish` fails a half-answered chain.
- `commands.test.ts`. `parsePaneMark` with an empty `pane_pid`, an empty option, another token's
  value. `describeCommand` of a chain shows no bytes. A `;` key is quoted.
- `pane-view.test.ts`. A key while scrolled back does not reach the input. `dispose` loses nothing.

One e2e in `e2e/control-mode.test.ts`, real tmux through `e2e/sandbox.sh`, a Pane that runs `cat`:

1. Type `abc`. Wrap the transport so it drops the reply to the Batch line, then kill the child.
2. While disconnected, type `def`. Reconnect. `capture-pane` shows `abcdef` once.
3. Break again, type `x` and Enter, reconnect. `state.input` has one held notice. `heldInput(..,
   'send')` puts `x` and a new line in the Pane once.
4. `kill-server`, start a new server with the same Session name, type before the reconnect. The
   notice is `discarded` with `server-restarted`, and the new `%0` got nothing.

## Synthesis decision

*Filled in by arena.*

## Tradeoffs accepted

- We accept about 30 more bytes in each reply (the mark) in exchange for a witness that is always
  fresh and needs nothing from the Topology.
- We accept one verdict per Lane in exchange for a prompt about whole text. A safe prefix in front
  of an Enter is held with it.
- We accept that a held Lane goes back to `adrift` on a break and is judged again, in exchange for
  one path through a reconnect. A Send that a second break interrupts asks again.
- We accept that the Outbox lives in memory. Keys do not survive an app that iOS ends.

## Alternatives considered

- **Compare-and-send in tmux**: `if-shell -F '#{==:#{@muxify-in},k7f2:6}' "send-keys .. ; set-option .."`.
  tmux would refuse a second delivery by itself. The probe showed that it works, and that the
  inner commands add their own reply blocks, so the count of replies depends on the condition. It
  hides the dedupe in tmux but exposes an unknown reply count to the Control Connection. The
  policy checks need the mark read in any case. It lost.
- **Identity from the Topology** (`#{pid}`, `#{pane_pid}` added to `list-panes`). The Outbox would
  then depend on a second module for a fact that it can read on its own line, and
  `pane_current_command` from the Topology is as old as the last refresh. It lost on leakage.
- **A verdict per Batch** (send the safe prefix, hold from the first risky Batch). More keys flow
  without a question, but the caller gets a prompt about a fragment, and Move to Composer moves a
  lone Enter. It lost on the user's view.

## Implementation reconciliation

*Empty until implementation.*

## Open questions and risks

- Is the "one `%error`, no more blocks" rule true on tmux 3.0a to 3.5a? The probe ran on 3.8 only.
  If an old tmux gives a block for each skipped command, `runChain` goes out of step.
- What is tmux's limit for one control mode line? `maxBatchBytes` needs a measured value.
- Is Backspace (0x7f) safe to send without a question? The rule today says no, so text with a
  correction in it is held.
- Should the held preview hide the text? A password typed blind would be on the screen.
- What must happen to pending keys when the user closes the Attach (Go Home) while disconnected?
  This design has no answer: the Outbox ends with the Attach.
- A Composer Send and a paste use `paste-buffer`, not the Lane. Their order against keys that wait
  in a Lane is not defined. Should they wait for an empty Lane?

## Next implementation step

Write `input-lane.ts` with `step` and `judge` and its table tests, before any wire change.
