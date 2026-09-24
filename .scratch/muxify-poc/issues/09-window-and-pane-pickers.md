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
- [x] Each button is disabled when there is nothing to pick
- [x] The terminal redraws after a selection

**Notes:** Selecting a row cannot be driven by agent-device (see ticket 08), so
`e2e/pickers.sh` covers everything up to the row: the Host's real Topology
reaching both sheets, the current Window and Pane being marked, and a button
with nothing to offer being genuinely disabled. It drives the Host's Topology
itself and puts it back, so it does not depend on how the VM was left.
