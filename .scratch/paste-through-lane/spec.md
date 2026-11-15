# Paste and Composer Send go through the Lane

Status: done. ADR 0022 records what was built; it differs from this spec in the Draft rule and adds clear.

Phase 3 of the Outbox plan (`~/.local/share/lavish-axi/c893df0baf24/outbox-investigation.html`,
sections 2b, 4 option C and 6).

## Problem

Paste (⌘V on the Key Row) and Composer Send do not go through the Outbox. They
go straight to the Control Connection. So:

- A paste can reach the Pane before keys that the user typed earlier and that
  wait in the Lane.
- After a break, a paste or a Send can be sent two times, or the user cannot
  know if it arrived. The Composer shows an uncertain phase ("Delivery may have
  reached the Pane") and locks Send until the user checks the Pane.
- A key typed between the paste and the Enter of a Send lands between them.

## What changes

A paste is a Key of the Lane, like typed text. It gets one Seq, whatever its
size. The Seq guard in tmux refuses a copy of it. The Lane sends it in order
with the other Keys of the Pane.

### The Key

```ts
| {
    readonly kind: 'paste';
    readonly text: string;
    /** Press Enter after the paste: a Composer Send. */
    readonly submit: boolean;
  }
```

- `append` never merges a paste with other Keys. `pump` never cuts a paste.
- `isSafeKey`: a paste is safe only when `submit` is false and the text has no
  character below U+0020 and no U+007F. A newline is not safe.
- `previewOf`: the text as typed, a newline as `⏎`, and a `⏎` at the end when
  `submit` is true.
- `toDraftText`: the text, with its newlines. The Enter of `submit` adds
  nothing to the Draft and is not listed as dropped: Send in the Composer
  presses it again.

### The line

One Composer Send is one Batch, not a paste Batch and an Enter Batch. The plan
said two Batches. One Batch is the better shape: the Seq covers the paste and
its Enter together, the 150 ms settle happens in tmux, and the Lane gets no
clock. Measured on tmux 3.8 through `e2e/sandbox.sh`: a guarded line with
`run-shell` in the middle waited for it before the Enter and the Seq write.

`TmuxClient.deliver` for a paste Batch:

1. Stages the text in a buffer named `muxify-<token>-<seq>-<random>`, with
   `runAll` of `set-buffer` chunks of 2048 code points. The first chunk has no
   `-a`. A failed reply is a `refused` result. The random part is new for each
   write, so a late staging line of a lost Connection cannot append to the
   buffer of the next write.
2. Runs one chain with `runChain`:
   - guarded: `if-shell -F -t <pane> <below seq> '<paste> ; set-option …'
     'delete-buffer -b <name>'`, then the mark read. `<paste>` is
     `paste-buffer -p -r -d -b <name> -t <pane>`, and for `submit` also
     `run-shell 'sleep 0.15' ; send-keys -t <pane> Enter`. The else branch
     deletes the buffer of a copy.
   - not guarded (tmux below 3.2): the same commands, without `if-shell`.

`run-shell 'sleep 0.15'`, not `run-shell -d`: it works on every tmux that
Muxify supports. The Control Connection waits 150 ms for each Send. That is
accepted.

### Callers

- `PaneInput` gets `paste(text: string, submit: boolean): void`.
- The Key Row paste (`attach.paste`): an image is uploaded first, as now. Text
  with a line break still asks `runLines` when the program did not ask for
  bracketed paste, which needs a Connection, as now. Then it goes into the Lane
  of the active Pane. Plain text needs no Connection: the Lane keeps it.
- The Composer: uploads go as now. Then the message goes into the Lane of the
  Draft's Pane with `submit: true`, and the Draft is cleared at once. From then
  on the Lane owns the message: the held card shows it, and Move to Composer
  gives it back as a Draft.
- Delete the Composer's `sending` and `uncertain` phases, `acknowledge`, the
  `started` callback, `openDelivery().paste`, `pressEnter`, `pressKey` and
  `preparePaste` where nothing else uses them. The Composer panel loses
  "Sending…" and "Keep draft".

### After a break

The Lane judges a paste like typed text. Printable text that is fresh is sent
again with the same Seq; the guard refuses it if it arrived. A paste with a
newline, a control character or `submit` is held.

## Done when

- `input-lane.test.ts`: a paste typed after text that waits lands after it;
  an acked paste is confirmed without a resend; a paste with a newline or with
  `submit` is held after a break; plain fresh paste is sent again.
- `commands.test.ts` / `tmux-client.test.ts`: the staging and the guarded line.
- `composer.test.ts`: Send clears the Draft after the uploads; no uncertain
  phase.
- An e2e against a real tmux through `e2e/sandbox.sh` (the `card-check.sh`
  pattern: `kill -STOP` the tmux server mid-send, end the Connection,
  `kill -CONT`, reconnect): the Pane shows the paste one time, never two.
- `pnpm test`, `pnpm lint` (no new warnings over 60) and `npx tsc --noEmit`
  pass.
- ADR 0011 and ADR 0019 changed, and `CONTEXT.md` (Outbox, Batch, Held keys,
  Draft) says that paste and Composer Send go through the Outbox.
