# 07 — Keep the Session through the background, and restore it once

**What to build:** switching to another app and back finds the Session as it
was. If the link died while Muxify was suspended, coming back shows "Restoring"
and the Session is back without a tap. If the link drops while the app is on
screen, it shows "Reconnecting" and comes back once. Neither is tried twice
without a connected phase in between; a failed attempt leaves the reason and
the Reconnect action from ticket 05. Background costs the Host nothing: no
polling, no drawing, no keepalive beyond the SSH library's own.

**Blocked by:** 05, 06

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

The root forwards React Native's app-state changes to the Attach as a fact:
active, inactive, background. The Attach decides what each means, copying
`remux`: on background, cancel in-flight preview and Session-list reads and
stop writing to Surfaces; on active, ask the transport whether the control
channel is still open, carry on if it is, otherwise move to restoring and
replace once; if already disconnected on return, treat that as the same
foreground opportunity; on a closed channel or SSH disconnect while active,
move to reconnecting and replace once. Automatic attempts are recorded per
source (foreground, transport loss) and the record clears on connected. Only
the transport-lost kind reconnects automatically.

- [x] Unit tests with the fake transport: background changes nothing on the
      wire; active with a live channel changes nothing; active with a dead
      channel moves to restoring, replaces once and ends connected; a second
      dead foreground before a connected phase is skipped and stays
      disconnected; transport loss while active moves to reconnecting once; a
      reason other than transport lost never reconnects; user-closed never
      reconnects
- [x] A unit test asserts the record of attempted sources clears on connected,
      so a later loss is retried again
- [x] A unit test asserts no preview or Session-list read is started while in
      the background and nothing is written to a Surface
- [x] The real-tmux harness kills the child process, forwards active, and
      observes restoring then connected with a new child
- [~] On the device, backgrounding for a few seconds and returning shows
      Connected with no Restoring phase; the status labels are Connecting,
      Restoring, Reconnecting, Connected and the reason's short label, as
      `remux` has them
- [x] CONTEXT.md's Connection entry no longer says it is torn down when the
      Terminal Screen is left; it says what holds it and what ends it, and
      Attach says it is what the app holds
