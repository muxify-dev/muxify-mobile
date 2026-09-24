# 03 — Make Attach a module the screen views

**What to build:** the Terminal Screen becomes a view over an Attach module.
Attach connects, checks the key, waits for a settled grid, opens the Control
Connection, sizes first, applies Zoom and reads the Topology in that order every
time. The Dock and pickers call verbs on it; it re-applies the Zoom preference
and refreshes the Topology after each one itself. Leaving the screen calls one
`close()` and nothing fires afterwards. From the phone nothing looks different;
from the code the screen holds no Connection, Control Connection, Client or
store.

**Blocked by:** 01, 02

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

Opened with a Host record, a Session name, the host store, the transport
factory, the Zoom preference and a clock; creates its own Client sizing module
and keeps the registry of Pane views because it routes `%output`. Exposes a
state subscription (phase, key verdict, attached Session name, Topology,
Sessions, last quiet trouble), the verbs (switch Session, select Window, select
Pane, split, new Window, set Zoom, capture previews), per-Pane hooks for the
views, the facts the screen feeds it, and `close()`. The Topology store
refreshes itself when a notification marks it stale. The Session name is held
once. The module is named after the verb CONTEXT.md already has.

- [x] The Terminal Screen has no `useRef` to a Connection, Control Connection,
      Client or Topology store, no `disposed` ref and no `background()` sink;
      it subscribes to the Attach and renders
- [x] A unit test with the fake transport asserts the Attach order: connect,
      key verdict, settled grid, Control Connection open, size, Zoom, Topology,
      Session list
- [x] A unit test asserts the phases published at each step, and that a
      refused Attach ends in a failed phase carrying the reason
- [x] Unit tests assert Zoom is re-applied and the Topology refreshed after
      select Pane, select Window, switch Session and split, and that switching
      Session re-sizes and stamps the Recent Session
- [x] A unit test asserts a failed command nobody waited on becomes the quiet
      trouble line, and that a Pane tap activates optimistically and rolls back
      on refusal
- [x] A unit test asserts that after `close()` no subscriber is called and no
      command is written, however many awaits were in flight
- [x] The Topology store's tests gain a case that a stale notification
      triggers a refresh with no caller involvement; `'stale'` is no longer
      part of its interface
- [~] The existing device suites (attach, pickers, regressions) pass unchanged
