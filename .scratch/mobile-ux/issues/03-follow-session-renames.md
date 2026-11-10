# Follow the attached Session after a Topic rename

Status: resolved

Renaming a Topic also renames its live Sessions on the Mac. The phone drops
the tmux rename event and keeps the old Session name. A later Topology read
uses that missing name and removes the program and Pane from its result.

## Comments

The normal simulator window reproduces this after a CLI Topic rename and a
Title Sheet read. Before the rename the Header shows `zsh`. Afterwards the
Topic title is `Short`, the Session name is still the old name, and the
program is absent. See `/tmp/muxify-impl-handoff.Sc0532/rename-normal-red.log`.

The isolated tmux trace in `rename-protocol.log` in the same folder shows
`%session-renamed $1 sibling-renamed` and `%session-renamed $0 current-renamed`.
The event includes an ID and reaches Clients on other Sessions. The Attach
must match its current Session ID before changing its name. A rename must
preserve the Topic, Pane and Surface, and update Last Place.

## Answer

The Attach now keeps the current tmux Session ID for its live Connection.
Rename events update its display name and Last Place only when the ID matches.
Current Session commands use that ID. A Topology read cannot publish after
its target changes. Reconnect acquires a new ID instead of retaining the old
one. A rename while disconnected is not observed.

The focused tests passed 136 checks after 13 regression failures before the
fix. The full mobile suite passed 1,086 tests and TypeScript passed. The live
probe in `/tmp/muxify-impl-handoff.Sc0532/rename-runtime-green.log` verified
CLI rename and Edit Topic Save, the same Pane, a retained program, typed input,
New Window, Last Place and an ignored sibling rename.
