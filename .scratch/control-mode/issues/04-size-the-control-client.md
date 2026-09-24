# 04 — Size the control client

**What to build:** the Surface's grid reaches tmux again. Changing the font size
resizes the Window to fit the phone, as it does today — but through
`refresh-client -C <cols>x<rows>` on the Control Connection rather than a PTY
resize, and with no `window-size` option touched.

**Blocked by:** 03

**Status:** done

Measured: an unsized control client does not drag the Window at all — one
reporting 80 columns sat on a 120x40 Window and left it there. Sizing is opt-in
and takes effect only when `refresh-client -C` asks, which also means Muxify
must ask, or the Window never matches the phone.

This retires the PTY-size path and the race that went with it: there is no
`newestClient()` to lose, because the Control Connection is the client.

- [x] Changing the font size moves the Window to the new grid
- [x] The Window is correct on the first paint after Attach, not one change late
- [x] No Session option is set to make it happen
- [x] The dotted padding that `window-size smallest` existed to prevent is gone

## Comments

`refresh-client -C <cols>x<rows>`, through the same resize scheduler as before.

The tty wait is gone with the tty: `newestClient`, `knownClientTty`,
`TTY_WAIT_MS` and the `stty` command all go, because the Control Connection *is*
the Client. That was the race the scheduler had to work around, and it no longer
exists.

Measured on tmux 3.7c: an unsized control client left an 80x24 Window alone;
`refresh-client -C 40x20` moved it to 40x20 and pushed `%layout-change`.
`show-options` before and after was identical.

One thing worth knowing for anyone reading `#{client_width}`: a control client
reports a width and an *empty* height. There is nothing to read back and compare
against, which is the same conclusion the old pty path reached by a different
route.
