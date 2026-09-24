# 05 — Topology from notifications

**What to build:** the Session, Window and Pane pickers open on a model that is
already right, because tmux has been pushing changes all along rather than being
asked when a sheet opens.

**Blocked by:** 03

**Status:** done, bar the previews — see Comments

`%layout-change` carries the same `#{window_layout}` string `layout.ts` already
parses. `%window-add`, `%window-close`, `%window-renamed`,
`%window-pane-changed` and `%session-changed` carry the rest. Read the Topology
once on Attach, then keep it by notification.

This deletes rather than adds: the picker warming, the picker cache, and the
settling that existed because a poll could catch tmux mid-change.

- [x] A Window split elsewhere shows up in the Panes picker without opening it twice
- [x] A Window renamed on the laptop renames here
- [~] Opening a picker issues no command
- [x] The warming and cache added for the polled path are gone

## Comments

`createTopologyStore` holds the model; the picker warming, the picker cache and
`TOPOLOGY_REFRESH_MS` are gone.

The honest shape is two kinds of notification, not one. A rename, a close, a
layout change and a Pane change each carry enough to act on, so they are applied
in memory and the sheet opens on a model that is already right. An *add* carries
only `@3` — not its index, not its name, not what it is running — so it marks
the model stale and the Topology is read once, when it happened, rather than
every time somebody looks. Reconstructing the rest from ids would be a second
model of tmux's state kept in step by hand, which is the reconciler ADR 0006
declined to port.

`%unlinked-window-close` is treated as a close. tmux unlinks a Window from its
Session *before* killing it, so the Window that just vanished from under the
user arrives unlinked — ignoring it leaves a dead Window in the picker.

Windows now carry `#{window_id}`, without which no notification could be applied
to the Window it is about.

**"Opening a picker issues no command" is met for the rows and not for the
rest, and cannot be.** Two things no notification carries:

- **Previews.** They are screen content. A picture of a Pane is worth nothing
  unless it is of now, and tmux pushes nothing that would keep one current.
- **What a Pane is running.** `#{pane_current_command}` and
  `#{pane_current_path}` change with no notification at all — nothing is pushed
  when a shell starts `vim` — and they are what the Windows sheet's detail line
  and the Panes sheet's title are drawn from. The polled design re-read the
  Topology on *output* for exactly this reason; dropping that without replacing
  it would have frozen those fields at the last time the Topology changed
  shape. `refreshBehindSheet` is where it went.

So the sheet opens filled, from the model, with nothing to wait for — which is
what the ticket was actually after — and corrects itself a round trip later.
The Sessions list is the same story: no notification describes it, so it is
re-read on `%sessions-changed`.
