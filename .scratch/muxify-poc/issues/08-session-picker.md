# 08 — Session picker

**What to build:** The Sessions button in the Dock opens a native glass sheet
listing the Sessions running on the current Host. Picking one switches the
attached client to it without leaving the terminal, so moving between projects
takes a tap instead of a tmux keybinding.

The list is read live each time the sheet opens, so it is never stale.

**Blocked by:** 06, 07

**Status:** ready-for-agent

- [ ] A Sessions button is added to the Dock's first group
- [ ] Tapping it opens a glass sheet listing the Host's current Sessions
- [ ] The list is re-read each time the sheet opens
- [ ] Selecting a Session switches the attached client to it
- [ ] The currently attached Session is indicated in the list
- [ ] The terminal redraws into the newly selected Session
