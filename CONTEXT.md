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
The current tree of Windows and Panes under a Session, kept up to date by what
tmux pushes down the Control Connection rather than read when something needs
it. Which Windows and Panes exist, not where they sit — that is the Layout.
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
Panes picker is where it is turned off, and turning it off shows the real
split — a Surface per Pane, each laid out where the Layout puts it.

**Theme**:
The colours the Surface paints with, chosen in Settings: Default (Ghostty's
own), Mocha and Latte (the two Catppuccin palettes). It decides the app's
appearance too — Latte is the light one — so the picker is the light/dark
switch as well; there is no separate setting, because a light terminal in a
dark app reads as two apps. Applied to the Surface from the next Attach, not to
a Session already on screen; the chrome follows immediately.
_Avoid_: colour scheme (which is the phone's setting, and Muxify ignores it),
skin

**Scrollback**:
The lines a Pane has scrolled off the top, kept by tmux and bounded by its
`history-limit`. It belongs to the Host, not to the Surface: the Surface only
ever holds what it has been painted, so there is nothing behind what is on
screen for it to scroll. Reached by dragging, which paints a window of the
Scrollback over the Surface and puts the live Pane back at the bottom.
_Avoid_: history (which is the shell's), buffer

**Attach**:
Opening a Control Connection onto a Session. Attach itself only ever attaches,
never creates — but Muxify can make a Session first, from the Host Screen's
**+**. Rename and kill are still refused. See ADR 0005.

**Recent Session**:
Muxify's memory of a Session this phone has opened, and when it last did. Not
the Session, which lives on the Host and outlives every Connection — the
memory. The distinction matters on the Host Screen, where a Session that exists
but has never been opened here is a different row in a different section.
_Avoid_: workspace, saved session, history

**Client**:
tmux's own term for what an Attach creates. Muxify's is a *control* client: it
has no terminal, renders nothing, and holds no Session option of its own. A
Session can have several Clients and tmux keeps each one's size separately — so
a Client's size is not the Session's size and not the Surface's.
_Avoid_: viewer, terminal, connection

### Terminal

**Control Connection**:
The single SSH channel running `tmux -C attach`, carrying Control Commands and
Pane output in both directions. It asks for no terminal, which is why tmux sets
no Session option for it. See ADR 0006.
_Avoid_: Shell Channel, PTY, control mode (which is tmux's protocol, not this
link)

**Control Command**:
One `tmux` command sent down the Control Connection and matched to the reply
tmux answers it with. The two that happen before there is a Session to attach
to — listing a Host's Sessions, and making one — are the exception, and go out
on a channel of their own.
_Avoid_: exec channel, one-shot

**Surface**:
The `expo-libghostty` view that renders the bytes Muxify paints it with and
reports typed input back. Owns VT parsing and the keyboard; Muxify only moves
bytes. There is one per Pane on screen, so an unzoomed Window has several —
each with its own grid, cursor and Scrollback.
_Avoid_: Terminal, emulator, view

**Accessory Bar**:
The modifier-key row (ctrl, esc, tab, arrows) that `expo-libghostty` draws above
the system keyboard. Supplied by the library, not built by Muxify, and visible
only while the keyboard is up. Muxify turns it off; the Meta menu is what stands
in its place.
_Avoid_: Toolbar, key bar (reserved for the Dock)

**Dock**:
Muxify's own Liquid Glass bar pinned to the bottom of the Terminal Screen. Three
groups: Meta, the Session/Window/Pane pickers, and Home/Keyboard.
_Avoid_: Toolbar, tab bar, bottom bar

**Meta**:
The Dock's first group: one button opening a menu of the keys a phone keyboard
does not have — esc, tab, enter, the arrows, and the Control, Option and Move
groups. Named for what it offers rather than for any one modifier, since none of
them is a modifier here: each entry is a whole key, sent by name.
_Avoid_: Modifiers, hotkeys, special keys
