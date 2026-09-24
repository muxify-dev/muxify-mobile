# Findings log

Running notes for ticket 14. Appended as the build proceeds, while the detail is
still fresh.

---

## pnpm blocks the terminal library's framework download (ticket 03)

**Predicted, confirmed, resolved.** `expo-libghostty` fetches a
`GhosttyKit.xcframework` (~127MB unpacked) in a postinstall script, and pnpm
blocks dependency build scripts by default. Adding the package to `allowBuilds` in
`pnpm-workspace.yaml` was sufficient; the download then ran and all four pods
(`ExpoLibghostty`, `GhosttyKit`, `GhosttyTerminal`, `MSDisplayLink`) linked on
the first `pod install`.

Cost: one config block. Would have been an opaque "missing framework" build
failure without it.

## The published version really is behind master (ticket 03)

Confirmed by reading the installed `.d.ts`: `0.8.1` ships `fontSize`, `theme`,
`onInput`, `onResize`, `ref`, `style` and the three ref methods — and **not**
`onBell`, `onTitleChange` or `onDirectoryChange`, which exist only on master.
Pinning to the published release costs us the window title, which tmux sets
per Window and which would have been useful in the Window picker.

## `onResize` fires more than once, and the first one lies (ticket 03)

The smoke screen writes its canned output on the **first** `onResize` and shows
the **latest** size in a status overlay. They disagree: the canned text records
a `32 x 11` grid while the overlay settles at `38 x 32`. The first event is a
pre-layout measurement.

**Consequence for ticket 05:** the remote terminal must never be sized from the
first `onResize`. Size it from the latest, and keep forwarding every subsequent
event — a PTY opened at 32x11 against a screen that is really 38x32 would draw
full-screen programs wrong and only self-correct if resizes are forwarded.

Fixed in the smoke screen by redrawing on every resize rather than only the
first, which is also the behaviour ticket 05 needs. Caught by code review: the
original wrote once and left a stale grid size on screen.

## The Surface itself is solid (ticket 03)

No caveats found. On an iOS 26.5 simulator it rendered the full ANSI colour
range (normal and bright), bold, dim, italic, underline and reverse, absolute
cursor addressing, and multi-byte UTF-8 including CJK and block-drawing
characters. The library's Accessory Bar appears as documented. Build was clean
on the first attempt with zero errors under Xcode 26.6.

One correction to an earlier version of this note: multi-byte rendering was
first demonstrated through `writeText()`, which is *not* the path tickets 04 and
05 use. Code review caught that the riskiest claim rested on the wrong API. The
smoke screen now sends everything — CJK included — through
`write(base64)` over a hand-rolled UTF-8 encoder, so the byte path is what is
actually proven. `TextEncoder` was avoided as it is not guaranteed on Hermes.

## The Surface is opaque to accessibility, so e2e cannot assert its contents (ticket 03)

ghostty renders terminal cells with Metal. The accessibility tree exposes the
Surface as a bare `TextView` with a rect and **no text**, so `agent-device` (or
any XCUITest-based runner) can see that the terminal exists but not what it
displays. `get attrs` on the node returns geometry only.

**Consequence:** end-to-end tests can assert navigation, layout and that the
Surface came up — a `surface-grid` overlay was added as a durable testID,
rendered only after `onResize`, precisely so there is something assertable —
but verifying that tmux actually drew the right thing requires screenshot
comparison, not selectors. Worth knowing before anyone plans e2e coverage of
Session, Window or Pane switching: the pickers will be assertable, the terminal
content will not.

The e2e flow itself lives at `e2e/surface-smoke.ad` and runs with `pnpm e2e`.

---

## The stack works: real tmux on a phone (tickets 04 and 05)

**This is the probe's headline result.** `@osuki-dev/react-native-ssh` 0.3.0 and
`expo-libghostty` 0.8.1 compose without friction. A Connection authenticates,
a Shell Channel attaches to a tmux Session, and tmux's own status bar renders
in the Surface on an iOS 26.5 simulator.

The two APIs line up one-to-one with no adapter layer:

    onData(ArrayBuffer) -> bytesToBase64 -> surface.write(base64)
    onInput.data (base64) -> base64ToBytes -> shell.write(bytes)
    onResize({cols,rows})  -> shell.resize(cols, rows)

Nothing had to be worked around. That was the question this project existed to
answer, and the answer is yes.

Two details worth keeping:

- **`openShell` takes a `command`.** Attaching needs no typing and no login
  shell — the Shell Channel runs `tmux attach-session -t <name>` directly. This
  is also why attach-only was cheap to honour: `new-session -A` never appears.
- **Connections really are cheap to drop.** After leaving the Terminal Screen
  and returning, `tmux list-clients` showed exactly one client at
  `[38x32 xterm-256color]` — the old one gone, the new one attached at the
  Surface's actual grid. The ephemeral-Connection decision holds up.

## Reaching an OrbStack VM from the Simulator (ticket 04)

`ssh orb` uses a ProxyCommand (an OrbStack helper doing fd-passing), which an
in-app SSH client cannot use. But OrbStack also runs a plain TCP listener on the
Mac's loopback — `127.0.0.1:32222` — and the iOS Simulator shares the host
network stack, so the app reaches it directly with no tunnel or config. Log in
as `default`; it lands as the VM's own user.

The VM's own address (`172.30.31.83:22`) is **not** reachable and is a dead end.

## What could not be verified on this device

- **Resize forwarding is wired but unproven.** `handleResize` calls
  `shell.resize`, and the correct 38x32 reached tmux — but no *second* distinct
  grid could be produced on this device: the app is `orientation: portrait` in
  `app.json` so rotation is refused, and the iOS keyboard overlays the Surface
  rather than resizing it (the grid stayed 38x32 with the keyboard up). Proving
  a live reflow needs either unlocking rotation or a font-size change.
- **Physical device.** Everything so far is simulator-only.

## Automating the Surface: what works and what does not (tickets 03-05)

`agent-device` drives the app well through the accessibility tree — navigation,
`testID` selectors, screenshots, rotation. Two limits hit in practice:

- **Terminal contents are invisible** (see the earlier note): assertions can
  reach the app's own chrome but never what tmux drew.
- **The iOS keyboard is not reliably tappable.** Keys appear as refs in a
  separate keyboard window, but pressing `@e41 "return"` and `@e37 "delete"`
  both landed on the `g` key — every press resolved to the same coordinate.
  Typing via `type` works; individual special keys do not. This matters for
  ticket 07, whose Dock keyboard toggle will need a different verification
  route than pressing keyboard keys.
