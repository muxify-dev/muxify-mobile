# 05 — Say why the Connection ended, and offer to try again

**What to build:** when a Connection ends, the Terminal Screen says which kind
of ending it was and, where trying again makes sense, offers a Reconnect action.
Killing the tmux server on the Host reads "Session ended" with no offer to
reconnect; pulling the network reads "Transport lost" with one; a wrong password
reads "Auth failed" with none. Reconnecting by hand replaces the Connection
under the same Attach: to the screen it is a phase change, not a new screen.

**Blocked by:** 03, 04

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

The Attach's phase becomes one of connecting, connected, restoring,
reconnecting, disconnected with a reason, closed. The reason carries a kind:
transport lost, Host unreachable, authentication, Host key, tmux unavailable,
Session ended on the Host, user closed, unknown. Only transport lost allows an
automatic reconnect later; this ticket adds the classification and the manual
path. A reconnect is a replacement: the SSH Connection, Control Connection,
Client and Topology store are closed and remade; the Pane views are re-created
and resynced; the last stable grid sizes the new Client; the Zoom preference is
re-applied. The transport seam gains one question, whether the control channel
is still open, answered by the SSH adapter from the library's connected and
open flags and by the local adapter from whether the child is alive.

- [x] A unit test classifies each ending into its kind from what the transport
      and tmux report: SSH disconnected event, channel closed with `%exit`,
      Session killed, authentication failure, Host key refused, tmux not found,
      user close
- [x] A unit test asserts a manual reconnect closes everything old before
      opening anything new, ends connected, is sized from the last stable
      grid and has Zoom re-applied
- [x] A unit test asserts no phase or callback from the replaced Connection
      reaches a subscriber after the replacement began
- [x] The real-tmux harness asserts a killed Session ends in "Session ended"
      and a killed child process ends in "transport lost"
- [~] The Terminal Screen shows the reason's short label and, for transport
      lost only, a Reconnect action that works on the device
- [x] The transport interface's liveness question has a test in each adapter
