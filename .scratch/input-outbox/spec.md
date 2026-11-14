# Input Outbox: spec (synthesized design)

Status: ready-for-agent

Goal (Gleb): no key typed in Muxify Mobile vanishes when the Connection breaks. Each key reaches its
Pane exactly once, or the user sees it (held for a decision, or discarded with a notice). Never
silently lost, never typed twice.

Read in this order: `grounding.md` (loss points L1-L5, probe facts), then `base-design.md` and
`base-sketch.ts` (the base: a pure Lane reducer per Pane, from the arena). This file lists every
change to the base. Where this file and the base disagree, this file wins.

## Synthesis decision

Base: candidate 2 (pure `step(lane, event, ctx)` reducer, one `PaneMark` read path, `runChain`,
`AttachState.input`, `heldInput` / `dismissInput`). Picked by me and by the cross-judge: most correct
wire facts, pure reducer, identity needs no Topology, every delivery renews the witness.

Grafts (each fixes a defect the judge or a probe found):

1. **One Outbox-wide Seq, never reset** (from candidate 1). The base restarted a Lane at Seq 1 after a
   discard; a respawned Pane keeps its option, so an old ack (e.g. 7) would cover new Seqs: silent loss.
   `nextSeq` lives in the Outbox, strictly increasing for its lifetime, shared by all Lanes.
2. **Per-Outbox option name, plain number value** (from candidate 3). The ack option is
   `@muxify-in-<token>` and holds only the Seq as decimal digits. Another phone or an earlier app run
   writes its own option, so nothing overwrites ours. `Ack` is `Seq | null`; the token is in the name.
   `PANE_MARK_FORMAT` reads `#{@muxify-in-<token>}` (format string built per token).
3. **A guard inside tmux against late lines** (from candidate 3, corrected by the judge's probe on 3.8).
   A line the dead Connection already wrote can reach tmux after the reconnect read and type its keys
   twice. Each Batch line is:
   ```
   if-shell -F '#{e|<:#{e|+:0,#{@muxify-in-T}},N}' '<send-keys …> ; set-option -p -t %P @muxify-in-T N' '<padding>' ; display-message -p -t %P '<mark format>'
   ```
   - The compare MUST be numeric (`e|<`); `#{<:9,10}` is a string compare and is 0 (judge probe).
   - `if-shell` true gives 1 + N reply blocks, false gives 1 (judge probe). Pad the else branch with
     `display-message -p muxify-dup` commands so both branches give the same count. The trailing
     mark read then always comes back at a known position. A skipped (dup) line is a delivered line.
   - An inner failure gave 2 blocks (judge probe). Whether the outer trailing command still runs after
     an inner `%error` is NOT known: probe it first (see Blocking first steps) and encode the answer in
     `runChain`'s settle rule and in a test.
   - Nested quoting: inner commands are rendered with `renderControlCommand` and passed as ONE argument
     to `if-shell`. Prove with real tmux that key names containing `;` `'` `"` `\` `$` `#` `{` survive
     (e.g. KeyPress `M-;`). If a name cannot be quoted safely, send its bytes with `-H` instead.
   - Version: find the tmux version that added `e|` format math and `if-shell -F` (tmux CHANGES file;
     cite it in a comment). For an older Host tmux, send the unguarded chain and log once that the late
     line guard is off. `TmuxClient.keyNaming()` already reads `#{version}`; reuse that read.
4. **One Key per Batch** (from candidate 4). The base put several keys (text and named) in one line; if
   a later `send-keys` failed, the earlier keys landed with no ack and a resend doubled them. A Batch is
   exactly one `Key`: a text Key (adjacent bytes merged, Nagle) or one named key. Inner chain is always
   `send-keys` + `set-option`, so padding is always two `display-message` commands.
5. **Gestures are never replayed** (from candidate 4). Wheel notches and mouse bytes that pane-view
   makes from a scroll or tap (`src/lib/mouse-wheel.ts`, pane-view's mouse paths) enter the Lane as
   `Key` with `gesture: true`. On `lost`, gesture keys are removed from `unconfirmed`/`waiting`; the Log
   gets a count. They are never held and never shown in a preview.
6. **Line cap** (from my probe on 3.8): one line with 8000 typed bytes worked, 16000 gave `%error`.
   `maxBatchBytes` = 2048 (hex is 3 chars per byte, plus the guard and mark). A longer text run splits
   into several Batches.

Not grafted, on purpose: a fence that detaches the previous Control Client (my probe: it works, but a
line already handed to the server is not covered; the guard covers it). A per-Pane queue byte cap (no
evidence it is needed; paste does not use this path).

## Decisions for the open questions (defaults; report them to Gleb)

- Backspace (0x7f) is NOT safe (base rule). Text with a correction in it is held.
- The held preview shows the text (Gleb asked for a confirm-before-replay; hidden text cannot be judged).
  It never goes to the Log.
- The Attach closes (Go Home, another Session) with pending keys: discard them and write a count to the
  Log. (Out of scope to prompt; report it.)
- Composer Send and paste keep using `paste-buffer` outside the Lane; ordering against waiting keys is
  unchanged from today. (Report it.)
- `waiting` notices are produced but not drawn: loading display is a separate task.

## UI (terminal.tsx)

A held notice for the active Pane (or the first held one) shows as a compact card above the Key Row:
the preview (monospace, one or two lines, cut at 120 chars), one line naming the reasons in plain words,
and three buttons: Send, Move to Composer (its label names the keys it drops, from `DraftText.dropped`),
Discard. Send is enabled only while connected. A discarded notice shows the preview, the reason and one
Dismiss button. Follow the existing Banner / Key Row styling and the Theme palette (`paletteFor`);
match the copy style of nearby strings (plain, short). No new loading or error display.

## Out of scope
Loading/error display, the cursor, desktop Muxify, persisting the Outbox across app kills.

## Implementation reconciliation

Measured on tmux 3.8 with `e2e/probe-input-guard.mjs` (run through `e2e/sandbox.sh`). Each
deviation below follows from a measurement or closes a gap the spec left.

1. **The end of a Batch line's replies is a marker line, not a count** (replaces "pad the else
   branch", graft 3). Measured block counts for the guarded line: 4 when it types, 4 with the
   padding or 2 without it when it is a copy, 3 when the inner `send-keys` fails (`if-shell` ok,
   one `%error`, then the mark). The trailing mark DOES run after an inner `%error`. A line that
   tmux cannot parse gives one `%error` and nothing else. No count covers these, so `runChain`
   writes `<line>\ndisplay-message -p muxify-chain-end-<n>` in one write and collects every block
   before the marker. The padding was removed: it had no use left.
2. **`if-shell` needs `-t %P`.** Without it the option is read from the Client's current Pane,
   not from the Batch's Pane. With a Pane that is gone, `if-shell -t` still runs (the format is
   true), the inner `send-keys` gives `can't find pane`, and the mark has an empty `pane_pid`.
3. **A new effect, `burn`.** After Move to Composer or Discard of a Batch that was written
   before the break, a late line of the dead Connection could still type it. The Lane now asks
   for `if-shell -F … 'set-option -p … <seq>'`, which raises the Pane's Seq and types nothing.
4. **`judge` takes `crossed`.** The policy (risky keys, TTL, program, witness, identity) applies
   only to keys from before the current Connection. Keys typed in the first round trip of a new
   Pane view, before its mark is back, are sent without a question.
5. **`unsure-delivered` has one meaning now**: the Pane's Seq is below a Seq this Lane already
   saw confirmed (someone changed the option), or a live reply does not cover its own Batch.
   Another token cannot be read at all, because the token is in the option's name.
6. **Gestures made with no live Pane are dropped at once**, not kept until `lost`. A scroll of a
   Pane with no Connection moved nothing, and must not move it later.
7. **Two callers of `sendKey` stay off the Lane**, on a new `TmuxClient.pressKey(paneId, name)`:
   the Enter behind a Composer Send (the Composer has its own delivery and its own "uncertain"
   state) and the `C-l` of Clear (an action that fails with an alert when not connected; on a
   held Lane it would wait behind the held keys while `clear-history` ran).
8. **Move to Composer applies a Backspace** to the text before it in the Draft. A Backspace with
   nothing before it is named in the button as a dropped key.
9. **A named key that is one printable character is safe**, like the same character as text.
10. **The card is hidden while the Composer is open**, because the Composer is drawn in the
    card's place. It shows again when the Composer closes.
11. **The mark's fields have colons between them, not tabs.** Measured in containers with no
    locale: tmux 3.0a and 3.2a print a tab as `_` to a client that is not UTF-8, so the mark was
    `1_274_291_cat` and no Batch was confirmed. `PANE_MARK_FORMAT` is
    `#{@muxify-in-T}:#{pid}:#{pane_pid}:#{pane_current_command}`.
12. **`maxBatchBytes` and the TTL are constants of the Outbox and the Attach**, not options.

Older tmux, measured with the same probe in Docker (`PROBE_CONTAINER=<id>`) and with
`pnpm e2e:tmux-keys`, which now sends each press as a Batch and checks its mark: tmux 3.2a
answers the guarded line as 3.8 does (4 blocks, 4 or 2 for a copy, 3 for an inner error, mark
after the error). tmux 3.0a has no `e|`, so the format is empty, the guard is false and nothing
is typed: such a Host gets the plain chain. On 3.0a the mark read of a Pane that is gone is a
`%error`, not empty fields; both read as `gone`. Batches confirmed by their own mark: 9198 on
3.8, 4599 on 3.2a (guarded), 1533 on 3.0a (plain chain), 0 broken.

Facts measured, for the record: nested quoting through `renderControlCommand` delivers `M-;`
`M-'` `M-"` `M-\` `M-$` `M-#` `M-{` `;` `'` `#{pid}` `$HOME` unchanged, so no key needs `-H`.
`#{<:9,10}` is 0 and `#{e|<:9,10}` is 1. A guarded line with 8000 typed bytes (24277
characters) runs; 16000 bytes is `yacc stack overflow`. Numeric format compares are from tmux
3.2 (CHANGES FROM 3.1c TO 3.2: "Add numeric comparisons for formats"), `if-shell -F` from 2.0,
pane options from 3.0.

Left open: the `@muxify-in-<token>` option stays on a Pane after the Attach ends. A tmux older
than 3.0 has no pane options, so its Batch line fails after the key is typed; the app's other
tests start at 3.0a.
