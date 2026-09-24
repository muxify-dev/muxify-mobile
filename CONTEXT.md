# Muxify

An iOS app for attaching to tmux sessions on remote machines over SSH. It is an
Expo/React Native probe of the stack that `remux` (a native Swift app) already
proves natively — built to find out whether Expo's Liquid Glass UI and
`expo-libghostty` can reach the same place.

## Language

### Connecting

**Host**:
A saved, named description of a remote machine — address, port, user, and which
Identity authenticates to it. Persists whether or not anything is connected.
_Avoid_: Server, box, machine, target

**Identity**:
A stored SSH credential — a password or a private key — owned separately from
any Host so one credential can serve several.
_Avoid_: Credential, auth, login, key (when the record rather than the key material is meant)

**Connection**:
One live SSH link to a Host. Torn down when the Terminal Screen is left, and
re-established on return.
_Avoid_: SSH session, link, socket

**Fingerprint**:
The host key hash recorded the first time a Host is reached, compared on every
later Connection to detect a changed key.
_Avoid_: Host key (which is the key itself, not its hash)

### Multiplexing

**Session**:
A tmux session on a Host, named by tmux. Outlives every Connection attached to
it — the reason this app exists. Always a tmux session; never the SSH link.
_Avoid_: tmux session (redundant here), workspace, screen

**Window**:
A tmux window inside a Session, addressed by index.

**Pane**:
A tmux pane inside a Window, addressed by index.

**Topology**:
The current tree of Windows and Panes under a Session, read on demand via
Control Commands rather than tracked continuously. Which Windows and Panes
exist, not where they sit — that is the Layout.
_Avoid_: tree, structure

**Layout**:
Where the Panes of one Window sit, as tmux's `#{window_layout}` string gives
it. The only honest source: tmux reports a zoomed Pane's own coordinates as the
whole Window. The Panes picker draws the Layout's *arrangement* but not its
proportions — see ADR 0004.
_Avoid_: Topology (which is what exists, not where it is), geometry

**Zoom**:
tmux's term for one Pane filling its Window on its own. Muxify attaches zoomed
by default, because a phone is too narrow to read two Panes side by side; the
Panes picker is where it is turned off to see the real split.

**Theme**:
The colours the Surface paints with, chosen in Settings: Default (Ghostty's
own), Mocha and Latte (the two Catppuccin palettes). It decides the app's
appearance too — Latte is the light one — so the picker is the light/dark
switch as well; there is no separate setting, because a light terminal in a
dark app reads as two apps. Applied to the Surface from the next Attach, not to
a Session already on screen; the chrome follows immediately.
_Avoid_: colour scheme (which is the phone's setting, and Muxify ignores it),
skin

**Attach**:
Binding the Shell Channel to an existing Session. Muxify only ever attaches —
it does not create, rename, or kill Sessions.

**Client**:
tmux's own term for what an Attach creates: the thing tmux draws a Session for,
identified by the tty of the Shell Channel. A Session can have several, one per
attached terminal, and tmux keeps each one's size separately — so a Client's
size is not the Session's size and not the Surface's.
_Avoid_: viewer, terminal, connection

### Terminal

**Shell Channel**:
The single PTY-backed SSH channel that runs `tmux attach`. Carries terminal
bytes in both directions and nothing else.
_Avoid_: PTY, shell, stream

**Control Command**:
A one-shot `tmux` invocation run on its own SSH exec channel, out of band from
the Shell Channel, to read Topology or switch the attached client. Stdout only —
never interactive.
_Avoid_: Control mode (which is tmux's `-C` protocol, deliberately not used here)

**Surface**:
The `expo-libghostty` view that renders bytes from the Shell Channel and reports
typed input back. Owns VT parsing and the keyboard; Muxify only moves bytes.
_Avoid_: Terminal, emulator, view

**Accessory Bar**:
The modifier-key row (ctrl, esc, tab, arrows) that `expo-libghostty` draws above
the system keyboard. Supplied by the library, not built by Muxify, and visible
only while the keyboard is up.
_Avoid_: Toolbar, key bar (reserved for the Dock)

**Dock**:
Muxify's own Liquid Glass bar pinned to the bottom of the Terminal Screen. Two
groups: Session/Window/Pane pickers, and Home/Keyboard.
_Avoid_: Toolbar, tab bar, bottom bar
