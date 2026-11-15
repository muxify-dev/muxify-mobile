# Split and New Window happen one time

Status: done. ADR 0023 records what was built; it adds the server pid check.

Phase 4 of the Outbox plan (`~/.local/share/lavish-axi/c893df0baf24/outbox-investigation.html`,
sections 4 option C and 6).

## Problem

Split (right, down) and New Window go straight to the Control Connection, one
time (`src/tmux/attach.ts` `split`, `newWindow`). When the Connection breaks
after the line left the phone, the app cannot know if tmux ran it. The Alert
says the verb failed, and a second tap can make a second Pane or Window.

## What changes

These verbs change the Session, not the input of a Pane, so they do not join
the Lane. They get the same kind of guard as a Batch:

- The Attach has a Verb guard with its own token and one count that only
  grows, like the Outbox's Seq. Call its number an Op.
- The Session keeps the highest Op it took in the user option
  `@muxify-op-<token>` (Session scope, `set-option -t <session>`, no `-p`).
- The verb line: `if-shell -F -t <session target> '<Op below>' '<verb> ;
  set-option -t <session> @muxify-op-<token> <op>'`, then a read of the
  option with `display-message -p -t <session target>`. One `runChain`.
  `<Op below>` is the same numeric compare as `belowSeq` in
  `src/tmux/commands.ts`; share it, do not copy it.
- One unconfirmed verb at a time: `{ op, verb, session }`. It is confirmed
  when the read shows the option at or above its Op.
- When the Connection breaks before the answer, the Attach keeps the
  unconfirmed verb. The verb's promise ends without an error (a Log line says
  the verb waits for the Connection), so `terminal.tsx` shows no Alert.
- On the next Connection, in the order of `attach.ts` (size the Client, then
  the Outbox, then Zoom; the verb goes after the Outbox and before Zoom), read
  the option of the verb's Session:
  - at or above the Op: done.
  - below: send the same line again, with the same Op. The guard refuses it if
    a late line of the lost Connection already ran it.
  - the Session is gone: drop it, with a Log line.
- tmux below 3.2 has no numeric compare. There the verb runs as now, with no
  guard, and an unconfirmed verb is dropped after a break with a Log line,
  never sent again.
- A verb tapped while no Connection is up does nothing, as now.

## Done when

- Unit tests for the verb guard's states: confirmed, kept across a break,
  read at or above (done), read below (sent again with the same Op), Session
  gone, old tmux.
- `commands.test.ts` covers the guarded line.
- An e2e against a real tmux through `e2e/sandbox.sh` (the `card-check.sh`
  pattern): `kill -STOP` the tmux server, split, end the Connection,
  `kill -CONT`, reconnect. The Window has exactly one new Pane. The same for
  New Window: exactly one new Window.
- `pnpm test`, `pnpm lint` (no new warnings) and `npx tsc --noEmit` pass.
- An ADR and the `CONTEXT.md` term (written by the lead).
