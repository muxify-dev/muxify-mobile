# 07 — Stop borrowing anything

**What to build:** the deletion the whole effort was for. No Session option is
read, set, restored, or hooked, and nothing in the app says otherwise.

**Blocked by:** 03, 04, 05, 06

**Status:** ready-for-agent

Goes: `session-preparer.ts` and its tests, `restoreOnDetachCommand` /
`clearRestoreHookCommand` and the `client-detached` hook, the read/set pairs for
`status`, `window-size` and `mouse`, and the **Attached** warning on the Host
Screen — which exists only to say that joining shrinks somebody's Window.

`CONTEXT.md` is rewritten where it describes the attached-client design:
**Control Command**, **Shell Channel**, **Attached**, **Scrollback**, and the
**Attach** entry. **Client** now means the control client. Add **Control
Connection**.

- [ ] No `set-option` or `setw` anywhere in `src/`
- [ ] A Session attached, used, and force-quit is byte-identical in `show-options`
- [ ] `CONTEXT.md` describes what the code now does
- [ ] ADR 0006's consequences match what shipped, or the ADR is corrected
