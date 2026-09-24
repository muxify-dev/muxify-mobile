# 08 — Session picker

**What to build:** The Sessions button in the Dock opens a native glass sheet
listing the Sessions running on the current Host. Picking one switches the
attached client to it without leaving the terminal, so moving between projects
takes a tap instead of a tmux keybinding.

The list is read live each time the sheet opens, so it is never stale.

**Blocked by:** 06, 07

**Status:** done

- [x] A Sessions button is added to the Dock's first group
- [x] Tapping it opens a glass sheet listing the Host's current Sessions
- [x] The list is re-read each time the sheet opens
- [x] Selecting a Session switches the attached client to it
- [x] The currently attached Session is indicated in the list
- [x] The terminal redraws into the newly selected Session

**Notes:** The sheet is `@expo/ui`'s `BottomSheet`. Selecting a row cannot be
driven by agent-device — nothing inside a presented sheet responds to it, while
the same Buttons in the Dock press fine. Verified by hand instead: the sheet
works for a finger. `e2e/session-picker.ad` covers everything up to the sheet
being open with the attached Session marked; the switch itself is covered by
`session-preparer.test.ts` and the `TmuxClient` tests.
