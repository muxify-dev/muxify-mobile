# 06 — Hold the Attach at the root, so Home keeps it

**What to build:** tapping Home goes to the Hosts list and leaves the Session
attached. The Host Screen's row for that Session shows its phase and a
Disconnect action; tapping the row returns to the Terminal Screen as it is,
repainted from a fresh capture, with no Connecting phase in between. Opening a
different Session, on this Host or another, closes the attached one first.
Disconnect ends it on purpose and it does not come back on its own.

**Blocked by:** 03, 05

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

The root holds one Attach. The Terminal Screen subscribes on mount and
unsubscribes on unmount and starts and stops nothing; if it mounts with no
current Attach or one for a different Session it asks the root to open one.
Home is navigation. The Pane views lose their Surfaces when the screen
unmounts and regain new ones when it mounts, which resyncs them (ticket 02).
The Hosts list marks the Host with the attached Session. This is the one place
Muxify deliberately does less than `remux`, which holds several: one Attach at a
time, shaped so a collection could replace the slot later.

- [~] Home, then the Host Screen, then the attached Session's row returns to a
      connected Terminal Screen; on the device the status never shows
      Connecting on the way back, and the Host received no new SSH connection
      (checked with `who` or the sshd log on the dev Host)
- [~] The attached Session's row on the Host Screen shows Connected, and
      Disconnect on it ends the Connection as user-closed; a unit test asserts
      user-closed never reconnects
- [x] Opening another Session while one is attached closes the current Attach
      as user-closed first; a unit test of the root holder asserts the order
- [x] Tapping the attached Session's row opens nothing new; a unit test of the
      root holder asserts it
- [x] The Hosts list marks the Host whose Session is attached
- [x] Returning to the Terminal Screen repaints every Pane from a fresh
      capture; the Attach's tests assert a Surface regained triggers a resync
- [~] Sessions attached and then left alone for the length of a device test
      still respond to typing on return
