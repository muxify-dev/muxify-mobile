# 04 — Size the control client

**What to build:** the Surface's grid reaches tmux again. Changing the font size
resizes the Window to fit the phone, as it does today — but through
`refresh-client -C <cols>x<rows>` on the Control Connection rather than a PTY
resize, and with no `window-size` option touched.

**Blocked by:** 03

**Status:** ready-for-agent

Measured: an unsized control client does not drag the Window at all — one
reporting 80 columns sat on a 120x40 Window and left it there. Sizing is opt-in
and takes effect only when `refresh-client -C` asks, which also means Muxify
must ask, or the Window never matches the phone.

This retires the PTY-size path and the race that went with it: there is no
`newestClient()` to lose, because the Control Connection is the client.

- [ ] Changing the font size moves the Window to the new grid
- [ ] The Window is correct on the first paint after Attach, not one change late
- [ ] No Session option is set to make it happen
- [ ] The dotted padding that `window-size smallest` existed to prevent is gone
