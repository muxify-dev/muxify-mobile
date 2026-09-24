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

---

## The Accessory Bar covers the Dock, not just duplicates it (ticket 07)

ADR 0003 predicted the library's Accessory Bar would make a custom modifier-key
group redundant. The reality is sharper: the Accessory Bar is an **input
accessory view**, so whenever the Surface is focused it sits at the bottom of
the screen above everything else — **directly on top of the Dock**.

Found the hard way. Pressing the Dock's Home button landed on the Accessory
Bar's alt key and armed a modifier instead of navigating; the next press hit
cmd. The Dock was unusable exactly when the terminal was in use.

**Fix:** lift the Dock by the keyboard frame height. iOS reports the accessory
bar as part of that frame, so one `keyboardWillChangeFrame` listener covers
both. The Dock now renders above the Accessory Bar and both are usable.

**Consequence for tickets 08 and 09:** the Session, Window and Pane pickers live
in this same Dock, so they inherit the lift. Anyone adding a floating control to
the Terminal Screen has to account for the Accessory Bar, and cannot simply pin
to the bottom safe area.

## Liquid Glass works, and the merge behaviour is real (ticket 07)

`Host` + `Namespace` + `GlassEffectContainer` + `glassEffect()` +
`glassEffectId()` renders as documented on iOS 26.5, and adjacent buttons
visibly blend into a single merged capsule as the container spacing brings them
together. `buttonStyle('glass')` and a `frame` modifier were both needed: without
an explicit frame the buttons collapse to near-invisible dots.

`isGlassEffectAPIAvailable()` returned true and no fallback was exercised, so
the non-glass path remains unverified code.

## Resize forwarding is proven after all (ticket 05)

Earlier this could not be demonstrated — the app is orientation-locked and the
keyboard overlays rather than resizes. Putting the Dock into layout flow beneath
the Surface produced a genuine second grid, and it propagated: the Surface went
38x32 -> 38x30 and `tmux list-clients` reported `[38x30 xterm-256color]`.
Focusing the Surface shrank it further to 38x27 and tmux reflowed again.

## The keyboard toggle needed a patch to the terminal library (ticket 07)

The Dock's keyboard button initially did nothing at all, and an earlier version
of this log wrongly recorded it as working — that claim was reasoned about, not
verified.

**Cause.** `Keyboard.dismiss()` blurs whatever React Native's own
`TextInputState` registry believes is focused. The Surface is a native
`UITextInput` that `expo-libghostty` makes first responder on its own, so RN
holds no record of it and there is nothing for `dismiss()` to blur. Any RN API
that works through that registry has the same blind spot.

A focus trap — a zero-sized RN `TextInput` focused then blurred to steal first
responder — dismissed the keyboard, but could never raise it, and nothing in the
library's four-call API could either.

**Fix: patch the library.** The capability was already there and simply not
exposed. The vendored `UITerminalView` overrides `canBecomeFirstResponder`,
`becomeFirstResponder()` and `resignFirstResponder()`, and the latter two also
tell ghostty's core about focus. The patch adds three `AsyncFunction`s to the
Expo module — `focus`, `blur`, `isFocused` — wires them into the imperative ref,
and extends the TypeScript types. About 115 lines, held in
`patches/expo-libghostty.patch` and hash-pinned in the lockfile.

Verified by toggling three times: accessory-bar buttons in the accessibility
tree went 0 to 5 to 0 to 5, and the terminal reflowed each way.

**This is a good upstream contribution.** The library's stated contract is that
the view "only renders bytes and reports input/resizes", but keyboard control is
not transport — it is view state, and every consumer embedding this view in a
real app will hit the same wall. Worth filing upstream, with the caveat that the
project has had no functional commit since 2026-07-17.

**Cost of carrying a patch:** any version bump has to reapply it, and a native
change means a full prebuild and rebuild, not a Metro reload.

## Simulator gotcha: "Connect Hardware Keyboard" hides the on-screen keys

Cost real time, so worth recording. With **I/O > Keyboard > Connect Hardware
Keyboard** checked (Shift-Cmd-K, and it is on by default), iOS routes input from
the Mac keyboard and suppresses the on-screen keyboard — but still shows the
Surface's Accessory Bar. The symptom is a terminal that gains first responder,
shows ctrl/esc/tab, and never shows letters, which looks exactly like a broken
focus implementation.

It is not: `becomeFirstResponder()` was working the whole time. Turning the
setting off produced 26 letter keys immediately.

Set it per-device rather than globally, with the device shut down so the
Simulator cannot overwrite the preference on quit:

    DevicePreferences:<UDID>:ConnectHardwareKeyboard = false

Diagnostic that separates the two cases: count nodes matching `[key] "<letter>"`
in the accessibility tree. Accessory-bar buttons present with zero letter keys
means the hardware keyboard is connected, not that focus failed.

## agent-device cannot press the on-screen return key (tickets 04-07)

Letter keys type fine through `agent-device type`. Return never reaches the app,
by any route tried:

- `press @ref` on the `return` button lands on a neighbouring key — every
  keyboard ref resolved to the same wrong coordinate, and pressing `return`
  and `delete` both produced `g`.
- `press <x> <y>` at the centre of return's own reported rect (350, 779)
  reports a successful tap and does nothing.
- A newline or a carriage return passed to `type` is counted as a typed
  character and inserts a line break in the display, but never submits.

Keyboard keys live in a separate iOS window, which is the likely cause; the
agent-device workflow guide documents a related class of accessibility gap.
The app itself is fine — confirmed by hand with a real keyboard.

**Workaround, in `e2e/ls-round-trip.sh` (`pnpm e2e:roundtrip`):** type the
command on the device, then submit it out of band with `tmux send-keys Enter`
and read the pane over SSH. This is not a weaker test than pressing return
would be — the characters must genuinely have reached the remote shell's input
buffer for an out-of-band Enter to run the right command, and the rendered
output is then read from the Session rather than from the app's chrome.

Verified round trip: `ls` typed on the device, `PROOF_ls_WORKS.txt` rendered
back in the Surface, shell returned to a prompt.

**Consequence for ticket 08 onward:** any e2e that needs to submit a command has
to use this split. Pickers driven by Dock buttons are unaffected — those press
fine.

---

## The SSH library does not send window-change, and it broke three things

**The most consequential bug found so far.** `@osuki-dev/react-native-ssh`'s
`shell.resize()` does not reliably send the SSH window-change request, so the
remote terminal keeps a stale size.

Isolated with a debug button that called `shell.resize(24, 9)` and nothing else:
the remote stayed at 38x30. Not a timing problem — it never arrived, across 20
seconds and a subsequent keystroke. Instrumenting the app showed the Surface
grid and the size handed to the transport always agreed, so the app was correct
throughout; what the remote had was consistently one resize behind.

Three user-visible symptoms, all the same cause, because tmux draws for the size
it believes it has and rows outside the Surface's real grid are never shown:

- keyboard opens: the remote still thinks it is tall, so the prompt is drawn
  below the visible rows and **the path line disappears**
- keyboard closes: the remote still thinks it is short, so the **status line is
  stranded mid-screen** with dead space beneath
- a command appears to **produce no output** — it ran, and the output was drawn
  where the Surface could not show it

That last one is worth dwelling on. It presented as "Enter is broken", and a
lot of time went into the input path before the evidence pointed at output. The
keystrokes were fine the whole time.

**Fix:** stop relying on the channel and drive the size through tmux itself —
`set-option window-size manual` once, then `resize-window -x W -y H` on every
grid change, over the exec channel that is already reliable. Verified: the tmux
*window* size now tracks the Surface exactly in both directions, 38x30 to 38x14
and back. The *client* size still lags, which no longer matters.

The Rust core ships prebuilt in an xcframework, so unlike expo-libghostty this
one cannot be patched locally. Worth an upstream report.

## Hiding tmux's status line, and why remux never had to

Asked for the status line to be hidden, and remux is the reference. remux does
nothing at all: it drives tmux in **control mode**, where the client renders
nothing itself and tmux streams pane content, so no status line ever exists.

Muxify attaches a real client (ADR 0001), so tmux draws its full chrome. Hiding
it therefore needs an explicit `set-option status off`. Because `status` is a
session option, that is visible to every other client of the Session and would
outlive the Connection — so the original value is read on attach and restored on
teardown, leaving the Host as it was found.

This is a small, concrete cost of the ADR 0001 decision: every piece of tmux
chrome that control mode would simply never render has to be turned off by hand,
and each one mutates a Session that may be shared.

## The resize is one behind, and the leftovers are what you see

Reported as: "sometimes when I open/close the keyboard, tmux resize flicks —
for a moment I see dots of resizing the tmux screen."

Two things turned out to be true, and only the second one causes the dots.

**The SSH library's resize is not dead, it is one behind.** The earlier finding
above says the window-change request never lands. Measuring the Client size
across a keyboard cycle shows something more specific:

```
attached        surface=38x32   window=38x32   client=38x34
keyboard up     surface=38x16   window=38x16   client=38x32
keyboard down   surface=38x32   window=38x32   client=38x16
```

The Client is always the *previous* Surface size — a resize call appears to send
the one before it. Calling `resize()` twice in the same tick does not flush it;
neither does a duplicate 300ms later (it moved one sample and not the next), nor
a keystroke, nor waiting. `refresh-client -C`, which sets a Client's size
directly, is control-mode only and silently does nothing for an attached Client
(verified against tmux 3.6). So this stays worked around, not fixed.

**The dots are debris, not a live mismatch.** tmux pads the rows between the
Window and the Client with `·` whenever the Window is the smaller of the two.
Forcing `window=38x8` against `client=38x16` reproduces it exactly: eight rows
of content, a separator, then eight rows of dots.

That gives the mechanism. The keyboard opens, the Window shrinks, and tmux pads
the rows below it — rows that are off the bottom of the now-short Surface, so
they are painted where nobody can see them. The keyboard closes, the Surface
grows, and those already-painted rows scroll into view. tmux will not clean them
up, because it believes the Client is still the old size and those rows are not
its to draw. The dots then sit there until something forces a full redraw.

Worth stressing: at the moment the dots are visible the geometry is already
correct. A screenshot showing a screen full of dots had `surface == window`.
Chasing the sizes further would have found nothing.

**Fix, in two parts:**

1. `refresh-client` after every size change, aimed at our own Client. This is
   what actually clears the debris — verified by forcing a dirty screen and
   watching a bare `refresh-client` wipe it. Our Client is found by taking the
   newest from `list-clients` straight after attaching, because a Session may
   have others and a redraw aimed at the wrong one leaves this Surface dirty.
2. Coalesce the resizes. The Surface reports a new grid on every frame of the
   keyboard animation and each one used to become its own pair of Control
   Commands, landing out of order. Now at most one is in flight with only the
   newest queued behind it, and `window-size manual` is sent once per Session
   rather than on every resize.

The coalescing deliberately has no timer: the first request of a burst goes
immediately, because a *late* resize is exactly what shows the padding, and the
round trip is the debounce window. A slow Host coalesces harder, a fast one
barely at all, and neither needs a tuned delay.

Measured after: `surface == window` in both directions and zero dots left on the
pane across a full keyboard cycle. `dots` is now a column in `scripts/dev-loop.sh`
so a regression shows up without a screenshot.

## Removing the navigation header (user request)

The Terminal Screen now draws no navigation header: the Surface background runs
to the top of the display and a safe-area inset keeps it clear of the status
bar. The back button was redundant — the Dock's Home button already leaves the
screen, and tears the Connection down with it.

Worth 2 rows: the Surface went from 38x30 to 38x32 on this device. On a phone
that is real estate, and it is the kind of thing a terminal app should spend
chrome on carefully.

One e2e consequence: both `.ad` suites waited on the header title "Terminal" to
know the screen was up. That signal is gone, so they now wait on the
`connection-status` indicator instead — which is a better signal anyway, since
it belongs to the screen rather than to the navigator.

## Nothing inside a presented sheet responds to agent-device (ticket 08)

The Session picker is an `@expo/ui` `BottomSheet`. It renders correctly and
re-renders from React state, so the JS to native direction is fine. Native back
to JS is where it stops: no `onPress` inside the sheet ever fired.

Ruled out, in this order, each with a relaunch and a probe rendered into the
sheet's own title so the result was readable while the sheet was up:

- a Button nested in `List` / `Section` — no
- a plain Button directly in the sheet, outside any list — no
- the host being zero-sized, 1x1, or full-screen — no difference
- the documented `anchor` pattern — the anchor Button, which sits outside the
  sheet, fired immediately; the same Button inside the sheet did not
- pressing by ref versus by measured screen coordinates — no difference

The telling detail: iOS's own drag indicator does not respond either, and
swipe-to-dismiss does nothing. A system gesture failing is not an app bug.

`hittable: false` on every node in the sheet looked like the answer, but it is a
red herring — the Dock's Buttons report `hittable: false` too and press fine.

**Resolution: the sheet works.** Confirmed by hand on the simulator, where rows
select and the sheet dismisses normally. This is agent-device unable to reach a
presented sheet, the same class of limitation as the on-screen return key
(above), and the second time this project has had to check a harness failure
against a real finger before believing it.

Worth stating plainly, because it nearly cost the design: the automation said
the component was broken, and the component was fine. An e2e harness that
cannot reach a UI is evidence about the harness.

What this costs: `e2e/session-picker.ad` can assert the Dock button, the sheet
opening, and the attached Session being marked, but not selection. Selection is
covered below the UI instead, which is where the interesting logic is anyway —
see the next finding.

## Switching Session means preparing it all over again (ticket 08)

A Session that has just been switched to has never been touched by Muxify: its
Window is sized for whatever last attached to it, and its status line is on. So
everything done on Attach has to run again on every switch — which makes it a
thing worth naming, `createSessionPreparer`, rather than code sitting inline in
the screen.

Two traps, both now covered by tests:

- **Reading the original status line every time destroys it.** Switch away and
  back, and the value read the second time is `off`, which Muxify itself set. It
  is the first reading that has to be kept.
- **Restoring only the last Session leaves the others changed.** A visit that
  touches three Sessions owes three Sessions their status line back.

Both are consequences of ADR 0001 rather than accidents: a real client sees real
session options, where control mode would have rendered no chrome to hide.
