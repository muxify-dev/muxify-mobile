# Remediation of the Verify findings

The Verify report `2026-11-14T18:46:51Z.md` left two items for an agent to fix.
Both are now closed.

## T5: tsc in the files of the set

`e2e/tmux-keys.test.ts` now calls `describe.each<string>(TARGETS)`. Other tests
in this repository give the row type in the same way. `npx tsc --noEmit` now
reports no error in a file changed in 81d52d5..HEAD. Two errors remain, in
`e2e/host-cli.test.ts:73` and `src/constants/theme.ts:6`. These files are not
in the set.

## T3: the card on screen

`card-check.sh` (in this folder) ran twice on a new iPhone 18 Pro simulator,
through `e2e/sandbox.sh`, with Metro on port 8090. Both runs gave 15 PASS
lines and 0 FAIL lines.

1. **Send while not connected.** The app cannot show a held card while the
   Attach is not connected. Every path out of `connected` calls `teardown()`,
   which calls `outbox.lost()` before the phase changes (`src/tmux/attach.ts`,
   `ended`, `replace`, `close`). A lost Lane goes `adrift`
   (`src/tmux/input-lane.ts`, case `lost`), and `noticeOf` returns no held
   notice for an adrift Lane. The phase is `connected` before
   `outbox.connected()` judges any key. So `disabled: !connected` on Send is a
   guard that no reachable state shows. On screen: a held card showed Send.
   After a second break, the card and Send were gone. After the reconnect,
   the card came back.
2. **Move to Composer with a busy Draft.** The tmux server process was stopped
   during a Composer send, so the Draft stayed at "Sending…" and the
   Connection stayed open. With the Composer closed, Move to Composer left the
   Composer closed and the keys on the card. After tmux continued, the Draft
   reached the Pane. Then Move to Composer opened the Composer, and the card
   went away.
3. **Discarded card.** Keys were typed on a silent link, and the Pane was
   started again with `respawn-pane -k` before the reconnect. The discarded
   card showed with Dismiss. Dismiss removed it, and the discarded key never
   reached the Pane.

Gates: `pnpm test` gave 80 suites and 1477 tests passed. `pnpm lint` gave
0 errors and 53 warnings.
