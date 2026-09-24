# 01 — Size the Client from one module

**What to build:** the Client is sized by one module that is told facts and
decides on its own what `refresh-client -C` to send and when. From the phone
the behaviour is what it is today, minus the failure modes: the Window arrives
at the Surface's size on the first paint, a split keeps its proportions because
the pre-layout 32×11 grid never reaches tmux, the keyboard animation costs the
Host one or two resizes, and closing a sheet or switching Session re-sizes the
Client without anyone calling `reset()`.

**Blocked by:** None (can start immediately)

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

The module takes the thing that sends a size and an injectable clock, and is
told: a Surface spanning the Window reported a grid; the container was laid out
to a size in points; a sheet closed; the Session switched; the Attach is up and
wants its first size. It exposes a way to wait for the first settled grid. The
settle before Attach, the debounce on every resize, the cell metric, the split
grid from the container, the one-in-flight coalescing and the force-resend
cases are all implementation. The resize scheduler becomes part of it and its
`reset()` stops being anything a caller sees.

- [x] The Terminal Screen holds no grid, cell, settle timer, `reportedGrid`,
      `hasStarted` or `sheetWasOpen` ref; every size fact is forwarded to the
      module and nothing else decides a size
- [x] Both 80 ms timers and the twelve-try settle live inside the module, and
      the settle helper is no longer imported by the screen
- [x] A unit test replays the measured pre-layout grid (32×11 then 49×41 within
      a few milliseconds) and asserts only 49×41 was sent
- [x] A unit test replays a keyboard animation's stream of grids and asserts at
      most one size in flight and only the newest behind it
- [x] Unit tests assert that a sheet close, a Session switch and Attach each
      re-send the current size even when it has not changed, and that an
      ordinary duplicate is skipped
- [x] A unit test asserts a refused resize does not wedge the next one
- [x] A unit test asserts the split case: no spanning Surface, a remembered
      cell metric, a container size, and the grid sent is the container's
- [x] The placeholder Surface mounted only to report a grid is retired, or its
      continued existence is the module's decision and documented in its
      docblock
- [~] The device regression script still shows the Surface grid equal to the
      tmux Window grid with the keyboard down and up
