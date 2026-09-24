# Deepen the Terminal Screen: Attach, Client sizing and the Pane view

Status: ready-for-agent

Came out of an architecture review of the codebase on 16 September 2026, run
with one lens: crutches and workarounds. Nearly every timer, poll, sentinel and
ref-mirror in the app lives in one file, the Terminal Screen, and they cluster
under three root causes rather than being scattered one-offs. This spec takes
the three Strong candidates from that review as one piece of work, because they
are one thing: the Terminal Screen stops being where the Connection, the
Client's size and each Pane's readiness are worked out, and becomes a view over
modules that own them.

One more ask arrived with it and belongs to the same module. Today a Connection
is torn down the moment the Terminal Screen is left and re-established on
return. `remux`, the native app this project probes, does not do that: going
Home keeps the Session attached, backgrounding the app keeps it attached, and
coming back to the foreground checks whether the link survived and restores it
once, automatically, if it did not. Muxify copies that. It is only possible
once Attach is a module that something other than the screen can hold.

## Problem Statement

The Terminal Screen is two thousand lines and has been touched by 38 of the last
60 commits. Every change to how the app attaches, sizes or paints lands there,
and every one of them has had to be verified on a device, because the behaviour
it holds cannot be reached by a test.

What it holds, and why it is fragile:

- **The Client is sized from five places.** The scheduler that sends
  `refresh-client -C` owns the sending, but the deciding is spread across
  Attach, the whole-Window Surface's resize, the split-container effect, the
  sheet-close effect and the Session switch. Two of those call `reset()` to
  defeat the scheduler's own dedup. Two 80 ms timers sit above a module whose
  docblock says it needs no timer. A cell metric is measured once and kept in a
  ref because a split mounts nothing that spans the Window. A placeholder
  Surface is mounted before there is a Topology, only to act as a ruler.
- **Whether a Pane may be painted is worked out in the screen.** The Pane view
  is the deepest module in the repo, yet three parallel Maps keyed by Pane id, a
  250 ms timer and two effects decide when it may paint and whose cursor shows.
  A Surface that reports its grid before layout, a ref that arrives after the
  grid, and a library that will not accept writes for a moment after mounting
  are all handled by "whichever comes last paints, a little later".
- **The Connection lifecycle is a `start()` inside a component.** Twenty checks
  of a `disposed` ref, a `background()` sink for orphaned rejections, the
  Session name held twice, the Zoom preference re-applied at four call sites,
  and an Attach ordering ("size first, so the capture that follows is of a Pane
  the size of the Surface") held by a comment.
- **Because the Connection belongs to the screen, it dies with the screen.**
  Tapping Home closes the Control Connection and the SSH Connection; coming
  back is a full Attach: connect, key check, settle, attach, capture. Switching
  to another app for a moment is worse: iOS suspends Muxify, the socket may or
  may not survive, and nothing checks which. The user comes back to a Surface
  that looks connected and is not, or to one that was fine and did not need
  the "closed" banner it is showing.

The user sees this as blank Panes after a split, a Window that arrives eleven
rows tall and grows back with its splits redistributed, a keyboard toggle that
sometimes blurs the wrong Surface, a Zoom switch that says "on" after the
laptop unzoomed, and a round trip to the Host every time they glance at the
Host Screen. The developer sees it as a file nobody can change without a phone
in hand.

## Solution

Three modules, each deep, each testable through its interface without a device;
and the third one held by the app rather than by a screen:

1. **Client sizing.** One module is told facts (a Surface that spans the Window
   reported a grid, the container was laid out, a sheet closed, the Session
   switched, the Attach is up) and alone decides which size to send and when.
   The settle, the debounce, the rejection of the pre-layout grid, the cell
   metric, the split-container arithmetic, the one-in-flight coalescing and the
   force-resend cases all become implementation. The screen forwards events and
   keeps no grid, cell or timer of its own.
2. **The Pane view owns its Surface.** The view is handed its Surface, as an
   adapter with write, focus and blur, and told each grid that Surface reports.
   It decides when both halves are present and settled, paints once at the
   right size, repaints on a real grid change, and owns cursor visibility and
   keyboard focus for its Pane. The screen stops keeping registries of Surfaces
   and grids and stops scheduling paints.
3. **Attach is a module, and it outlives the Terminal Screen.** Opened with a
   Host and a Session name, it owns the SSH Connection, the trust-on-first-use
   verdict, the Control Connection, the Client, the Topology store, the Session
   name and the Zoom preference. It exposes the verbs the Dock and the pickers
   need, a subscription to its state, and one `close()` after which nothing
   fires. It is held at the app's root, not in the screen: going Home leaves it
   attached, backgrounding leaves it attached, and returning to the foreground
   asks it whether the link is still alive and restores it once if not. The
   Terminal Screen subscribes to whichever Attach is current and renders it;
   the Host Screen shows the attached Session as such and offers to disconnect
   it.

Done well, the Terminal Screen shrinks to layout, gesture wiring and chrome, and
the behaviour that used to need a phone runs under `pnpm test` with a fake
clock, or under `pnpm e2e:control` against a real tmux.

## User Stories

### Sizing

1. As a phone user, I want the Window to be the size of my Surface on the first
   paint after Attach, so that I never see a Window laid out for somebody else's
   Client.
2. As a phone user, I want a split Session to keep the proportions I set on the
   laptop when I open it on the phone, so that the Window never takes a trip
   through a size nobody asked for.
3. As a phone user, I want the Window to follow the keyboard as it rises and
   falls, so that no rows are hidden behind it and no rows are left blank.
4. As a phone user, I want a keyboard animation to cost the Host one or two
   resizes rather than thirty, so that a slow Host does not fall behind my
   gesture.
5. As a phone user, I want the Client re-sized the moment I close a sheet in
   which I split a Window, switched Window or Session, or turned Zoom off, so
   that the Panes behind the sheet are laid out for my phone and not for the
   last Client that spoke.
6. As a phone user, I want the Client sized correctly when a Window is not
   zoomed and no single Surface spans it, so that a split is laid out for the
   whole container and not for one Pane's share of it.
7. As a phone user, I want a Session I switch into to be sized for my phone
   immediately, so that I do not inherit the laptop's Window shape.
8. As a phone user, I want a resize the Host refused not to wedge every later
   one, so that a single failed command does not leave the Surface and the
   Window different shapes for the rest of the Session.
9. As a developer, I want every fact that can change the Client's size to enter
   one module, so that a sizing bug has one place to be.
10. As a developer, I want that module to take a clock I control, so that the
    settle and the debounce are asserted in a unit test rather than tuned on a
    device.
11. As a developer, I want the pre-layout grid the Surface reports (32×11 on a
    phone whose Window is 49×41) to be a test case rather than a comment, so
    that a library upgrade that changes the timing is caught by `pnpm test`.
12. As a developer, I want the resize scheduler's `reset()` to disappear from
    any interface a caller sees, so that no caller has to know the scheduler
    dedups in order to use it correctly.
13. As a developer, I want the cell metric to be an implementation detail of
    sizing, so that no screen code holds a measurement in a ref.
14. As a developer, I want Attach to wait on the sizing module for a settled
    grid rather than polling a ref, so that the placeholder ruler Surface and
    the `hasStarted` sentinel can go.

### Painting a Pane

15. As a phone user, I want every Pane of a split painted with what is already
    on it the moment it appears, so that no Pane sits blank until something
    moves in it.
16. As a phone user, I want a Pane that appears while its neighbour is on screen
    to paint just as reliably as the one that was there first, so that a split
    never produces one live half and one dead half.
17. As a phone user, I want a Pane painted at its laid-out size and never at the
    eleven-row grid the Surface reports before layout, so that the resync is
    not wrapped away to nothing.
18. As a phone user, I want exactly one cursor on screen, in the Pane the
    keyboard is in, so that a split does not show several places to type.
19. As a phone user, I want that cursor to stay hidden in an inactive Pane even
    when the application in it redraws and asks for it back, so that the rule
    holds beyond the first paint.
20. As a phone user, I want the keyboard toggle to raise or dismiss the keyboard
    on the Pane that actually has it, so that toggling never blurs a Surface
    that was not focused.
21. As a phone user, I want output that arrives during a resync to land after
    it, in order, so that the last second of a Pane's life is not painted under
    its own repaint.
22. As a phone user, I want a Pane that leaves the screen (a Window switch, a
    kill on the laptop) to release its Surface and stop receiving output, so
    that nothing is written to a view that is gone.
23. As a phone user, I want the Panes to be repainted from a fresh capture when
    I return to the Terminal Screen from Home, so that what I see is the Pane
    as it is now and not as it was when I left, without the Connection having
    been remade.
24. As a developer, I want the Pane view to be handed its Surface and told each
    grid the Surface reports, so that the ordering of ref and grid is the
    module's problem and not the caller's.
25. As a developer, I want a fake Surface in tests that records writes, focus
    and blur, so that "ref before grid", "grid before ref" and "pre-layout grid
    then real grid" are unit tests with the fake clock the Pane view already
    takes.
26. As a developer, I want the moment after mounting in which the library
    accepts no writes to be inside the Pane view, measured once and tested, so
    that the 250 ms constant has a test that fails when it is wrong.
27. As a developer, I want cursor visibility set from one place, so that the
    three sites that set it today collapse to one.
28. As a developer, I want the screen to hold no Map of Surfaces, views or
    grids, so that the Pane view is the only thing that knows a Pane is on
    screen.

### Attach

29. As a phone user, I want Attach to connect, check the Host's key, size the
    Client, attach the Control Connection, apply my Zoom preference and read the
    Topology in that order every time, so that the first capture is of a Pane
    the size of my Surface.
30. As a phone user, I want to be told why an Attach failed in tmux's own words
    ("no sessions", a bad tmux path), so that I know whether to fix the Host
    record or start a Session on the Host.
31. As a phone user, I want a changed Host key to warn me without blocking the
    Connection, so that a rebuilt machine is still reachable and the warning is
    still loud.
32. As a phone user, I want my Zoom preference to hold after I select a Pane,
    switch Window, switch Session or split, so that I never have to reach for
    the switch twice.
33. As a phone user, I want the Session I switch into to count as recently
    opened on the Host Screen, so that the order there records where I went and
    not only where I started.
34. As a phone user, I want a Pane I tap to become active immediately and to be
    put back if the Host refuses, so that the highlight follows my finger and
    never lies.
35. As a phone user, I want a command that nobody was waiting on (a Zoom
    toggle, a background Topology read) to show its failure as a quiet line
    rather than as a dead screen, so that a Pane that has just been killed does
    not take the Connection with it.
36. As a phone user, I want the Windows and Panes sheets to open filled from the
    Topology tmux has been pushing, so that a sheet never waits on a round
    trip.
37. As a phone user, I want a Window added on the laptop to appear in the
    Windows sheet without my closing and reopening it, so that the sheet
    follows the model while it is open.
38. As a developer, I want one object that owns the SSH Connection, the Control
    Connection, the Client, the Topology store and the Session name, so that
    the Session name exists once and the twenty `disposed` checks become one
    `close()`.
39. As a developer, I want that object to expose the verbs the Dock and pickers
    need (switch Session, select Window, select Pane, split, new Window, set
    Zoom) and to re-apply Zoom and refresh the Topology after them itself, so
    that the policy lives in one place.
40. As a developer, I want the Topology store to refresh itself when a
    notification marks it stale, so that no caller has to know what `'stale'`
    means.
41. As a developer, I want the whole Attach sequence to run under
    `pnpm e2e:control` against a real tmux through the transport seam the
    harness already fakes, so that a refused Attach, a Session switch, a
    `%layout-change` and a channel drop are asserted without a phone.
42. As a developer, I want a test that nothing fires after `close()`, so that
    the teardown contract is checked rather than described.
43. As a developer, I want the Terminal Screen to hold no `useRef` to a
    Connection, a Control Connection, a Client or a store, so that the screen is
    a view and the tests are elsewhere.
44. As an AI agent working in this repo, I want each of the three modules to
    have a docblock that states its interface's invariants, so that the next
    change is made against the interface and not by reading the screen.

### Staying attached: Home, background, foreground

45. As a phone user, I want tapping Home to take me to the Hosts list and leave
    the Session attached, so that coming back is instant and costs the Host
    nothing.
46. As a phone user, I want the Host Screen and the Hosts list to show which
    Session is attached and in what state (connecting, connected, restoring,
    reconnecting, disconnected and why), so that I know before I tap whether I
    am returning to something live.
47. As a phone user, I want tapping the attached Session on the Host Screen to
    return me to it as it is, so that I never re-Attach to something that is
    already attached.
48. As a phone user, I want a Disconnect action on the attached Session's row,
    so that I decide when the Connection ends rather than the navigation
    deciding for me.
49. As a phone user, I want opening a different Session, on this Host or
    another, to close the one that was attached and Attach the new one, so that
    there is only ever one Connection to account for.
50. As a phone user, I want switching to another app and back within a few
    seconds to find the Session exactly as I left it, so that reading a message
    does not cost me a reconnect.
51. As a phone user, I want Muxify to check, the moment it returns to the
    foreground, whether the link survived being suspended, so that a Surface
    that looks connected is connected.
52. As a phone user, I want a link that died while I was away to be restored
    automatically once, with a "Restoring" state while it happens, so that the
    common case after a long background costs me nothing.
53. As a phone user, I want a link that drops while I am looking at it to be
    reconnected automatically once, with a "Reconnecting" state, so that a
    Wi‑Fi handover does not end my Session.
54. As a phone user, I want an automatic reconnect that fails to leave me on a
    disconnected screen with the reason and a way to try again by hand, so
    that Muxify never loops against a Host that is refusing.
55. As a phone user, I want a disconnect I asked for, an authentication
    failure, a refused Host key or tmux ending the Session never to reconnect
    on their own, so that only a lost transport is retried.
56. As a phone user, I want the restored Session to arrive at my phone's size
    and with my Zoom preference, and to be painted from a fresh capture, so
    that a reconnect is indistinguishable from a good Attach.
57. As a phone user, I want a Session that the Host has since killed to show
    as disconnected with that reason after a restore attempt, so that I am not
    left with a blank screen and no explanation.
58. As a phone user, I want background time to cost the Host nothing extra: no
    keepalives beyond the SSH library's own, no polling, no drawing, so that a
    suspended Muxify is a Muxify the Host has forgotten about.
59. As a developer, I want the Attach to be held by the app's root and handed
    to the Terminal Screen by subscription, so that no screen's mount or
    unmount decides a Connection's life.
60. As a developer, I want the Attach to accept the app's lifecycle phase
    (active, inactive, background) as a fact, and to decide on its own what to
    do at each transition, so that the policy is one module's and testable
    with a fake transport.
61. As a developer, I want automatic reconnect to be attempted at most once
    per source (foreground, transport loss) until the next time the Session is
    connected, so that the retry policy is a rule and not an emergent loop.
62. As a developer, I want a reconnect to be a replacement, not a repair: a
    fresh SSH Connection, Control Connection, Client and Topology store, with
    the old ones closed first, so that no state from the dead link survives.
63. As a developer, I want the liveness check on foreground to go through the
    transport seam, so that the real-tmux harness can answer it with a dead
    process and the unit tests with a flag.
64. As a developer, I want CONTEXT.md's Connection entry and an ADR to record
    that a Connection is held by the app and not by a screen, so that a future
    architecture review does not propose tearing it down on unmount again.

## Implementation Decisions

### Order of work

Client sizing first, then the Pane view, then Attach as a module, then Attach
held at the root with the lifecycle policy. Sizing is self-contained and
retires the most timers; the Pane view is a deepening of a module that already
exists; Attach is the largest and is smaller for having the first two to lean
on; the lifecycle policy is a set of rules inside Attach that has nowhere to
live until Attach exists. Each lands on its own and leaves the app working.

### Client sizing

- A module created with the thing that sends a size (today the Client's
  `resizeClient`) and an injectable clock. It is told facts, each a method or an
  event: a Surface spanning the Window reported a grid; the container was laid
  out to a size in points; a sheet closed; the Session switched; the Attach is
  up and wants its first size. It exposes a way to wait for the first settled
  grid, which Attach uses in place of polling a ref.
- It decides, internally: whether a reported grid is the pre-layout lie
  (settled against the next report within a short window rather than trusted
  on arrival); the cell metric, derived from a spanning Surface's grid and the
  container size and kept for the split case; the grid for a split container;
  which requests must be sent even though the size has not changed (Attach,
  sheet closed, Session switched, reconnect); and the one-in-flight,
  newest-pending coalescing the resize scheduler does today.
- The resize scheduler becomes implementation of this module. Its `reset()`
  stops being anything a caller sees.
- The placeholder Surface mounted before there is a Topology, whose only job is
  to report a grid so Attach can begin, is retired if the sizing module can be
  given a settled grid another way; if a Surface must still be the ruler, that
  is the module's decision and the screen only mounts what it is asked to.
- The sizing module belongs to the Attach and lives as long as it does, so the
  last settled grid survives a trip to Home and is what a restore is sized
  from. Following `remux`, a grid reported while the keyboard is moving is not
  the one carried into a reconnect; the last stable one is.
- Nothing about *what* command is sent changes. `refresh-client -C` on the
  Control Connection, no Session option touched, as ADR 0006 decided.

### The Pane view owns its Surface

- The Pane view is handed a Surface adapter (write bytes, focus, blur, whether
  focused) when the Surface exists, and told each grid the Surface reports. The
  view decides when to paint: once it has both a Surface and a grid that has
  stopped moving, after the settling period the library needs after mounting.
  That period is a constant inside the view, measured once and asserted by a
  test with the fake clock.
- The view owns cursor visibility for its Pane end to end: told whether it is
  the active Pane, it hides or shows the cursor and keeps it hidden through
  redraws as it does today.
- The view owns keyboard focus for its Pane. The keyboard toggle asks the
  active Pane's view, and the view asks its Surface whether it is focused
  rather than the screen consulting a global keyboard listener. The Dock's
  keyboard button still needs to know which way to point; it reads that from
  the view or from the same listener, whichever is measured to be reliable, but
  the *action* goes to the Surface that has focus.
- Base64 encoding of bytes for the library's `write` moves behind the Surface
  adapter, so the view writes bytes and the adapter knows the library's wire
  format.
- A Pane view can lose its Surface and gain a new one: the Terminal Screen
  unmounts on Home and mounts again on return while the Attach, and the views
  it holds, stay up. Losing the Surface stops writes and keeps receiving
  `%output` into the held buffer's place; gaining one triggers a fresh resync
  exactly as a first paint does. Output that arrives while there is no Surface
  is not kept: the capture on return is the truth, as it is after any resync.
- The view's dispose releases its Surface. The Attach keeps the registry of
  views by Pane id, because it is what routes `%output`; the screen keeps no
  Map of grids and no Map of Surfaces.
- The seam here is new and justified by two adapters: the `expo-libghostty`
  view in production and a recording fake in tests.
- ADR 0006's model is unchanged: one Surface per Pane on screen, `%output`
  routed per Pane, `capture-pane` for the resync.

### Attach as a module

- A module opened with a Host record, a Session name, the host store (for the
  Fingerprint and the Recent Session), the transport factory, the Zoom
  preference and a clock. It creates its own Client sizing module. It performs
  Attach in the order the screen does today: connect and read the key verdict;
  wait for a settled grid; open the Control Connection with no PTY; make the
  Client and the Topology store; size first; apply Zoom; read the Topology;
  re-read the Session list. The order is a property of the module and is
  asserted by a test.
- It exposes: a subscription to its state (phase, Fingerprint verdict,
  attached Session name, Topology, Sessions, the last quiet trouble); the verbs
  the Dock and pickers need (switch Session, select Window, select Pane, split
  right or down, new Window, set Zoom, capture previews); per-Pane hooks for the
  Pane views (a reader for captures and keys, and where `%output` goes); the
  facts the screen and the root feed it (a Surface for a Pane came or went, a
  grid was reported, the container was laid out, a sheet closed, the app's
  lifecycle phase changed); and one `close()`.
- Its phase is one of: connecting, connected, restoring (a reconnect that
  foreground asked for), reconnecting (a reconnect that transport loss asked
  for), disconnected with a reason, closed. The reason carries a kind:
  transport lost, Host unreachable, authentication, Host key, tmux unavailable,
  Session ended on the Host, user closed, unknown. Only "transport lost"
  allows an automatic reconnect. This mirrors `remux`'s runtime state and
  disconnect-reason classifier.
- After every structural verb it re-applies the Zoom preference and refreshes
  the Topology itself. Selecting a Pane activates it in the store first and
  rolls back on refusal, as today. Switching Session re-sizes through the
  sizing module and stamps the Recent Session.
- It owns cancellation. Every async step checks one internal closed flag; a
  command that rejects because the channel is gone after `close()` is dropped;
  while open, a failed command nobody waited on becomes the quiet trouble line
  in its state. No callback fires after `close()`.
- The Topology store refreshes itself when `apply` says stale, given the
  reader it already has. `'stale'` stops being something a caller acts on. The
  optimistic `activate` stays.
- The Session name is held once, inside the module, and published through the
  state subscription.
- The name of the module is the verb CONTEXT.md already has: Attach. It creates
  no new domain term.
- The transport seam is unchanged and is where the module is tested: the SSH
  adapter in production, the local-process adapter the control-mode harness
  already has in tests. The transport interface gains one question, whether
  the control channel is still open, which the SSH adapter answers from the
  library's connection and shell state and the local adapter from whether the
  child process is alive.

### Attach held by the app: the `remux` lifecycle policy

What `remux` does, read from its root model and screen model, and what Muxify
copies:

- **Home does not disconnect.** `remux` keeps every attached Session in a
  collection at the root and draws the terminal in a layer behind the library;
  leaving to the library changes what is on top, not what is connected.
  Disconnect is an explicit verb on the Session's row. Muxify does the same
  with one Attach at a time: the root holds the current Attach; the Terminal
  Screen subscribes to it on mount and unsubscribes on unmount; Home is
  navigation and nothing else.
- **Background does not disconnect.** On the background phase `remux` cancels
  its Session-list refreshes and tells the Session the app is inactive, which
  gates drawing; it begins no background task and sends nothing to keep the
  link alive. Muxify does the same: on background the Attach cancels any
  in-flight preview or Session-list read, stops writing to Surfaces, and
  leaves the SSH Connection to the library's own keepalive. Whether the
  socket survives suspension is iOS's decision, and the foreground check is
  what answers it.
- **Foreground asks whether the link survived.** On becoming active `remux`
  asks the transport whether the control channel is still active; if it is
  not, it invalidates the transport and reports "disconnected, transport
  unavailable after foreground" with a foreground source, and the root's
  policy reconnects once. If the Session was already disconnected when the
  app came back, the disconnected state is re-reported with the foreground
  source so the same policy can act. Muxify copies this exactly: the Attach
  is told the phase became active, asks the transport, and either carries on
  or moves to restoring and replaces itself.
- **Transport loss while active reconnects once.** A closed Control
  Connection or an SSH disconnect while the app is active moves the Attach to
  reconnecting and replaces itself once. In `remux` this is the transport-loss
  source; the state is labelled "Reconnecting" where a foreground restore is
  labelled "Restoring".
- **Once per source, reset on connected.** `remux` records which automatic
  sources have already been tried and refuses a second attempt from the same
  source until the Session is connected again, when the record clears. A
  reconnect that fails leaves the Session disconnected with the reason, and
  the user reconnects by hand from the row or from the Terminal Screen.
  Muxify keeps the same rule.
- **Only a lost transport reconnects automatically.** Authentication, Host key,
  Host unreachable, tmux unavailable, Session ended on the Host, user closed
  and unknown never do. `remux` encodes this on the reason; so does Muxify.
- **A reconnect is a replacement.** `remux` closes the prepared transport and
  the screen model and creates a new runtime with a new instance id, so
  updates from the old one are recognised as stale and dropped. Muxify's
  Attach closes its SSH Connection, Control Connection, Client and Topology
  store and makes fresh ones under the same Attach identity; the Pane views
  are re-created and resynced; the last stable grid is what the new Client is
  sized from; the Zoom preference is re-applied. To the screen it is a phase
  change, not a new object.
- **One Attach at a time.** `remux` holds several; Muxify holds one. Opening a
  Session while one is attached closes the current Attach first (user-closed,
  no reconnect) and opens the new one. Tapping the row of the Session that is
  already attached returns to the Terminal Screen without touching it. This is
  the one place Muxify deliberately does less than `remux`.
- **Where the state shows.** The Host Screen's Recent Session row for the
  attached Session shows its phase (Connecting, Connected, Restoring,
  Reconnecting, or the disconnected reason's short label) and a Disconnect
  action; the Hosts list marks the Host that has the attached Session. The
  Terminal Screen shows the same phase in its status banner and, when
  disconnected, a Reconnect action and the reason.
- The Terminal Screen route stays a normal stack screen, pushed from the Host
  Screen and dismissed by Home. It no longer starts or stops anything; if it
  mounts with no current Attach or with one for a different Session, it asks
  the root to open one.
- The app's lifecycle phase comes from React Native's app-state events at the
  root and is forwarded to the Attach as a fact. The Attach, not the root,
  decides what each transition means.

### What the Terminal Screen keeps

Layout (which Panes, where, from the Topology and the Layout), the slot
components, gesture wiring (the mouse layer and the inactive-Pane tap target,
untouched by this spec), the Dock and Key Bar, the picker sheet's presentation,
the sticky modifiers, the Theme frozen at arrival, and the host-key warning.
It reads everything else from the Attach subscription.

### Domain language and decisions

- CONTEXT.md's **Connection** entry changes: it is no longer "torn down when
  the Terminal Screen is left, and re-established on return" but held by the
  app until the user disconnects, another Session is opened, or the transport
  is lost and not restored. **Attach** gains a sentence saying it is what the
  app holds, not what a screen does.
- An ADR records the lifecycle policy and its source, so a later review does
  not re-propose tearing down on unmount. It supersedes the sentence in the
  Terminal Screen's teardown comment that "Connections are ephemeral by
  design".

## Testing Decisions

A good test here exercises a module through its interface and asserts what left
it: which commands were sent, in which order, and what was written to the
Surface. It never reads a ref, a timer id or an internal flag. Timing is
asserted with an injectable clock, as the Pane view and the settle helper
already do, never with a real wait.

Modules tested and where the prior art is:

- **Client sizing**: unit tests replaying sequences of grid reports (including
  the pre-layout 32×11 followed by the real grid within a few milliseconds),
  container changes, sheet closes, Session switches and reconnects against a
  fake clock and a recording sender, asserting exactly which sizes went out.
  Prior art: the resize scheduler's tests (in-flight and pending behaviour) and
  the settle helper's tests (injectable sleep).
- **Pane view**: the existing test file gains a recording fake Surface and cases
  for Surface-before-grid, grid-before-Surface, pre-layout-grid-then-real,
  paint-once, repaint-on-real-change, cursor hidden through redraws, focus and
  blur routed to the Surface, Surface lost and regained with a fresh resync,
  and dispose releasing it. Prior art: the same file's fake reader and fake
  clock.
- **Attach**: two levels. Unit, with the fake transport the Control Connection
  tests use, asserting the Attach ordering, the state published at each phase,
  Zoom re-applied after each verb, the quiet trouble line for a refused
  background command, that nothing fires after `close()`, and the whole
  lifecycle policy: background changes nothing on the wire; foreground with a
  live channel changes nothing; foreground with a dead channel moves to
  restoring and replaces once; a second dead foreground before a connected
  phase is skipped; transport loss while active moves to reconnecting once;
  a reason that forbids reconnect stays disconnected; a user close never
  reconnects; opening another Session closes the current one as user-closed.
  Real tmux, under `pnpm e2e:control` with the local-process transport the
  harness already has, asserting a refused Attach carries tmux's own reason, a
  Session switch re-sizes, a `%layout-change` reaches the subscription, a
  killed child process ends in the disconnected phase with a transport-lost
  reason and one reconnect follows, and a killed Session ends in "Session
  ended" with no reconnect. Prior art: the control-mode harness, which
  hand-assembles this exact sequence today.
- **Topology store**: one new case, that a stale notification triggers a
  refresh through the reader without the caller doing anything.
- **Root holder**: a small unit test that the root forwards app-state changes
  to the current Attach, that opening a Session while one is attached closes
  the old one first, and that tapping the attached Session opens nothing.
- **Device**: the existing `.ad` suites and the regression script keep passing
  unchanged, plus one new device check: Home then return shows the Connected
  status without the Connecting phase appearing in between. Backgrounding
  cannot be driven by the device harness and is covered by the unit and
  real-tmux tests above.

## Out of Scope

- **Several Attaches at once**, as `remux` has. One at a time is enough for the
  probe; the root holder is shaped so that a collection could replace a single
  slot later without the Attach module changing.
- **Keeping the link alive in the background** with a background task or
  extra keepalives. `remux` does neither, and the foreground check is the
  design.
- **Pushing Pane state from tmux** (`refresh-client -B` subscriptions in place
  of the 1.5-second state poll and the re-read behind sheets). It imposes a
  tmux version floor and needs measuring against a real tmux first; it deserves
  its own spec and an ADR.
- **One finger path per Pane** (collapsing the mouse layer, the Surface's
  patched pan and the inactive-Pane tap target into one gesture owner). Touches
  the library patch; its own spec.
- **Folding the Control Command builders into the Client**, deleting the
  preview helpers, and making `setZoom` take the known flag. Cheap, but not
  part of this; may be done opportunistically while touching Attach if it costs
  nothing.
- **Deriving picker cards and reading Zoom from tmux's flag.** Small; may fall
  out of Attach publishing the Topology, but is not a criterion here.
- Any change to what commands are sent to tmux, to the Layout drawn by the
  Panes picker (ADR 0004), to Session creation (ADR 0005), or to sending keys by
  name (ADR 0003).
- Any change to the library patch.

## Further Notes

- Two loose ends found by the review that this work should settle in passing,
  because Attach's real-tmux test is the natural place: whether tmux's stderr
  from a failed `tmux -C attach`, which the SSH adapter merges into the control
  stream, survives the control parser (which drops every line that is not a
  `%`-notification outside a reply block) and reaches the user; and the two
  comments whose reasons no longer hold (the Dock's keyboard inset still
  explained as clearing the Accessory Bar; the base64 helper and the UTF-8
  helper disagreeing about `TextEncoder` on Hermes).
- The 80 ms settle window, the twelve-try limit and the 250 ms paint delay were
  measured on a device and are correct there. Moving them into modules does not
  change their values; it gives each a test that fails if a library upgrade
  changes what they compensate for.
- The SSH library already exposes what the foreground check needs: a connected
  flag on the Connection, an open flag on the shell channel, a disconnected
  event with a reason, and keepalive interval and count options. Nothing has
  to be added to it.
- The `remux` behaviour was read from its root model, its screen model and its
  reconnect-source and runtime-state types on 16 September 2026. Its labels
  are "Connecting", "Restoring" (foreground), "Reconnecting" (transport loss),
  "Connected", and a short label per disconnect reason kind. Muxify uses the
  same words.
- The review's HTML report is in the OS temp directory and is not checked in;
  the crutch ledger it contains is summarised in the Problem Statement above.
