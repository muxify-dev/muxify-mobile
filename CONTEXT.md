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
Session name, current Topic and its last read, and a view per Pane. It outlives
every screen that draws it. A Session switch sets its Session and Topic together.
A plain pick of the current Session changes nothing. A different Session keeps
the Topic when the last Topic read includes it. An unrelated Session clears the
Topic. An explicit Topic pick sets that Topic. Last Place stores the result.
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
the Attach currently holds, if any. The app writes it each time an Attach reaches its
attached phase or switches Session, and clears it on Disconnect. With Reconnect
on start on, a cold start opens it again behind a "Trying to reconnect" screen.
A Disconnect means "do not take me back", so the next cold start opens Home.
_Avoid_: last session, resume point, saved state

The Host Screen has its own list choices, reached from Configure panels in
its Options menu. Each Host stores its enabled lists and their order independently.
On upgrade, existing Hosts receive the previous global choices once. A new
Host uses the default Recent Sessions and Sessions lists. The same settings
screen has separate Title chooser choices for this Host. Each view keeps its
own enabled lists and order.

The Host Screen has one Options menu. New Session and New Topic follow the
order of the Sessions and Topics panels. A disabled panel's action comes last.
Recent Sessions does not change this order. Configure panels follows them.
Edit Host is in Settings.

**Home**:
The list of saved Hosts, in the order set in Settings. Each row shows the Host
name and address.
A tap opens the Host Screen. Home does not read remote Listings.
The fixed navigation order is Home, Host Screen, then Terminal Screen.
Native Back has a chevron only and moves up one level without ending the Attach.
Cold reconnect and direct Terminal entry construct the same parent screens.
Adding, editing, deleting, and ordering Hosts is in Settings.

**Listing**:
What a Host last said its Sessions were. The Host Screen asks again every time they come back into focus — a sheet closing over it, a return from the Terminal
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
the phone's screen with the keyboard down. While the active Pane uses the
alternate screen, it fits above the keyboard instead. Returning to the normal
screen restores the full height even if the keyboard stays up (ADR 0008). Under tmux's `window-size latest` the Window takes the size of the
latest Client, and a laptop that types becomes it. So Muxify claims the Window
with every size it asks for, and again on the next key typed on the phone after
another Client has taken it.
_Avoid_: viewer, terminal, connection

**Slide**:
How far the Window is pushed up under the keyboard, so the row being typed on
stays above the keys: nothing for a Pane with three lines on it, everything the
keyboard covers for a Pane full to its last row. On the normal screen, the
Window keeps its full height and the Slide hides the covered part. The top
clip edge hides a partial row. On the alternate screen, the Window fits above
the keyboard and needs no Slide. A Selection holds the Window size and Slide
until it ends.
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
a tmux restart. The Host Screen shows it dimmed, with "No live Sessions". The
phone offers Reopen, Start Fresh and Cancel when its card is tapped. After a
successful wake it reads the Topic once and opens a Session. A failed read can
be retried without another wake. The long-press menu wakes it in place and
refreshes the Listing.
_Avoid_: inactive, sleeping, suspended

**Empty**:
An open Topic that has no live Session and remembers no Session: the user
stopped, removed or moved away its last Session. The Host Screen shows it dimmed,
with "No live Sessions", the same as a Dormant Topic. A tap opens Add a Session.
Cancel leaves the Empty Topic on the Host.
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

**No Topic**:
The Sessions on a Host that belong to no Topic. With Topics on and the Sessions
list off, the Host Screen shows them in a separate group after the Topics and
the Bench. Its No Topic row shows the count and opens to list the Sessions.
Recent Sessions are left out when that list is on. An empty group is not shown.
_Avoid_: ungrouped Sessions, other Topics, Bench

**Tag Mark**:
A small square in the colour of one Tag, at the end of a Topic card. The colour
is the Tag's light or dark value for the app's appearance. A Tag the Config no
longer defines, or a colour the phone cannot read, shows as a dashed square.
_Avoid_: tag chip, tag dot

**New Topic**:
The sheet that makes an Empty Topic on a Host, as New Topic on the Mac does. It
has a title and one button for each Tag of the Host's Config, in
Config order and in the Tag colour. Save opens Add a Session for the new Topic. That sheet confirms the Topic was
created and offers Add later. An existing Topic keeps Cancel. An
error from the Host shows in the sheet, and the sheet stays open. The Host
Screen Options menu always offers New Session and New Topic.
New Topic reads Config Tags when it opens. A failed read offers Retry Tags
and keeps the entered title.
_Avoid_: Create Topic, Add Topic

**Edit Topic**:
The sheet that Options > Topic > Edit Topic opens. It changes the title, the Topic
Note and the Tags. Save sends only the fields that differ from what the Host
last had, so a phone edit does not undo a different edit made on the Mac. A
field the Host refuses shows its error under it, the sheet stays open, and the
next Save sends only what still differs. A Tag that the Config no longer
defines shows dashed and can only be removed. The sheet reads the Config Tags
even when the Topics list is off. A failed read offers Retry before editing.
The Attach refreshes the Topic after Save and when the sheet closes.
_Avoid_: Topic settings, Topic properties

**Add a Session**:
The sheet that an Empty Topic card or Options > Topic > Add a Session opens.
It reads the Host's folder choices once and groups them as In this Topic,
Session Paths and Worktrees. Search matches names, paths, branches and Also in
Topic labels. A tap selects a folder without a write. Create and open makes a Session at
that folder and opens it in the Attach.
The final row uses a typed folder, where a leading `~` is the Host's home folder.
It does not create a Worktree or move an existing Session. An old Host CLI
instead shows a Folder field and Create and open. Other read failures show Retry and keep
typed entry available. A Host write error keeps the sheet open. If entry fails
after creation, Retry Attach uses the saved Session name and sends no second
write. Cancel leaves any Session already made on the Host. Folder actions stay
disabled after creation. Cancel and dismissal are disabled while creation or
Attach runs.
_Avoid_: New Session (that sheet makes a Session in no Topic)

**Reopen**:
The Mac's Reopen Topic, which the phone asks of the Host with `muxify topic
reopen`: it makes the remembered Sessions, Windows, Tabs and Agents of a
Dormant or Settled Topic again. The Host answers when the Sessions and Windows
exist, before the Agents are up.
_Avoid_: Restore, Resume, Wake (the phone's word for Reopen and Start Fresh together)

**Start Fresh**:
The Mac's Start Topic Fresh, which the phone asks of the Host with `muxify topic
start-fresh`: it makes one Session with one shell Window in each Session Path
that a Dormant or Settled Topic remembers, with no remembered Windows, Tabs or
Agents.
_Avoid_: Reset, Restart

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
from ⌘V on a hardware keyboard; removing the layer of a surface it frees, which
ghostty leaves in the view with a pointer to the freed renderer, a crash on
the way back from a screen pushed over the Terminal Screen; and two promises
about its own readiness — nothing written to it is lost, and every
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
sideways than up or down. It is a swipe when the finger lifts past the commit
point, a quarter of the Surface's width from where the drag began, or lifts
faster than 600 points a second the way the drag went. The phone gives one
light tick each time the drag crosses the commit point, out and back. In a
zoomed Window the Pane follows the finger: with it up to the commit point,
more slowly after. On a swipe it goes off the side, and the next Pane comes in
from the other side when its Surface has reported its grid. On no swipe it
springs back. Behind the Pane that moves is the terminal background. In a
Window that is not zoomed no Pane moves. Every other drag is vertical and
moves the Scrollback, or is the wheel for a program that listens for the
mouse. That program gets nothing from a horizontal drag. While a Selection is
open a horizontal drag is for its handles and changes no Pane. The system's
back swipe is off on the Terminal Screen except at the left edge, because it
is the same drag as a swipe right.

On iPad, a continuous two-finger scroll on a physical trackpad uses the same
axis lock and Pane Swipe thresholds. A horizontal gesture cycles from the
active Pane, including when the pointer is above an inactive Pane or at the
Terminal area's left edge. A vertical gesture scrolls the Pane under the
pointer when the gesture starts. It keeps
that Pane and its grid until the gesture ends. It does not select or focus the
Pane. Fractional lines belong to that gesture only. A vertical gesture during
a Selection scrolls only the Selection's Pane. A horizontal gesture during a
Selection changes no Pane.

Trackpad gestures stop when the Attach, Session, Window, active Pane or Layout
changes, when the app becomes inactive, or when the Terminal Screen loses
focus. They are disabled while the Composer or a sheet is open, during a Pane Swipe
transition, and while disconnected. Direct touch and click-drag do not enter this
trackpad path. Trackpad gestures add no momentum after release.

_Avoid_: page, slide (that is the keyboard's), flick

**Layout Map**:
The small diagram in the top right of the Surface area: the Window's Layout,
with the active Pane in the accent colour. It shows which Pane the zoomed
Window is on, and it follows a Pane Swipe. A tap opens the Panes picker. A
Window with one Pane has no map.
_Avoid_: minimap, Pane indicator, thumbnail

**Header**:
The native bar at the top of the Terminal Screen. It owns the top safe area,
with Back on the left, the title in the middle and Options on the right.
Back goes to the Host Screen and leaves the Attach alive (ADR 0007). The content area starts
below the Header. The title is the Session name over the program that runs in
the active Pane, as tmux's `#{pane_current_command}` names it. For a Session
opened from a Topic, it is the Topic title over one line with the program and
the Session name in the dim tone.
The program follows the Topology. The app reads the Topology again when the
active Window is renamed, when the Title Sheet opens, and after the existing
tmux verbs that request a read. A Window with a fixed name can show the program
of the last read. Opening Options does not start a read. A tap on the title
opens the Title Sheet. The red line under the Header reports a failed Pane
command. It is not a Banner and always shows. The Connection is fine, but one
command failed.
_Avoid_: title bar, toolbar

**Title Sheet**:
The chooser opened by the Header title or its down chevron. Each Host has its
own enabled lists and their order, separate from the Host Screen panels.
Windows is the default. Sessions includes previews and marks the current
Session. Topics can be enabled separately. The first enabled list opens first.
A single enabled list has no tab control. Configure chooser in Terminal
Options opens these settings. A Session pick uses the Attach's Topic membership rules.

Windows shows the current Session's Windows. With a Topic, it shows the full
title, Topic Note and Tags, then each live Session's Windows and Agent marks.
The current Session uses its live Topology. The Attach reads the Topic when
the chooser opens or returns from a form. A failed read keeps the last answer
and offers Retry. A Window pick switches Session when needed and selects that
Window. Browser Tabs for the current Window appear below these rows.

Topics shows the Host's Topics with the Bench open. A live Topic opens its
chosen Session in the current Attach. A Dormant Topic offers the wake choice.
An Empty Topic opens Add a Session. Closing and reopening the chooser returns
to the first enabled list.
_Avoid_: Windows picker, Windows sheet, Topic sheet

**Browser Tab**:
One page that is open in a Window's Browser on the Host. The Browser and its
Tabs are desktop Muxify's, and the phone reads them through `muxify browser
tabs` for one Window, named by tmux's id. Each Tab has a URL, a title and
whether it is the Tab that the Browser shows. The phone lists a Tab only when
its URL is http or https at a Tailscale address: a `*.ts.net` name, or an IPv4
address in 100.64.0.0/10. Other Tabs, such as `localhost` and public sites,
are not shown. A Host with no desktop Muxify, or whose Muxify does not show
the tmux server, lists no Tabs. See ADR 0015.
_Avoid_: page, link, bookmark, browser tab (in lower case, for the term)

**Web View**:
The screen that a tap on a Browser Tab opens, over the Terminal Screen. It
loads the Tab's URL on the phone, so it shows what the address serves and not
the state of the Tab on the Host. Its title is the page's title. Reload, and a
pull down on the page, load the page again. A page that does not load shows
the reason and **Try again**. Back goes to the Session, which stayed attached.
_Avoid_: browser (that is the Host's), in-app browser, preview

**Options**:
The Header's ⋯ menu starts with Compose. For an Attach with a Topic, Topic
follows with Edit Topic and Add a Session. Then come Zoom Pane, New Window, Split
Pane (Split → and Split ↓), Font size − and +, Copy Pane text, then Copy log
and Disconnect. Font size changes the setting live, and the Surfaces reflow to
it. Copy Pane text puts the active Pane's text on the clipboard, plain and
with its wrapped lines joined. Disconnect ends the Attach, clears Last Place, and returns to the Host Screen.
_Avoid_: menu (on its own), actions, overflow

**Accessory Bar**:
The modifier-key row (ctrl, esc, tab, arrows) that `expo-libghostty` draws above
the system keyboard. Supplied by the library, not built by Muxify, and visible
only while the keyboard is up. Muxify turns it off; the Key Row is what stands
in its place.
_Avoid_: Toolbar, key bar

**Key Row**:
Muxify's own Liquid Glass row pinned to the bottom of the Terminal Screen,
riding the keyboard: the keys a phone keyboard does not have, in one capsule,
three sections. At the left, fixed: ⎋ escape, ⌃ control, ⌥ option and ⇥ tab.
In the middle, scrolling sideways: twelve pair keys, each with two symbols:
the *main* symbol large, and the *alternate* symbol small and grey above it. A
tap types the main symbol. A touch dragged down types the alternate one. As
the touch moves down, the main symbol drops out of the key and the alternate
one grows into the centre of the key, in the key and in a bubble over it.
The drag is complete at 14 pt, and the release types the large symbol, then
the key springs back. The pairs fade
at an end while there are more past it. At the right, fixed: the arrow key,
Panes, which opens the Panes picker, ⌘ command, and Keyboard, which shows or
hides the system keyboard. On iPad, over a docked keyboard, the row is not a capsule
but a full-width strip on the keyboard's top edge, and all twelve pairs fit
without scrolling. Over a floating or split keyboard, or with none, it is the
capsule. The arrow key is one key for the four arrows: a
touch sends nothing, a drag of 12 pt sends the arrow it points at, a hold
repeats that arrow until the finger lifts, and moving the finger to another
side changes the arrow. VoiceOver has an action for each arrow. ⌃, ⌥ and ⌘ are *sticky*: armed by a tap,
and spent on the next key from either the row or the system keyboard. ⌥ is
tmux's `M-`. ⌘ makes the next letter a Shortcut. While the Composer is open,
or with no Connection, the keys are disabled. The glass and key frames stay
fixed during touch. A physical keyboard hides the row. iOS supplies its
initial state, connection changes, and a fresh state on foreground entry.
Hiding the software keyboard alone does not hide the row. Hiding the row
clears armed modifiers and stops arrow repeat. Options keeps Panes and
Keyboard available. Software keyboard clearance belongs to the Terminal
Screen and remains when the row is hidden.
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
Muxify's own record of what it decided. The app keeps recent entries in memory
and saves bounded files for the last five launches. Settings > Logs shows the
current launch, previous launches, and iOS diagnostic reports when iOS supplies
them. A saved launch does not prove a crash. A force quit or system stop can
leave the same record. Copy log carries a selected report to the clipboard.
The Terminal Screen's Copy log still includes the current Attach state.

The Log records decisions about Surfaces, Topology, sizing and Connections.
It excludes keystrokes, Pane content and credentials. JavaScript error reports
include a bounded message, stack and component stack. The original React Native
error handler still runs. A native crash can leave only the events recorded
before it. MetricKit supplies separate native diagnostic reports when available.
Reports stay on the phone until the user copies them. See ADR 0010.
_Avoid_: console (which nobody holding the phone can see), trace, telemetry
(nothing is sent anywhere), debug output
