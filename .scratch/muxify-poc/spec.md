# Muxify PoC — attach to tmux Sessions over SSH

Status: ready-for-agent

## Problem Statement

`remux` is a native Swift/SwiftUI iOS app that lets a developer reach the tmux
Sessions running on their remote machines from a phone. It works, but it is
locked to a native Apple toolchain and to a custom rebuild of Ghostty.

The open question is whether the same app can be built on Expo — whether Expo's
Liquid Glass UI, `expo-libghostty` and a React Native SSH stack can be composed
into something that actually attaches to a Session and stays usable on a phone.
Nobody knows, because the terminal and transport libraries involved are young
and unproven, and the tmux integration `remux` relies on is not exposed to
JavaScript at all.

The deliverable is an answer to that question, backed by a running app.

## Solution

An iOS-only Expo app that stores a list of Hosts, connects to one over SSH,
attaches to an existing Session, and renders it in a real terminal Surface with
a Liquid Glass Dock for navigating between Sessions, Windows and Panes.

A developer opens the app, sees their saved Hosts, taps one, sees the Sessions
running on it, taps a Session, and lands in a working terminal. The Dock at the
bottom lets them jump between Sessions, Windows and Panes without knowing tmux
keybindings, toggle the keyboard, or return to the Host list. Leaving the
terminal drops the Connection; returning re-attaches, which tmux makes cheap.

Whether this holds together — and where it doesn't — is the actual output.

## User Stories

1. As a developer, I want to add a Host by name, address, port and user, so that I can reach my machine without retyping its details.
2. As a developer, I want to authenticate to a Host with a password, so that I can connect to machines where that is all I have.
3. As a developer, I want to authenticate to a Host with a pasted private key, so that I can connect to machines that refuse password auth.
4. As a developer, I want my password and private key stored in the device keychain rather than alongside the Host record, so that a filesystem dump does not leak my credentials.
5. As a developer, I want one Identity to be usable by several Hosts, so that I do not paste the same key repeatedly.
6. As a developer, I want to set an optional absolute path to the tmux binary on a Host, so that Hosts where tmux is not on a non-interactive shell's `PATH` still work.
7. As a developer, I want to see all my saved Hosts in one list, so that I can pick a machine at a glance.
8. As a developer, I want to edit a saved Host, so that I can fix a typo or a changed address without recreating it.
9. As a developer, I want to delete a saved Host, so that machines I no longer use stop cluttering the list.
10. As a developer, I want a clear empty state when I have no Hosts yet, so that I know to add one instead of wondering whether the app is broken.
11. As a developer, I want the Host form to reject an empty name, address or user before it tries to connect, so that I get an immediate answer instead of a connection failure.
12. As a developer, I want the Host form to reject a port outside 1–65535, so that I catch a typo before it becomes a confusing network error.
13. As a developer, I want the Host form to reject a tmux path that is not absolute, so that I do not silently get a Host that can never attach.
14. As a developer, I want to tap a Host and see the Sessions currently running on it, so that I can choose which one to resume.
15. As a developer, I want the Session list to show a loading state while it is being read, so that I know the app is working rather than stuck.
16. As a developer, I want a clear message when a Host is unreachable or authentication fails, so that I can tell a wrong password from a down machine.
17. As a developer, I want a Host running no tmux server to read as "no Sessions" rather than an error, so that a fresh machine does not look broken.
18. As a developer, I want to tap a Session and be attached to it, so that I land back in the work I left.
19. As a developer, I want the terminal to render exactly what tmux draws, including colour and cursor position, so that my editor and shell prompt look correct.
20. As a developer, I want to type into the terminal and have the keystrokes reach the remote shell, so that I can actually do work.
21. As a developer, I want the remote terminal resized to match my screen, so that full-screen programs are not drawn at the wrong size.
22. As a developer, I want modifier keys like ctrl, esc and tab available above the keyboard, so that I can send ctrl-C and use tab completion.
23. As a developer, I want to tap the Sessions button in the Dock and pick a different Session, so that I can move between projects without leaving the terminal.
24. As a developer, I want to tap the Windows button in the Dock and pick a different Window, so that I can move around a Session without knowing tmux keybindings.
25. As a developer, I want to tap the Panes button in the Dock and pick a different Pane, so that I can focus a specific split.
26. As a developer, I want the Window and Pane pickers to show what is currently active, so that I know where I am before I move.
27. As a developer, I want the pickers to read live state each time they open, so that I am not choosing from a stale list.
28. As a developer, I want the Windows and Panes buttons disabled when there is nothing to pick, so that I do not open an empty sheet.
29. As a developer, I want a keyboard button in the Dock, so that I can dismiss the keyboard to see more of the terminal and bring it back when I need to type.
30. As a developer, I want a home button in the Dock, so that I can return to my Hosts without a gesture I have to discover.
31. As a developer, I want leaving the terminal to close the Connection, so that I am not holding a socket open against a machine I am not using.
32. As a developer, I want returning to a Session to re-attach where I left off, so that closing the terminal costs me nothing.
33. As a developer, I want the Host's key Fingerprint recorded the first time I connect, so that the app can notice if it changes later.
34. As a developer, I want a loud warning when a Host's key Fingerprint changes, so that I can tell a rebuilt machine from an interception attempt.
35. As a developer, I want that warning not to block me outright, so that I can still reach a machine I know I rebuilt.
36. As a developer, I want the interface rendered in Liquid Glass, so that the app looks native to a current iOS.
37. As a developer, I want the app not to crash on iOS 26 builds that lack the glass API, so that a beta OS does not make it unusable.
38. As a maintainer, I want the tmux command construction and output parsing covered by tests, so that a change to a format string does not silently break the pickers.
39. As a maintainer, I want Session names escaped before they reach a shell command, so that an awkward name cannot break or alter the command.
40. As a maintainer, I want terminal bytes moved in their binary form rather than as decoded text, so that multi-byte characters split across network chunks are not corrupted.
41. As a maintainer, I want dependency versions pinned exactly, so that a young library publishing a breaking patch does not break the build.
42. As a maintainer, I want the findings about whether this stack holds together written down, so that the probe produces a reusable answer and not just an app.

## Implementation Decisions

### Scope shape

This is a probe, not a product. It is scoped to the full user journey — Host
CRUDL, Session listing, Attach, Dock navigation — because the UI is half of what
is being evaluated, but every decision below favours answering the question over
building something durable.

Build order puts risk first: prove the byte pipeline (transport, prebuild,
Surface, Attach) before any screen work, so that a failure of the young
libraries surfaces on day one rather than after the UI is built.

### Transport and terminal

SSH uses `@osuki-dev/react-native-ssh`; the terminal is `expo-libghostty` pinned
to the published release rather than a git ref. Both are recorded in
`docs/adr/0002-ssh-transport.md`, along with the rejected alternatives.

Attaching uses a Shell Channel — a PTY-backed SSH channel running tmux's attach
command against a named Session. Muxify never creates, renames or kills a
Session.

Topology reads and client switching use Control Commands: one-shot tmux
invocations on separate SSH exec channels, out of band from the Shell Channel.
tmux control mode is deliberately not used, because `expo-libghostty` exposes
none of the API that `remux` relies on for it; see
`docs/adr/0001-control-commands-instead-of-tmux-control-mode.md`. A Host running
no tmux server must be reported as an empty Session list, not an error.

Session names are escaped before being interpolated into any Control Command.

### The byte pipeline

Three flows connect the transport to the Surface: Shell Channel output into the
Surface, Surface input back out to the Shell Channel, and Surface resize events
into a remote terminal resize.

Bytes cross in their base64 form, never as decoded text. The Surface's input
event exposes both; the text form will corrupt multi-byte characters that split
across network chunk boundaries, and must not be used.

### Modules

- A **TmuxClient** owns a Connection and exposes the domain operations:
  list Sessions, Attach, read Topology, select a Window, select a Pane, switch
  Session. It depends on a transport interface, not on the SSH library directly.
- A **transport interface** with two operations — execute a command and return
  its output, and open a shell channel returning a duplex stream. This is the
  project's single test seam.
- A **Host repository** persisting Host, Identity and Fingerprint records as
  JSON files, mirroring `remux`'s layout. Credentials go to the device keychain
  via secure storage, keyed by Identity, never into the JSON.
- **Pure helpers** for Host draft validation, Fingerprint comparison and base64
  conversion. No seam; called directly.
- A **Surface wrapper** forwarding bytes and resize events in both directions.
- A **Dock** component and the picker sheets it opens.

### Data model

Ported near-verbatim from `remux`: a Host carries display name, address, port,
user, a reference to an Identity, and an optional tmux path. An Identity carries
a name, an authentication kind and an optional public Fingerprint. Identity is
deliberately a separate record from Host so one credential can serve several.

### Navigation and UI

A single navigation stack — the starter template's tab bar is removed. Three
screens: Hosts list, Host detail (its Sessions), and the terminal.

All surfaces use Liquid Glass. The Dock is built from SwiftUI glass primitives
inside a hosting boundary, using a glass-effect container and a shared namespace
so adjacent buttons merge and morph the way `remux`'s capsule groups do. An
RN-positioned glass container is the fallback if hosting-boundary sizing fights
the keyboard.

The Dock has two groups: Sessions/Windows/Panes, and Home/Keyboard. There is no
modifier-key group and no composer button — the terminal library ships its own
Accessory Bar with ctrl/esc/tab and offers no way to hide it; see
`docs/adr/0003-no-custom-modifier-key-group.md`.

Glass availability is probed with the runtime API check, not the design-mode
check — they are different functions, and only the former guards against iOS 26
builds that lack the underlying effect class and would otherwise crash. No
non-glass fallback theme is built; every target device is iOS 26.4+.

### Security

Host key verification is trust-on-first-use: record the Fingerprint on first
Connection, compare on every later one, warn prominently on a mismatch, do not
block. The SSH library surfaces the key to a verification callback, so this is
implemented rather than skipped.

### Dependencies and build

The app requires a prebuild and a custom development client; it cannot run in
Expo Go. The terminal library fetches a large prebuilt framework in a postinstall
script, which pnpm blocks by default — the workspace file must allow builds for
that package or the iOS build fails on a missing framework.

All versions are pinned exactly and the lockfile committed.

## Testing Decisions

### What makes a good test here

Tests exercise externally observable behaviour: given this tmux output, the
TmuxClient reports these Sessions; given this Session name, it issues this
command. They do not assert on internal call sequences, private helpers, or how
a result was assembled. A test that breaks when a module is restructured without
changing what it returns is a bad test.

Native boundaries are not mocked in order to be tested. The SSH library and the
Surface are other people's code; asserting that a mock was called proves nothing
about whether bytes reach a terminal. Those are verified by running the app.

### The seam

The transport interface is the project's single seam. TmuxClient is tested
against a fake transport returning canned tmux output, which covers the
error-prone logic: Control Command construction, Session name escaping, parsing
of Session/Window/Pane listings, identification of the active Window and Pane,
and the "no tmux server running" case reading as empty rather than failing.

Pure helpers — draft validation, Fingerprint comparison, base64 conversion — are
tested directly with no seam.

Not seamed and not unit-tested: the Surface wrapper (a few lines of byte
forwarding), persistence (thin wrappers over platform storage), and anything
glass.

### Runner

`jest-expo`, matched to the Expo SDK, with `@types/jest` and `jest` itself, and
`jest` added to the TypeScript `types` array. The preset's standard
`transformIgnorePatterns` applies: the workspace uses a hoisted node linker, so
the flat-layout pattern is correct and the pnpm-specific variant is not needed.

### Prior art

None in this repo — no test runner exists yet, so this spec establishes it.
`remux` is the reference for what is worth covering: it tests tmux command
construction and Session discovery parsing heavily, including the
no-server-running case, and does not unit-test its terminal rendering.

## Out of Scope

- Creating, renaming or killing Sessions, Windows or Panes. Attach only.
- tmux control mode, and any live model of Topology. Pickers re-read on open.
- Pane thumbnails and multi-Pane rendering — impossible with a single Surface.
- An Active Sessions section on the Hosts list, and any persistent Connection,
  connection pooling, background/foreground handling or reconnect-on-network-change.
  Connections are ephemeral.
- A composer for typing long commands before sending.
- A custom modifier-key group in the Dock.
- Tailscale SSH authentication.
- Passphrase-protected private keys, on-device key generation, key import from
  Files, and installing a public key on a Host.
- SFTP, port forwarding, ProxyJump, and OpenSSH user certificates.
- Android, web, iPad and Mac Catalyst.
- A non-glass fallback theme.
- Blocking on a Fingerprint mismatch.

## Further Notes

**The dependency risk is the subject, not a caveat.** The SSH library was
published days before this spec at an early version with a single author; the
terminal library has had no functional commit in two months, also single-author,
and its vendored terminal core is over a thousand commits behind upstream.
Whether they hold up is the question being asked. Notes should be kept as the
build proceeds and written up at the end — that write-up is a deliverable.

**A known consequence of dropping the modifier group:** the library's Accessory
Bar only exists while the keyboard is up, whereas `remux`'s equivalent is always
visible. With the keyboard hidden there is no way to send ctrl-C, which makes the
Dock's keyboard toggle load-bearing. This is accepted; how much it grates is
itself a finding. The fix, if needed, is a glass group writing bytes straight to
the Shell Channel — the Surface cannot accept synthetic key events, so such
buttons would bypass it entirely and create a second input path.

**Toolchain is confirmed available:** Xcode 26.6, iOS SDK 26.5, simulators on
26.4 and 26.5. Liquid Glass is available on every target, and a physical device
is also available for checking glass rendering and keyboard behaviour.

**On copying `remux`:** it is the reference for information architecture, the
data model and the Dock's button taxonomy — not for pixel appearance. Where its
design and Liquid Glass conflict, Liquid Glass wins. It is a native Swift app, so
nothing is reused as code.
