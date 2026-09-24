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
Control Commands rather than tracked continuously.
_Avoid_: Layout, tree, structure

**Attach**:
Binding the Shell Channel to an existing Session. Muxify only ever attaches —
it does not create, rename, or kill Sessions.

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
