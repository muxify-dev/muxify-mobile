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

**Status:** ready-for-agent

- [ ] Windows and Panes buttons complete the Dock's first group
- [ ] Each opens a glass sheet listing the current Topology, read on open
- [ ] The active Window and the active Pane are indicated
- [ ] Selecting a Window or Pane moves the attached client to it
- [ ] Each button is disabled when there is nothing to pick
- [ ] The terminal redraws after a selection
