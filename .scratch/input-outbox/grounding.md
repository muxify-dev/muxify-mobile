# Grounding: typed input and the Connection (Phase A, `how`)

Goal (Gleb): no key typed in Muxify Mobile vanishes when the Connection breaks. Each key reaches its Pane
exactly once, or is shown to the user (held / discarded with notice). Never silently lost, never typed twice.

Full investigation with file:line evidence: ~/.local/share/lavish-axi/85be64266483/input-outbox.html
(sections 1, 2, 4, 5). Read CONTEXT.md (glossary: Host, Connection, Attach, Session, Window, Pane,
Surface, Key Row, Composer, Draft...) and ADRs 0006, 0007, 0011, 0012 before designing.

## Today's input path
1. Surface `onInput` (base64) -> `src/app/terminal.tsx:813` handlePaneInput -> `deliverInput` (:794)
   -> `view.type(bytes)` / `view.press(key)`. Key Row -> `pressKey` (:976) -> `view.press(name)`.
   Pair keys -> `pressSymbol` (:986). Paste and Composer go through other paths (paste-buffer), not this one.
2. `src/tmux/pane-view.ts` owns `outgoing: Outgoing[]` (:346-348), `type()` (:670), `press()` (:696),
   `flushTyped()` (:639). Nagle-style: one send in flight; bytes typed during the round trip merge into the
   last bytes item; a named key (string | KeyPress) is its own item; order kept.
   `type`/`press` while scrolled back (`back > 0`) spend the key on jumpToLatest and do NOT send.
3. `src/tmux/attach.ts:497-565` viewFor builds each PaneView with a PaneReader whose `sendKeys`/`sendKey`
   call `sizing.reclaim()` then `reading()` -> current TmuxClient or reject "the Connection has gone".
   Views are per generation: `releaseViews()` (:602) disposes all on teardown (:884); a reconnect is a
   *replacement* (:271-277, `replace` :950), not a repair. `attach.view(paneId)` = viewFor (:1227).
4. `src/tmux/tmux-client.ts:314` sendKeys -> `mustRun('send input', sendKeysCommand(paneId, bytes))`;
   :353 sendKey: string -> `send-keys -t %N <name>`; KeyPress -> renderPress(keyNaming) -> name or bytes.
   `src/tmux/commands.ts:313-333` builders; `describeCommand` (:91) hides typed bytes from the Log (keep that!).
5. `src/tmux/control-connection.ts`: `runLines` (:279) queues one Pending per *line*; `flush` writes; replies
   map 1:1 to Pending in order (:220). `runAll` writes several lines in one go. `finish()` (:170) fails all
   pending+waiting with TmuxError.
6. Transport `src/tmux/ssh-transport.ts`; keepalive 5 s x 3 (`src/ssh/connect-host.ts:70-73`).

## Loss points (to close)
- L1 pane-view.ts:641 shift-before-send; :647 catch drops the batch. In-flight batch is ambiguous.
- L2 control-connection.ts:170-177 strands pending/waiting.
- L3 dispose `outgoing = []` (pane-view.ts:914) on releaseViews: everything queued during the ~15 s
  before the keepalive notices. Biggest loss, silent.
- L4 keys typed while disconnected: Surface still sends; new view's reading() rejects each.
- L5 bytes in SSH/TCP buffers: only the tmux reply proves delivery.

## Verified facts (probe on tmux 3.8, e2e/sandbox.sh)
- Control mode line `send-keys -t %N -H .. ; set-option -p -t %N @muxify-in 7` runs both; the option reads back.
- If send-keys fails, the set-option on the same line does NOT run (one %error).
- One line with two commands yields TWO %begin/%end reply blocks -> Control Connection must expect one
  reply per *command*, not per line (today it is per line).
- Inference: the two commands of one line run back-to-back (tmux single-threaded cmdq; neither blocks).
- Pane user options die with the Pane; a restarted server reuses pane ids from %0.

## Design decisions already made by Gleb (from section 5)
- Outbox owned by the Attach, keyed by Pane id, survives replacement. Pane views stop owning `outgoing`.
- Same Nagle batching, no timers.
- Each batch numbered; sent as one line `send-keys ... ; set-option -p -t %N @muxify-in <n>`; removed only on reply.
- On reconnect, per Pane with pending batches: read identity + `@muxify-in`; drop batches <= n; then
  send (safe) / hold (ask: Send, Move to Composer, Discard) / discard (with notice).
  safe = same server, same Pane, same program, younger than TTL (30 s, start value), only printable
  text and arrows. hold = Enter / control bytes / named keys other than arrows / older than TTL / program changed.
  discard = different server or Pane (pid changed) or Pane gone.
- Keys typed while disconnected go into the Outbox too, behind held keys (order per Pane).
- Out of scope: loading / error display (separate task), cursor (separate task), desktop app.

## Open design hints (runners decide)
- Identity could live in the option value itself: `@muxify-in = <token>:<seq>` where token is fresh per
  Outbox; a different/new Pane has no such value. Edge: nothing acked yet (first batch in flight).
  Alternatively read `#{pid} #{pane_pid}` and record them per batch.
- Where does `pane_current_command` at typing time come from? Topology already lists it
  (commands.ts:219), PaneState read is per view.
- How the hold prompt reaches the UI (AttachState field? Composer API `src/composer/composer.ts`).
- Classification must be a pure function (testable in Jest, `pnpm test`).
- Tests live beside code (`src/tmux/*.test.ts`, fakes for CommandRunner); e2e/control-mode.test.ts runs real tmux.
