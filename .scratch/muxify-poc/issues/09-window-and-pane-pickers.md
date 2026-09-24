# 09 — Window and Pane pickers

**What to build:** Windows and Panes buttons alongside Sessions in the Dock,
each opening a glass sheet of the current Session's Topology. Selecting a Window
or Pane moves the attached client to it, so a user can navigate a Session
without knowing tmux keybindings.

Each picker shows which Window or Pane is currently active, so the user knows
where they are before they move. Buttons are disabled when there is nothing to
pick, rather than opening an empty sheet.

Topology is read on demand through Control Commands; Muxify holds no live model
of it.

**Blocked by:** 08

**Status:** done

- [x] Windows and Panes buttons complete the Dock's first group
- [x] Each opens a glass sheet listing the current Topology, read on open
- [x] The active Window and the active Pane are indicated
- [x] Selecting a Window or Pane moves the attached client to it
- [~] Each button is disabled when there is nothing to pick — **superseded**, see below
- [x] The terminal redraws after a selection

**Notes:** Selecting a row cannot be driven by agent-device (see ticket 08), so
`e2e/pickers.sh` covers everything up to the row: the Host's real Topology
reaching both sheets, the current Window and Pane being marked, and a button
with nothing to offer being genuinely disabled. It drives the Host's Topology
itself and puts it back, so it does not depend on how the VM was left.

**Correction:** the disabled-when-nothing-to-pick criterion was wrong, and was
built before being questioned. The sheets are not only pickers: New Window and
Split live in them, and a Session with one Window or one Pane is exactly when
those are wanted. Disabling the button locked the user out of the only way to
make a second one. Both buttons now open whenever connected, and a one-item
sheet says what the action below it will do.
