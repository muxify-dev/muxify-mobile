# 07 — Stop borrowing anything

**What to build:** the deletion the whole effort was for. No Session option is
read, set, restored, or hooked, and nothing in the app says otherwise.

**Blocked by:** 03, 04, 05, 06

**Status:** done

Goes: `session-preparer.ts` and its tests, `restoreOnDetachCommand` /
`clearRestoreHookCommand` and the `client-detached` hook, the read/set pairs for
`status`, `window-size` and `mouse`, and the **Attached** warning on the Host
Screen — which exists only to say that joining shrinks somebody's Window.

`CONTEXT.md` is rewritten where it describes the attached-client design:
**Control Command**, **Shell Channel**, **Attached**, **Scrollback**, and the
**Attach** entry. **Client** now means the control client. Add **Control
Connection**.

- [x] No `set-option` or `setw` anywhere in `src/`
- [x] A Session attached, used, and force-quit is byte-identical in `show-options`
- [x] `CONTEXT.md` describes what the code now does
- [x] ADR 0006's consequences match what shipped, or the ADR is corrected

## Comments

`session-preparer.ts` and its tests are deleted, along with every borrow and
restore command, the `client-detached` hook, and the **Attached** badge.

`#{session_attached}` is no longer even asked for. It was only ever read to draw
that badge, and the badge was a warning that joining would shrink somebody's
Window — which a control client cannot do.

Also updated: `e2e/regressions.sh`, whose checks 3 and 7 used to assert that the
status line was hidden on attach and restored on the way out. They now assert
something stronger and simpler — `show-options` and `show-hooks` on the Session
are byte-identical before, during and after. `scripts/dev-loop.sh` stops
reporting a Client size, because there is no pty to have one.

ADR 0006 gained a "What shipped, where it differs" section for the two places it
was wrong by a hair: a Control Command is *not* always on the Control Connection
(the Host Screen and the new-Session form have no Session to attach to yet), and
commands had to become argument lists because shell quoting and tmux quoting are
different rules.
