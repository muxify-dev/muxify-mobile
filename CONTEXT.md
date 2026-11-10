# Muxify

An iOS app for attaching to tmux sessions on remote machines over SSH. It is an
Expo/React Native probe of the stack that `remux` (a native Swift app) already
proves natively — built to find out whether Expo's Liquid Glass UI and
`expo-libghostty` can reach the same place.

## Language

### Connecting

**Host**:
A saved, named description of a remote machine — address, port, user, and which
Identity authenticates to it. Persists whether or not anything is connected. The saved Hosts have an order,
which the user sets in Settings, and Home shows them in it.
_Avoid_: Server, box, machine, target

**Identity**:
A stored SSH credential — a password or a private key — owned separately from
any Host so one credential can serve several.
_Avoid_: Credential, auth, login, key (when the record rather than the key material is meant)

**Connection**:
One live SSH link to a Host. Held by the app rather than by a screen: leaving
the Terminal Screen, going Home and backgrounding Muxify all leave it up.
Muxify holds at most one per Host, and the Attach and the screens share it:
the Attach's Control Connection and each screen read are channels on it. It
ends when the transport is lost, when its keepalive goes unanswered for about
15 s, or a minute after the last screen read once no Attach holds it. See ADR
0007 and ADR 0012.
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
whole Window. The Panes picker draws the Layout to its proportions, with a
floor under the smallest Pane so it stays a tile that can be tapped — see ADR
0004. The Layout Map draws the same diagram, small.
_Avoid_: Topology (which is what exists, not where it is), geometry

**Zoom**:
tmux's term for one Pane filling its Window on its own. Muxify attaches zoomed
by default, because a phone is too narrow to read two Panes side by side; the
Panes picker, reached from the Key Row, and Zoom Pane in the Options menu are where
it is turned off, and turning it off shows the real split — a Surface per
Pane, each laid out where the Layout puts it.

Muxify's is a *preference*, not tmux's flag: it says what a Session should
arrive as and what the switch asks for, while what is on screen follows tmux.
The two disagreeing is something the user can see, so every verb re-applies the
preference afterwards — except picking a Pane, in the Panes picker or with a
Pane Swipe, which carries it in the command instead. `select-pane -Z` has tmux keep the Window zoomed across the selection;
putting the zoom back afterwards would work too, and costs two round trips of
drawing the split it is about to throw away.

**Theme**:
The colours the Surface paints with, chosen in Settings: Default (Ghostty's
own), Dracula and Solarized Light. It decides the app's appearance too —
Solarized is the light one — so the picker is the light/dark
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
memory. The Host Screen has a list of them, Recent Sessions, newest first,
which shows the ones the Host still has. With that list on, the Sessions list
leaves them out, so a Session that exists but has never been opened here is in
a different list.
_Avoid_: workspace, saved session, history

**Last Place**:
Where the user was when Muxify last closed: the Host, the Session and the Topic
it was opened from, if any. The app writes it each time an Attach reaches its
attached phase or switches Session, and clears it on Disconnect. With Reconnect
on start on, a cold start opens it again behind a "Trying to reconnect" screen.
A Disconnect means "do not take me back", so the next cold start opens Home.
_Avoid_: last session, resume point, saved state

**Home**:
The screen the app opens on: one section for each Host, in the Host order. The
section's header is the Host's name, a dot for its Connection (green when its
Listing has come back, orange while the first read is in flight, red when the
Host refused) and **All**, which opens that Host's Host Screen. Under it are
the first 5 rows the Host Screen would show, in the lists and the order the
user set in Settings, so one tap attaches to a Session or opens a Topic Screen.
Hosts are never mixed in one section. A Host that refused shows its reason and
Retry in its own section, and the other sections read on. Home reads every
Host's Listing each time it comes into focus, on that Host's one Connection.
Adding, editing, deleting and ordering Hosts is in Settings. See ADR 0013.
_Avoid_: Hosts list, front door, dashboard

**Listing**:
What a Host last said its Sessions were. The Host Screen and each Host section
of Home ask again every time they come back into focus — a sheet closing over it, a return from the Terminal
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
(ADR 0008). Under tmux's `window-size latest` the Window takes the size of the
latest Client, and a laptop that types becomes it. So Muxify claims the Window
with every size it asks for, and again on the next key typed on the phone after
another Client has taken it.
_Avoid_: viewer, terminal, connection

**Slide**:
How far the Window is pushed up under the keyboard, so the row being typed on
stays above the keys: nothing for a Pane with three lines on it, everything the
keyboard covers for a Pane full to its last row. The Window is not resized for
the keyboard; it is slid, and the part slid out of view is clipped.
_Avoid_: scroll (which is the Scrollback's), offset, keyboard avoidance

### Topics

These words come from desktop Muxify on the Mac and keep its meanings. The phone
reads Topics through the desktop `muxify` CLI and never writes the desktop
record files.

**Topic**:
One thing the user wants to get done, such as "Fix reward drop bug in GS". It
groups Sessions with no limit per folder or repository. The Host Screen shows
the Topics of a Host in the order that the Mac's Topics mode shows them.
_Avoid_: task, project, workspace, thread

**Topic Note**:
An optional line of text on a Topic that says what the user was doing there,
such as "Repro with seed 4411, then bisect". The user sets, changes or clears it
on the Mac. A Topic card shows all of it on its own line.
_Avoid_: next step, comment, description, memo

**Tag**:
An optional short name on a Topic, such as `backend`, that is one of the Tags
that the Host's Config defines. A Topic can have several Tags. A Tag can have a
colour, with one value for light and one for dark.
_Avoid_: label, category, folder, group

**Dormant**:
An open Topic that has no live Session but remembers Sessions, for example after
a tmux restart. The Host Screen shows it dimmed, with "No live Sessions".
_Avoid_: inactive, sleeping, suspended

**Empty**:
An open Topic that has no live Session and remembers no Session: the user
stopped, removed or moved away its last Session. The Host Screen shows it dimmed,
with "No live Sessions", the same as a Dormant Topic.
_Avoid_: Dormant (when it remembers no Session), blank, cleared

**In Play**:
The Mac's limited set of places for the Topics in work now, and the Guests
after them. With In Play on the Mac, the Host Screen shows the sections Pinned,
In Play, Guests, then the Bench row. Without it, the Host Screen shows the
Pinned Topics and then one list, with no section headers.
_Avoid_: active Topics, focus Topics, WIP limit

**Open Place**:
An In Play place that no card fills. The Host Screen shows it as an empty,
dashed row, so the user sees how many places are free.
_Avoid_: empty slot, hole, free place

**Guest**:
A card In Play above the number of places: a Topic with the Guest mark, or a
Locked Session. It shows in the Guests section, after the places.
_Avoid_: visitor, extra slot

**Bench**:
The open Topics that are not Pinned, not Guests and hold no In Play place. The
Host Screen shows them as one Bench row, with no count and no marks, that opens
to show their cards.
_Avoid_: backlog, hidden Topics, overflow

**Tag Mark**:
A small square in the colour of one Tag, at the end of a Topic card. The colour
is the Tag's light or dark value for the app's appearance. A Tag the Config no
longer defines, or a colour the phone cannot read, shows as a dashed square.
_Avoid_: tag chip, tag dot

**Topic Screen**:
The phone screen for one Topic, opened by a tap on its card on the Host Screen
or on Home.
It shows the title, the Topic Note, the Tags and the live Sessions in the Mac's
order, each with its Windows and their Agent marks. A tap on a Session attaches
to it; its Header then shows the Topic, and Back from it goes Home. A Dormant or Empty
Topic shows "No live Sessions" and says which of the two it is. It shows what
the Host Screen last read at once, and reads the Topic again each time it comes
into view. The Windows come in with that read.
_Avoid_: Topic detail, Topic page, Topic view

**New Topic**:
The sheet that makes an Empty Topic on a Host, as New Topic on the Mac does. It
has a title and one button for each Tag of the Host's last Topics read, in
Config order and in the Tag colour. Save opens the new Topic's Topic Screen. An
error from the Host shows in the sheet, and the sheet stays open. With the
Topics list on, + on the Host Screen offers New Session and New Topic.
_Avoid_: Create Topic, Add Topic

**Edit Topic**:
The sheet that Edit on the Topic Screen opens. It changes the title, the Topic
Note and the Tags. Save sends only the fields that differ from what the Host
last had, so a phone edit does not undo a different edit made on the Mac. A
field the Host refuses shows its error under it, the sheet stays open, and the
next Save sends only what still differs. A Tag that the Config no longer
defines shows dashed and can only be removed.
_Avoid_: Topic settings, Topic properties

**Add a Session**:
The sheet that Add a Session on the Topic Screen opens, and the main way out of
an Empty Topic on the phone. It takes one folder on the Host, where a leading
`~` is the home folder, and makes a Session there in the Topic. There is no
Worktree choice. An error from the Host, such as a folder that is not there,
shows in the sheet and the sheet stays open. After Save, the Topic Screen reads
the Topic again and shows the new Session.
_Avoid_: New Session (that sheet makes a Session in no Topic)

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
hiding the Accessory Bar, which covered the Key Row (see ADR 0003); telling UIKit
the view has a document behind its caret, without which a held delete key
removes exactly one character; reporting the size of a cell with the grid,
without which nothing outside the Surface can turn a touch into a cell; giving
the one-finger drag to Muxify, locked to one axis when it begins, as a scroll
or as a Pane Swipe; the Selection Layer, with Paste from the system menu and
from ⌘V on a hardware keyboard; and two promises about its own readiness — nothing written to it is lost, and every
surface it builds underneath reports its grid — without which a Pane could be
left blank with no way to notice (see ADR 0009). Each hunk says why in place.

It reports its grid in whole cells, and the Pane it is given is not a whole
number of them — so there is a strip left over, which ghostty keeps at the
bottom and right. Anything mapping a point to a cell has to divide by the cell
and not by the Pane: the difference is a quarter of a point a row, which is
nothing at the top and a whole row by the bottom. See `cellOf`.
_Avoid_: Terminal, emulator, view

**Selection**:
The iOS text selection on a Pane: a long press selects the word under the
finger, and the handles, the loupe and the system menu with Copy and Paste are
the system's own. It is how text leaves a Pane for another app. A Selection
holds its Pane frozen: the Pane's output is dropped and its picture stays
still until the Selection ends, and then the Pane is painted as it is now. A
vertical drag still moves a frozen Pane through its Scrollback, and a handle
held at the top or bottom edge does the same, so a Selection can be longer
than the screen. The keyboard goes down for a Selection and comes back after
it if it was up. A Selection ends on a tap outside it, after Copy or Paste, on a key
from the Key Row, on a change of Pane, Window or Session, and when the Attach
is lost. Copy gives the text as it was typed: rows that tmux wrapped are
joined, and the spaces at the end of a row are dropped. A long press where
there is no text selects nothing and offers Paste. In a Pane whose program
listens for the mouse, the long press starts a Selection and sends no click.
See ADR 0014.
_Avoid_: copy mode (that is tmux's, and is not used), highlight, mark

**Selection Layer**:
The read-only text view inside the Surface that iOS draws a Selection for. It
keeps no text between Selections. A long press asks Muxify for the rows on the
Surface, Muxify reads them from tmux with the capture that paints them, and
the Layer maps each row to the cells of the grid. Each row is known by its
line counted from the first line of the Scrollback, so it keeps that number
while output arrives. Part of the local patch to `expo-libghostty`.
_Avoid_: overlay, text view

**Pane Swipe**:
A horizontal drag of one finger on the Surface. A swipe left goes to the next
Pane of the Window and a swipe right to the previous one, in index order, and
past either end it comes round to the other: tmux's `select-pane -t :.+` and
`:.-`. The Zoom is kept. A drag is locked to one axis when it leaves the tap
slop: horizontal when it sets off more than one and a half times further
sideways than up or down, and a swipe when the finger lifts 40 points or more
from where it landed. Every other drag is vertical and moves the Scrollback,
or is the wheel for a program that listens for the mouse. That program gets
nothing from a horizontal drag. While a Selection is open a horizontal drag
is for its handles and changes no Pane. The system's back swipe is off on the Terminal
Screen except at the left edge, because it is the same drag as a swipe right.
_Avoid_: page, slide (that is the keyboard's), flick

**Layout Map**:
The small diagram in the top right of the Surface area: the Window's Layout,
with the active Pane in the accent colour. It shows which Pane the zoomed
Window is on, and it follows a Pane Swipe. A tap opens the Panes picker. A
Window with one Pane has no map.
_Avoid_: minimap, Pane indicator, thumbnail

**Header**:
The row at the top of the Terminal Screen, on the terminal background under
the status bar: Back on the left, the title in the middle, Options on the
right. Back goes Home and leaves the Session attached (ADR 0007). The title is
the Session name over the program that runs in the active Pane, as tmux's
`#{pane_current_command}` names it; for a Session opened from a Topic it is
the Topic title, the program, and the Session name in the dim tone. The
program follows the Topology, which is read again when the active Window is
renamed, when the title sheet or the Options menu opens, and after every verb;
a Window with a fixed name can show the program of the last read. A tap on the
title opens the Title Sheet. The red line under the Header that reports a
failed Pane command is not a Banner and always shows: the Connection is fine,
one command was not.
_Avoid_: navigation bar (that is the system's, and this screen has none),
title bar, toolbar

**Title Sheet**:
The sheet the Header's title opens. For a Session, one row per Window of the
Topology: index, name, program, the one on screen marked. For a Session opened
from a Topic, one section per live Session of the Topic with its Windows and
their Agent marks, read from the Mac through `muxify` each time the sheet
opens. A tap on a Window goes to it, switching Session first when it belongs
to another one. **Switch…** at the top closes the sheet and opens the Sessions
picker. The sheet draws no previews; the Sessions picker keeps its own. With
the Topics list on in Settings, the Sessions picker lists the Host's Topics
under its Sessions, as the rows of the Host Screen, with the Bench open. A tap
on a Topic opens its Topic Screen over the Attach, which stays up.
_Avoid_: Windows picker, Windows sheet (the old grid of previews), Topic sheet

**Options**:
The Header's ⋯ menu, in this order: Compose, Zoom Pane, New Window, Split
Pane (Split → and Split ↓), Font size − and +, Copy Pane text, then Copy log
and Disconnect. Font size changes the setting live, and the Surfaces reflow to
it. Copy Pane text puts the active Pane's text on the clipboard, plain and
with its wrapped lines joined. Disconnect ends the Attach and goes Home.
_Avoid_: menu (on its own), actions, overflow

**Accessory Bar**:
The modifier-key row (ctrl, esc, tab, arrows) that `expo-libghostty` draws above
the system keyboard. Supplied by the library, not built by Muxify, and visible
only while the keyboard is up. Muxify turns it off; the Key Row is what stands
in its place.
_Avoid_: Toolbar, key bar

**Key Row**:
Muxify's own Liquid Glass row pinned to the bottom of the Terminal Screen,
riding the keyboard: the keys a phone keyboard does not have, in three groups.
At the left, fixed: ⎋ escape, ⌃ control, ⌥ option and ⇥ tab. In the middle,
scrolling sideways: twelve pair keys, each with two symbols. A tap types the
top symbol. A touch dragged down types the bottom one, and a bubble over the
key shows which symbol the release will type. At the right, fixed: the four
arrows, Panes, which opens the Panes picker, ⌘ command, and Keyboard, which
shows or hides the system keyboard. ⌃, ⌥ and ⌘ are *sticky*: armed by a tap,
and spent on the next key from either the row or the system keyboard. ⌥ is
tmux's `M-`. ⌘ makes the next letter a Shortcut. While the Composer is open,
or with no Connection, the keys are disabled.
_Avoid_: Dock (the old name), Key Bar (the old middle), toolbar, tab bar,
bottom bar, modifiers

**Shortcut**:
What ⌘ and a letter do on the phone. ⌘c copies the active Pane's text, as Copy
Pane text does. ⌘v pastes the clipboard into the active Pane and presses
nothing after it, as Paste in a Selection's menu does. iOS asks "Allow Paste"
for ⌘v each time, because the app reads the clipboard by itself there; Paste
in the menu is the system's own, and iOS asks nothing for it. For both, text
goes in as it is, and an image goes up to the Host as the Composer sends an
Attachment, with its path pasted. Text goes through a
tmux buffer with bracketed paste, so a program that asked for bracketed paste
gets many lines as one piece and runs none. For text with a line break into a
program that did not ask, the phone asks first, because that program runs
each line as the line arrives. ⌘k clears the active
Pane: the program in it draws its screen again and the Scrollback goes. ⌘ and
any other key is that key.
_Avoid_: hotkey, command (on its own)

**Composer**:
The place to prepare a message for a Pane before sending it: multiline text,
images pasted or chosen from Photos, and files chosen from Files. Opened from
Compose at the top of the Options menu, which reads Close composer while it is
up. Send submits the message and leaves the Composer open for the next one;
closing it keeps the Draft.
_Avoid_: terminal input (which sends keystrokes immediately)

**Draft**:
One Pane's unsent text and Attachments. Follows that Pane across navigation and
reconnects for the life of its Attach. Switching Panes changes which Draft is
shown. Successful Send clears it; a failed Send keeps it. Drafts do not survive
an app restart.

**Attachment**:
An image or file included in a Draft. Can be previewed when it is an image,
removed, or retried when preparation fails. Send copies it to the Host and
includes its remote path in the message delivered to the Pane.

**Banner**:
The Terminal Screen's one kind of notice: a Liquid Glass card that slides in
under the Header, the way iOS delivers a notification over whatever is on
screen. It says what the Attach is doing while that is anything other than
connected — Connecting, Reconnecting, a disconnect reason with Reconnect where
retrying could work — and it is where the changed-host-key warning is shown.
Drawn in the Theme's appearance, not the phone's, so a light phone never puts a
white card over a Dracula terminal. Not a toast: it stays while the thing it
reports is true and leaves when it stops, rather than timing out.
_Avoid_: toast, notification, snackbar, alert (that is the system's modal)

### Diagnosing

**Log**:
Muxify's own record of what it decided, kept in memory for the life of the
app and carried out by the user: a long press on a Host in Settings, and Copy
log in the Terminal Screen's Options menu, put it on the clipboard with a head
saying what is attached and how the Attach stands. Every module that makes a decision
a screen cannot show says so in one line — which Pane got a Surface and when
it reported its grid, what the Topology became and why, what went down the
Control Connection and what tmux answered, what the Terminal Screen put on
screen. It says what the app *did*, never what the user typed or the Host
showed: keystrokes go out as a byte count, and Pane content is not in it at
all, so a Log can be pasted anywhere. Bounded, oldest lines first to go. See
ADR 0010.
_Avoid_: console (which nobody holding the phone can see), trace, telemetry
(nothing is sent anywhere), debug output
