# 05 — Topology from notifications

**What to build:** the Session, Window and Pane pickers open on a model that is
already right, because tmux has been pushing changes all along rather than being
asked when a sheet opens.

**Blocked by:** 03

**Status:** ready-for-agent

`%layout-change` carries the same `#{window_layout}` string `layout.ts` already
parses. `%window-add`, `%window-close`, `%window-renamed`,
`%window-pane-changed` and `%session-changed` carry the rest. Read the Topology
once on Attach, then keep it by notification.

This deletes rather than adds: the picker warming, the picker cache, and the
settling that existed because a poll could catch tmux mid-change.

- [ ] A Window split elsewhere shows up in the Panes picker without opening it twice
- [ ] A Window renamed on the laptop renames here
- [ ] Opening a picker issues no command
- [ ] The warming and cache added for the polled path are gone
