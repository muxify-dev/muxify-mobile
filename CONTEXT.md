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
One live SSH link to a Host. Held by the app rather than by a screen: leaving
the Terminal Screen, going Home and backgrounding Muxify all leave it up. It
ends when the user disconnects it, when another Session is opened, or when the
transport is lost and cannot be restored. Muxify holds one at a time. See ADR
0007.
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

Muxify's is a *preference*, not tmux's flag: it says what a Session should
arrive as and what the switch asks for, while what is on screen follows tmux.
The two disagreeing is something the user can see, so every verb re-applies the
preference afterwards — except picking a Pane, which carries it in the command
instead. `select-pane -Z` has tmux keep the Window zoomed across the selection;
putting the zoom back afterwards would work too, and costs two round trips of
drawing the split it is about to throw away.

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
Opening a Control Connection onto a Session, and the thing that holds it
afterwards. Attach itself only ever attaches, never creates — but Muxify can
make a Session first, from the Host Screen's **+**. Rename and kill are still
refused. See ADR 0005.

It is what the *app* holds, not what a screen does: one Attach owns the
Connection, the Control Connection, the Client and its size, the Topology, the
Session name and a view per Pane, and it outlives every screen that draws it.
The Terminal Screen subscribes to whichever one is current; the Host Screen
shows its phase and offers to end it. See ADR 0007.

**Recent Session**:
Muxify's memory of a Session this phone has opened, and when it last did. Not
the Session, which lives on the Host and outlives every Connection — the
memory. The distinction matters on the Host Screen, where a Session that exists
but has never been opened here is a different row in a different section.
_Avoid_: workspace, saved session, history

**Listing**:
What a Host last said its Sessions were. The Host Screen asks again every time
it comes back into focus — a sheet closing over it, a return from the Terminal
Screen — and the asking is invisible: the answer it is holding stays on screen
until a better one arrives. Only the first question has nothing to show and a
spinner to stand in for it. A refusal is the exception and drops the list,
because a Host that cannot be reached has no Sessions to offer.
_Avoid_: sessions (which are the Sessions themselves), fetch, cache

**Client**:
tmux's own term for what an Attach creates. Muxify's is a *control* client: it
has no terminal, renders nothing, and holds no Session option of its own. A
Session can have several Clients and tmux keeps each one's size separately — so
a Client's size is not the Session's size and not the Surface's. Muxify's is
the phone's screen with the keyboard down, and the keyboard does not change it
(ADR 0008).
_Avoid_: viewer, terminal, connection

**Slide**:
How far the Window is pushed up under the keyboard, so the row being typed on
stays above the keys: nothing for a Pane with three lines on it, everything the
keyboard covers for a Pane full to its last row. The Window is not resized for
the keyboard; it is slid, and the part slid out of view is clipped.
_Avoid_: scroll (which is the Scrollback's), offset, keyboard avoidance

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

It runs under a local patch — `patches/expo-libghostty.patch` — for the things
the published library does not offer and the app cannot do from outside it:
hiding the Accessory Bar, which covered the Dock (see ADR 0003); telling UIKit
the view has a document behind its caret, without which a held delete key
removes exactly one character; reporting the size of a cell with the grid,
without which nothing outside the Surface can turn a touch into a cell; and
two promises about its own readiness — nothing written to it is lost, and every
surface it builds underneath reports its grid — without which a Pane could be
left blank with no way to notice (see ADR 0009). Each hunk says why in place.

It reports its grid in whole cells, and the Pane it is given is not a whole
number of them — so there is a strip left over, which ghostty keeps at the
bottom and right. Anything mapping a point to a cell has to divide by the cell
and not by the Pane: the difference is a quarter of a point a row, which is
nothing at the top and a whole row by the bottom. See `cellOf`.
_Avoid_: Terminal, emulator, view

**Accessory Bar**:
The modifier-key row (ctrl, esc, tab, arrows) that `expo-libghostty` draws above
the system keyboard. Supplied by the library, not built by Muxify, and visible
only while the keyboard is up. Muxify turns it off; the Key Bar is what stands
in its place.
_Avoid_: Toolbar, key bar (reserved for the Dock)

**Dock**:
Muxify's own Liquid Glass bar pinned to the bottom of the Terminal Screen. Three
capsules, left to right: the Session/Window/Pane pickers, the Key Bar, and
Home/Keyboard. The pickers lead because they are reached for most; the Key Bar
takes the middle because it is the one that grows into whatever width is left;
Home sits at the far end from the arrows, because a Home pressed by a thumb
aiming for an arrow is a Session left by accident.

Each picker's icon is badged with how many things are behind it — the Host's
Sessions, the Session's Windows, the Window's Panes — and only above one, since
one is what everything looks like until somebody splits it.
_Avoid_: Toolbar, tab bar, bottom bar

**Key Bar**:
The Dock's middle capsule: the keys a phone keyboard does not have — ctrl, esc,
tab, the arrows, page up and down, alt, home and end. Three are on screen and
the rest are a sideways swipe away. Every key is the same fixed width, so a
four-letter label shrinks rather than widening its key. ctrl and alt are
*sticky*: armed by a tap, and spent on the next key from either the bar or the
system keyboard.
_Avoid_: Accessory Bar (that is the library's), toolbar, modifiers

**Banner**:
The Terminal Screen's one kind of notice: a Liquid Glass card that slides in
under the status bar, the way iOS delivers a notification over whatever is on
screen. It says what the Attach is doing while that is anything other than
connected — Connecting, Reconnecting, a disconnect reason with Reconnect where
retrying could work — and it is where the changed-host-key warning is shown.
Drawn in the Theme's appearance, not the phone's, so a light phone never puts a
white card over a Mocha terminal. Not a toast: it stays while the thing it
reports is true and leaves when it stops, rather than timing out.
_Avoid_: toast, notification, snackbar, alert (that is the system's modal)
