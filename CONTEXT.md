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
15 s, when tmux does not answer the Attach's probe within 8 s, a minute
after the last screen read once no Attach holds it, or, when the app comes back
from the background with no Attach on it, when its Host Server does not answer
a ping within 8 s. A Connection that passes the ping stays, and its Listing
subscribes again on it. Muxify writes nothing to the Host Server while the app
is in the background. See ADR 0007, ADR 0012 and ADR 0031.
_Avoid_: SSH session, link, socket

**Host CLI**:
The `muxify` on a Host, which keeps that Host's Topics. The phone and desktop
Muxify read and change them through its Host Server. Both install and update it
in `~/.local/bin`; on a Mac with Muxify.app it is the app's own.
_Avoid_: desktop CLI, desktop Muxify (when you mean the `muxify` command), remote helper

**Host Server**:
The Host CLI serving the phone over one channel of a Host's Connection, for as
long as the Connection lives. Through it the Host Screen and the Topic Screen
show the Host's changes as they happen. When it cannot run, the Host Screen
shows only Sessions and says why Topics are unavailable. When the cause can
pass, as with no answer in time or repeated stops, the next return from the
background, or a use of the Connection a minute later, starts it again. See
ADR 0025 and ADR 0033.
_Avoid_: daemon, remote server, helper

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

**Appearance**:
Whether the app is light or dark: System, Light or Dark, set in Settings.
System follows the phone's own light or dark setting. The app chrome and the
Surface are always the same kind, because a light terminal in a dark app reads
as two apps. See ADR 0018.
_Avoid_: mode, colour scheme (which is the phone's own setting)

**Theme**:
The colours the Surface paints with. Each Theme is light or dark. The user
chooses a Light theme (Solarized Light, Gruvbox Light) and a Dark theme
(Ghostty Default, Dracula, Gruvbox Dark Hard), and the Appearance decides
which one is in use. A change, in Settings or on the phone, repaints the
Surface at once. The Theme's colours are reported to tmux each time the phone
is the screen in use: at Attach, when the user picks a Pane, Window or
Session, on the first key after another screen took the Window, and when the
app comes back from the background. So a program such as NeoVim that asks for
the background gets the colours of the screen whose user acted last. See
ADR 0018 and ADR 0026.
_Avoid_: colour scheme, skin

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
make a Session first, at a folder, from Go to and from the Host Screen's **＋**
menu. Rename and kill are still refused. See ADR 0005 and ADR 0024.

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
memory. It is not a list on a screen. It helps choose the Session that a Topic card opens. On a Host Server
without `go-to`, it also ranks the running Sessions in Go to, newest first. The user cannot remove one, and a memory of a
Session that the Host no longer has changes nothing.
_Avoid_: workspace, saved session, history, Recent Sessions list (the old list on the Host Screen)

**Last Place**:
Where the user was when Muxify last closed: the Host, the Session and the Topic
the Attach currently holds, if any. The app writes it each time an Attach reaches its
attached phase or switches Session, and clears it on Disconnect. With Reconnect
on start on, a cold start opens it again behind the Connection Screen, titled
"Trying to reconnect". Its Topic, when it has one, opens at that Topic's Topic
Place, and a Session with no Topic at its Session Place. When that Place has a
Tab, the cold start opens the Web View right away, with the Connection Screen
over the page until the Session is attached, and no Terminal Screen comes
first; else it opens the Terminal Screen.
A Disconnect means "do not take me back", so the next cold start opens Home.
_Avoid_: last session, resume point, saved state

**Host Screen**:
The screen of one Host. It has the two views of the Mac's Sidebar as tabs. The
Board tab shows Pinned, In Play, the Guests, the Bench row and the No Topic
row. The Sessions tab shows every running Session in the order tmux lists
them, with its Topic under the name, and no Bench. The Host's Config decides
which tabs show, with `sidebar.topics` and `sidebar.sessions`, so the Mac and
the phone show the same views. A Host CLI that does not say shows both. A Host
with no Host CLI, or an old one, shows only Sessions, with a line above them
that says why. One tab has no tab control. The phone remembers the last tab of
each Host. A tap on the tab control changes the tab. So does a sideways swipe
that starts on the tab control or on the bar at the bottom. The two lists
follow the finger as one strip, with the numbers of the Pane Swipe, and the
tab control changes at the commit point, with the tick. A swipe toward no tab
springs back. The list keeps its own drags: a swipe on a Topic card is its
swipe action. Only a drag from the left edge goes back.

The row of the Session that the Attach is on shows the phase of the Attach,
and a swipe on it offers Disconnect.

Each tab starts with the status section, which has no title. It shows what
happens now to the Host or to the list on show, and it goes when that ends:
the Host Problem, "Updating…" and "Not updated" of the Listing, the install or
update of the Host CLI or its failure, and a failed read of the Topics above
their last cards. No other section shows a status row: Pinned shows only the
Pinned cards, and the status section comes before it. A row that stands in
for a list that has nothing to show yet, as "Checking Topics…", stays where
the list will be. The line that says why a Host shows only Sessions stays
above the Sessions, because it does not go away. The phase of the Attach stays
on the row of its Session.

A bar at the bottom has the Go to field and the **＋** menu, with New Topic and
New Session at a folder. The bar does not show while the user moves a Topic
card or fills an Open Place. Home and the Terminal Screen have no bar. The
Options menu has Configure chooser. On a Host CLI that is too old for Go to,
the bar does not show, and the Options menu has New Session, which asks for a
name and no folder, and New Topic, with the sheets from before. Edit Host is
in Settings. See ADR 0024.
_Avoid_: Sessions screen, Host page, Configure panels (the old choice of lists), panels

**Go to**:
The field in the bar of the Host Screen, and the one list it shows in place of
the tab while it has the keys. A Host Server with `go-to` ranks the Topics
and Sessions Sources of the Mac's Go to… palette. The phone sends the query,
the current Session on that Host and any selected Tag. It shows the sections,
rows and matches in the Host's order. A Topic opens its card. A Settled Topic
or Dormant Board Session reopens. A Tag lists the Topics that have it. A
folder typed with a leading `~` or `/` appears after the Host's rows.

On a Host Server without `go-to`, the phone lists its running Sessions first
and then the Host's ranked Session Paths and Worktrees. The phone matches the
running Sessions and puts its Recent Sessions first.

A tap on a running Session switches the Attach to it, with the Attach's Topic
membership rules. A tap on a path goes to the Session in no Topic that runs
there, which has the name of the Session Path. If none runs, the Host makes
one there, and the Attach opens it. A long press on a path offers New Session
here, which makes one more Session there with the next free name (`+2`). Each
Session the phone opens is a visit. The Host records the visit for the
Session, its Topic and its Session Path. An older Host records folder visits.

The phone keeps the last list of each Host for an empty field and shows it at
once. A new answer from the Host does not move rows that are on show: it shows
when the user types or closes Go to. A pick that makes a Session is a Host
Write. It waits for the Connection while the Host Screen has the focus, and
sends nothing after the user leaves.
_Avoid_: search, command palette, quick open, switcher

**New Session at a folder**:
The item of the **＋** menu that shows the Go to list with the Session Paths,
the Worktrees and a typed folder only. A tap always makes a Session in no
Topic there, with the next free name.
_Avoid_: New Session (the old sheet, which asks for a name and no folder)

**Home**:
The list of saved Hosts, in the order set in Settings. Each row shows the Host
name and address.
A tap opens the Host Screen. Home does not read remote Listings.
The fixed navigation order is Home, Host Screen, then Terminal Screen.
Native Back has a chevron only and moves up one level without ending the Attach.
Cold reconnect and direct Terminal entry construct the same parent screens.
Adding, editing, deleting, and ordering Hosts is in Settings.

**Listing**:
What a Host last said its Topics and Sessions were. The Host Server pushes a new
Listing whenever it changes on the Host, and the Host Screen draws it at once:
the answer it holds stays on screen, its rows still tappable, until the next
one arrives. Only the first Listing of a Connection has nothing to show and a
spinner to stand in for it. The phone knows the Listing on screen is the
Host's now while a subscription made after the last doubt has delivered it and
still runs. The doubt begins when the app goes to the background, when the
subscription ends, when the Host Server stops being live, or when the
Connection closes. A push from a subscription that ran before the background
does not end the doubt: only the first item of a new subscription does. The
Host Screen says "Updating…" in its status section only when the phone has not known
the list for 30 s and has asked again for at least 1 s, so a short absence or
a quick answer shows nothing. When the update fails with the list still on
screen, that line becomes "Not updated · <age>" with Retry. The age is from
the last moment the phone knew the list, not from the last push: a Host where
nothing changed for hours sends no push. A tap on a Topic that the newest Listing no
longer has says that the Topic was closed. A refusal with no Listing drops the
list, because a Host that cannot be reached has no Sessions to offer. A Host
that could not be asked at all drops the list too, and the Host Problem says
why.
_Avoid_: sessions (which are the Sessions themselves), fetch, cache

**Host Problem**:
Why the phone could not use a Host the last time it tried: the Host did not
answer, refused the Identity, or presented a key that was refused. One per
Host. The Connections keep it, because every use of a Host goes through them.
Any use that reaches the Host clears it, even one the Host refuses. A screen
shows it in one place with one Try again: a row in the status section of the Host Screen,
and the notice of the Title Sheet. Try again reads the Host again, and the
reads that met the Host Problem do not show it a second time. On the Terminal
Screen the Cover says why the Attach stopped. A refusal from a Host that
answered is not a Host Problem: the screen that asked shows it.
_Avoid_: connection error, offline, unreachable (which is one kind of it)

**Host Write**:
One change the user asks of a Host: New Topic, Edit Topic, a Go to pick that
makes a Session, Add a Session, the menu orders, drops and wakes of a Topic
card, Pin, Unpin, Forget, renaming, removing or killing a Session, renaming
or closing a Window, and Mark All as Read. The user never
sends it again blind: a Host Write that carries a Request is sent one more
time with the same id when no answer came, and any other is not sent again by
itself. While it runs, a second tap is ignored. It ends done, failed or
unsure. Failed means that nothing reached the Host or the Host refused, and
the user can send it again. Unsure means that a command may have reached the
Host and no answer came, or that the Host has the Request in doubt, so the
user checks before sending again: a sheet offers Check, which reads the Host,
and a card reads the Listing again. A sheet reports it in a row at the top of
its form, and a Topic card with a spinner and an alert. See ADR 0020 and ADR 0021.
_Avoid_: request (a Request is the Host CLI command of a Host Write, with its id), save (for the general idea), mutation

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
another Client has taken it. An Attach does not wait for a Surface: until a
Surface reports a grid that has stopped moving, the Client says no size, and
tmux leaves the Window at the size it has. So a Place's Web View, opened with
no Terminal Screen under it, does not resize the Mac's Window.
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

These words come from desktop Muxify and keep its meanings. The phone reads and
changes a Host's Topics only through its Host CLI, and never writes the record
files itself.

**Topic**:
One thing the user wants to get done, such as "Fix reward drop bug in GS". It
groups Sessions with no limit per folder or repository. The Host Screen shows
the Topics of a Host in the order that the Mac shows them.
_Avoid_: task, project, workspace, thread

**Topic Place**:
Where the user was in one Topic on this phone: its Session, Window, Pane and, if
the Web View was on top, the Browser Tab and how far the page was scrolled. The
phone keeps one for each Topic of each Host. It is the phone's own: the Mac
moving tmux's active Window does not move it. The Attach writes it while it holds
the Topic, when the Session, the active Window, the active Pane or the shown Tab
changes. Opening the Topic again goes back to it, also when it is the Topic
that the Attach still holds: the Topic Place's Session
while the Topic lists it live, then its Window by id, else by index and name,
then its Pane. When it has a Tab that the Host still lists, the Web View opens
again; a Tab the Host lists no more leaves the user on the Pane. A Topic picked
in the Title Sheet's Topics list goes back to it too. A Window or Session pick
in the Title Sheet's rows, a Pane Swipe and the Panes picker only write it. A
Disconnect keeps it; deleting the Host removes it. An Attach with no Topic
keeps a Session Place in the same way. See ADR 0020.
_Avoid_: last place (for one Topic), position, bookmark

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
An open Topic that has no live Session but remembers Sessions, or a Board
Session with no live Session, for example after a tmux restart. The Host
Screen shows it dimmed at its place: a Dormant Topic with "No live Sessions",
a Dormant Board Session with "Dormant". The phone offers Reopen, Start Fresh
and Cancel when its card is tapped. After a successful wake of a Topic it reads
the Topic once and opens a Session; after a wake of a Board Session it opens
the Session the Host names. A failed read can be retried without another wake.
The long-press menu wakes it in place and refreshes the Listing.
_Avoid_: inactive, sleeping, suspended

**Empty**:
An open Topic that has no live Session and remembers no Session: the user
stopped, removed or moved away its last Session. The Host Screen shows it dimmed,
with "No live Sessions", the same as a Dormant Topic. A tap opens Add a Session.
Cancel leaves the Empty Topic on the Host.
_Avoid_: Dormant (when it remembers no Session), blank, cleared

**In Play**:
The Mac's limited set of places for the Topics in work now, and the Guests
after them. In Play is always on: it is the only way the Mac and the phone show
Topics. The Host Screen shows the sections Pinned, In Play, Guests, then the
Bench row. A Host CLI that still sends the flat Topics list of a Mac from before
this is too old: the phone treats it as old and offers the update.
_Avoid_: active Topics, focus Topics, WIP limit

**Open Place**:
An In Play place that no card fills. The Host Screen shows it as an empty,
dashed row, so the user sees how many places are free.
_Avoid_: empty slot, hole, free place

**Guest**:
A card In Play above the number of places: a Topic with the Guest mark, or a
Board Session. It shows in the Guests section, after the places. Unpin puts a
card at the end of the Guests.
_Avoid_: visitor, extra slot

**Bench**:
The open Topics that are not Pinned, not Guests and hold no In Play place. The
Host Screen shows them as one Bench row, with no count and no marks, that opens
to show their cards.
_Avoid_: backlog, hidden Topics, overflow

**Bench peek**:
What the Board tab shows of the place the Attach is in while the Bench row
hides it, as the Mac shows the card of its Location. While the Bench row is
closed, the Benched card of the Attach's Topic, or of the live Board Session
it is on, shows under the row. When the Attach's Session is in No Topic, that
Session shows under the Bench row, also while the Bench is open, until the
user opens the No Topic row, which lists it.
_Avoid_: current card, pinned card

**Unread on visit**:
The Mac's rule that showing a Pane makes its Agent read. The phone follows it
while the Terminal Screen has focus, for a Session in a Topic or in none. The
Panes it shows are every Pane of the active Window, or only the active Pane
while the Window is zoomed. While the Zoom preference is about to zoom a
Window again, the phone reads nothing, and reads the one Pane it then shows.
An entry reads every shown Pane: the Terminal Screen comes into focus, or the
Attach moves to another Session. After that, only a Pane that newly shows is
read, such as after an unzoom, a split or a move to another Window. A visit
does not clear a Topic's own Unread. Only a visit to an Empty Topic's page
does, which on the phone is the tap on its card that opens Add a Session. The
phone cannot read the Mac's Config, so it sends these reads also when
`notifications.manual_read` is on. Unlike the Mac, an Agent that finishes
while the phone shows it becomes Unread: the phone reads a Pane only when it
newly shows.
_Avoid_: auto-read, mark seen

**No Topic**:
The Sessions on a Host that belong to no Topic. The Board tab of the Host
Screen shows them in a separate group after the Topics and the Bench. Its No
Topic row shows the count and opens to list the Sessions. An empty group is
not shown.
_Avoid_: ungrouped Sessions, other Topics, Bench

**Tag Mark**:
A small square in the colour of one Tag, at the end of a Topic card. The colour
is the Tag's light or dark value for the app's appearance. A Tag the Config no
longer defines, or a colour the phone cannot read, shows as a dashed square.
_Avoid_: tag chip, tag dot

**New Topic**:
The sheet that the **＋** menu of the Host Screen opens, as New Topic on the Mac
does. It has two steps. The first has a title and one button for each Tag of
the Host's Config, in Config order and in the Tag colour. Return, or Create,
makes an Empty Topic on the Host. An empty title makes nothing, and the sheet
says "Give the Topic a title." The second step is in the same sheet: a search
field and the Session Paths, Worktrees and typed folder of the Go to list,
which the sheet read when it opened. A tap adds a Session at that folder to
the Topic and opens it. A long press offers In a new Worktree. Add later
closes the sheet and leaves the Empty Topic on the Host. The list has no
running Session: Move to Topic… on a Session moves one into a Topic.

An error from the Host shows in the sheet, and the sheet stays open (see Host
Write). A Retry of the same title and Tags, or of the same folder, is the same
Request. If the Attach fails after the Host made the Session, Retry Attach
sends no second write. New Topic reads Config Tags when it opens. A failed
read offers Try again and keeps the entered title. Create does not wait for
the read: before it answers, no Tag can be chosen.

On a Host CLI that is too old for Go to, New Topic is the sheet from before:
Save makes the Empty Topic and opens Add a Session for it, which confirms that
the Topic was created and offers Add later.
_Avoid_: Create Topic, Add Topic

**Edit Topic**:
The sheet that Options > Topic > Edit Topic opens. It changes the title, the Topic
Note and the Tags. Save sends only the fields that differ from what the Host
last had, so a phone edit does not undo a different edit made on the Mac. A
field the Host refuses shows its error under it, the sheet stays open, and the
next Save sends only what still differs. Each field is one Request. A Tag that the Config no longer
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
typed entry available. A Host write error keeps the sheet open. On a Host CLI
that takes a Request id, the phone picks the Session's name, and a second try
at the same folder is the same Request, so it makes no second Session. If entry fails
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

**Request**:
One change that the user asks of a Host through its Host Server, with an id
that the phone makes when the action starts. The Host applies a Request one time: a
second send with the same id gets the answer of the first and changes nothing.
So when the answer to a change is lost, the phone sends the same Request one
more time. If there is still no answer, or the Host says that the Request is
in doubt, the Host Write is unsure: the phone says that the change may have
reached the Host, and gives a way to check. It does not say that the change
failed. In New Topic and Add a Session, a Retry of the same input is the same
Request, unless the Host refused it. A Host CLI that is too old for Request ids gets the change with no id,
and that change is not sent again. See ADR 0021.
_Avoid_: retry (for the second send), idempotency key, transaction

**Board**:
The cards of a Host's open Topics and Board Sessions in one order, as the Mac
shows them: Pinned, the In Play places, the Guests and the Bench. The Host
Screen shows it in its Board tab.
_Avoid_: Topics list, Topics view, Topics tab

**Board Session**:
A Session in no Topic that has a card on the Board, live or Dormant. Its card
can be Pinned, take an In Play place or be a Guest, but it is never on the
Bench. The Host keeps it in its state database, so a tmux restart leaves its
card at its place as a Dormant card. Its long-press menu has Pin or Unpin,
Move Up, Move Down and, when it is not Pinned, Bench, which takes the card off
the Board. A Dormant one also has Reopen and Start Fresh. A live one also has
Rename Session…, Move to Topic… and Kill Session…, which asks first, as the
Mac's card does, and Mark as Read when its card shows a done or failed mark, and Mark as Unread
when it shows no mark, in the menu and in a trailing swipe as on a Topic card.
It has no mark of its own, so both act on the Agents of its Session: Read
clears their Unread, and Unread makes each Agent that is not working Unread.
The Host Screen cannot see whether the Session has such an Agent, so Mark as
Unread can change nothing.
_Avoid_: Locked Session, Lock, Guest Session

**Session Actions**:
The Actions in every menu of a live Session, in the Mac's order: Rename
Session…, Move to Topic…, Remove from Topic for a Session in a Topic, and Kill
Session…, which asks first. A live Board Session's card, a row of the
Sessions tab, a Session card in the Title Sheet and Options > Session all
offer them, once the Host Server's Listing has the Session.
_Avoid_: tmux actions, Session commands

**Move to Topic**:
The sheet that the Session Action Move to Topic… opens. A New Topic… row asks
for a title, then the open Topics but the Session's own follow in Board
order. A tap moves the Session as one Host Write: the Session keeps running,
the Host renames it for the Topic, and a new Topic made from a Board Session
takes its place on the Board. An Attach on the
Session then holds the Topic, so the Terminal Screen shows it and writes its
Topic Place. A refusal keeps the sheet open with Retry, and an unsure move
offers Check, which looks for the Session in the Topic in the Listing.
_Avoid_: Add to Topic, Assign

**Session Place**:
Where the user was in one Session with no Topic on this phone: its Window, Pane
and, if the Web View was on top, the Browser Tab and how far the page was
scrolled. The phone keeps one for each Session of each Host, by the Session's
name, so a renamed Session starts with none. It is the Topic Place's twin, for
an Attach that holds no Topic: the same writes, and opening the Session again
from the Host Screen, from Go to or on a cold start goes back to it in the same
way. A Board Session's card opens a Session with no Topic, so it has one too.
A pick of another Session in the Title Sheet's Sessions list, and Choose a
Session after a Session ended, also go back to it, as a Topic pick in the
Title Sheet goes back to the Topic Place. When the Host's Host Server says
which Sessions the Host has, the phone deletes each Session Place whose
Session is neither live nor a Dormant Board Session. See ADR (draft) "A Place
belongs to a Topic or a Session".
_Avoid_: Session history, last Session place

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
from ⌘V on either keyboard; removing the layer of a surface it frees, which
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

**Back Swipe**:
A drag right that takes a pushed screen off and shows the one under it. Only
the left edge goes back, on every screen: a drag right that starts at the
left edge of the screen. A drag right from anywhere else is the content's. It
scrolls a page, changes the Pane on the Terminal Screen, opens a swipe action
or does nothing. It never goes back. Each layer with its own sideways drag
gives a drag right that starts in the edge band, the 24 points at the left
edge, to the Back Swipe. On the Host Screen, a drag right that starts on the
tab control or the bar at the bottom changes the tab. The Terminal Screen has
no Back Swipe while a Selection is open, because a handle can be at the
edge. On iPad, a two-finger scroll to the right on a trackpad is a Back Swipe
only when the pointer is in the edge band. Back in the Header always works.
See ADR 0034.
_Avoid_: swipe back, edge swipe, pop gesture

**Pane Swipe**:
A horizontal drag of one finger on the Surface. A swipe left goes to the next
Pane of the Window and a swipe right to the previous one, in index order, and
past either end it comes round to the other: tmux's `select-pane -t :.+` and
`:.-`. The Zoom is kept. A drag begins only when the finger has moved more
than 20 points, the slop of the long press that starts a Selection. A finger
held to select that drifts less than that is still a long press, and no drag
takes it. On a Pane of a split that is not the active one, which has no long
press, a drag begins after the tap slop. A drag is locked to one axis when it
begins: horizontal when it sets off more than one and a half times further
sideways than up or down. See ADR 0035. It is a swipe when the finger lifts past the commit
point, a quarter of the Surface's width from where the drag began, or lifts
faster than 600 points a second the way the drag went. The phone gives one
light tick each time the drag crosses the commit point, out and back. In a
zoomed Window the Pane follows the finger: with it up to the commit point,
more slowly after. On a swipe it goes off the side, and the next Pane comes in
from the other side when its Surface has been painted. On no swipe it
springs back. Behind the Pane that moves is the terminal background. In a
Window that is not zoomed no Pane moves. A Window with one Pane has no Pane
Swipe: a sideways drag there gives no tick and is a vertical drag. Every other
drag is vertical and moves the Scrollback, or is the wheel for a program that
listens for the mouse. That program gets nothing from a horizontal drag. While
a Selection is open a horizontal drag is for its handles and changes no Pane.
A drag right that starts in the edge band is the Back Swipe, not a swipe
right. A drag that starts on the Grip is still a Pane Swipe.

On iPad, a continuous two-finger scroll on a physical trackpad uses the same
axis lock and Pane Swipe thresholds. A horizontal gesture cycles from the
active Pane, also when the pointer is above an inactive Pane. A gesture to
the right with the pointer in the edge band is the Back Swipe, not a Pane
Swipe. A vertical gesture scrolls the Pane under the
pointer when the gesture starts. It keeps
that Pane and its grid until the gesture ends. It does not select or focus the
Pane. Fractional lines belong to that gesture only. A vertical gesture during
a Selection scrolls only the Selection's Pane. A horizontal gesture during a
Selection changes no Pane.

Trackpad gestures stop when the Attach, Session, Window, active Pane or Layout
changes, when the app becomes inactive, or when the Terminal Screen loses
focus. They are disabled while the Composer or a sheet is open, during a Pane Swipe
transition, and while keys cannot reach the active Pane (see Typing). Direct touch and click-drag do not enter this
trackpad path. Trackpad gestures add no momentum after release.

_Avoid_: page, slide (that is the keyboard's), flick

**Layout Map**:
The small diagram in the top right of the Surface area: the Window's Layout,
with the active Pane in the accent colour. It shows which Pane the zoomed
Window is on, and it follows a Pane Swipe. A tap opens the Panes picker. A
Window with one Pane has no map. The trial setting "Hide the Panes picker"
hides the map (see Edge Drawer).
_Avoid_: minimap, Pane indicator, thumbnail

**Grip**:
The small Liquid Glass line, 6 × 48 points, at the right edge: in the
middle of a phone's screen, where the thumb rests and just above where the
keyboard comes, so it stays in one place with the keyboard up or down; three quarters down an iPad's. It is on
the Terminal Screen and on the Web View, but not on a phone on its side. The touch lands in a band round it, 28 × 110 points.
From the touch the line fills with the accent colour. A finger that stays
on it for 400 ms with less than 20 points of drift opens the Edge Drawer,
with a tick; the line then glows, and the finger stays down for the
drawer. A finger that
moves 20 points first is a drag: on the Terminal Screen a sideways drag is
the Pane Swipe, as on a Pane that is not the active one. A tap on it does
nothing. The band takes every touch that lands in it, so a page does not
scroll from there. The Grip is off while a Selection is open, while a sheet
is open, and while keys cannot reach the active Pane (see Typing). See ADR
0036.
_Avoid_: handle, edge button, tab

**Edge Drawer**:
The chooser that the Grip opens: a floating Liquid Glass panel at the right
that lists the Destinations of the place on screen, and nothing of other
Topics or Sessions; the Host Screen reaches those. It is the Title Sheet's
second presentation: a pick in it does what the same pick in the Title
Sheet does. Its title is the Topic the Attach holds, or the attached Session
when it holds none. Each Session of the Topic is a header and a rounded
card, as an iOS grouped list has: its Windows in the Title Sheet's order and
marks, the Panes of the Window on screen under it when it has more than one,
and the Browser Tabs of each Window under that Window. The drawer reads the
Tabs of every Window it lists each time it opens, and shows each Window's
Tabs as they arrive. The row that the screen shows has a tint of the
accent: on the Web View the Tab it shows, on the Terminal Screen the active
Pane, or the Window when the Panes are not listed. One row at most has it,
and a shown Tab that the drawer does not list leaves every row plain
(ADR 0038). The
attached Session's card is last, at the bottom by the Grip, and the list
opens at its end. A lift on a Session's header goes to that Session. A pick
of a Tab of another Window goes to that Window first, so the Tab is in the
Place of its own Window. A Pane pick from the Web View goes to the Terminal
Screen; the Live Page is hidden, not ended.

While the finger that opened it is down, the row under the finger is lit,
and the drawer is a quick switch: each lift closes it, and a pick goes on
after it closes. A move that fails says so in the log only. A lift on a row
picks the row. A lift anywhere else picks nothing: on the Grip, in the Lift
Lane, on the header or on no row, or in the Cancel Zone. The drawer has no
close button and no tap. Only VoiceOver, which has no held finger, opens
it with no hold, and then it stays open for its rows to be activated. The finger cannot scroll the
list, so near the list's top or bottom the list scrolls by itself, faster
as the finger goes nearer the edge. The panel ends at the finger that held
the Grip, so the last row is level with it, and is as tall as its list, up
to the top of the screen. It stays above the keyboard and the home
indicator. It does not move with the finger. With VoiceOver it ends at the
Grip's centre (ADR 0037).
On a phone it covers 85 % of the width over a scrim. On an iPad it is a
320-point column with no scrim, and the terminal beside it stays live. A Dormant or Empty
Topic has no live Session, so it is not in the drawer: the Title Sheet or the
Host Screen opens it.

The trial setting "Hide the Panes picker", off by default, hides every way
into the Panes picker: the Layout Map, the Panes key and Options › Panes. So
the Grip is the way to a Pane. The Header title's tap stays at all times.
Zoom and Split keep their own items in Options. Whether to retire them is
decided after use. See ADR 0036.
_Avoid_: switcher overlay, quick switcher, sidebar

**Destination**:
One place the Edge Drawer goes to: a Pane, a Window, a Session or a Browser
Tab.
_Avoid_: target, location

**Cancel Zone**:
While the finger that opened the Edge Drawer is down, the area outside the
drawer's column. It says "Lift here to close", and turns red while the finger
is in it. A lift there closes the drawer and picks nothing.
_Avoid_: dismiss area, close zone

**Lift Lane**:
The 44-point strip at the right of the Edge Drawer, beside its rows, past
the Grip's band, so the finger that opened the drawer starts in it. It is
not drawn: the rows stop short of it, on the bare glass. That finger can
move up and down in it, and a lift there closes the drawer and picks
nothing.
_Avoid_: dead zone, gutter, safe area

**Header**:
The native bar at the top of the Terminal Screen, and of the Web View with
the same title (see Web View). It owns the top safe area,
with Back on the left, the title in the middle and Options on the right. The
bar has no colour of its own. The screen paints the band under it: on the
Terminal Screen the Theme's terminal background, or the chrome while the
Connection Screen covers the Surface, and on the Web View the chrome. So
during a Back Swipe the band moves with its screen, and the screen under it
comes in with its own colour.
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
The chooser opened by the Header title or its down chevron, on the Terminal
Screen and on the Web View. Each Host has its own enabled lists and their
order. The tabs of the Host Screen do not change them. Windows is the
default. Sessions includes previews and marks the current
Session. Topics can be enabled separately. The first enabled list opens first.
A single enabled list has no tab control. Configure chooser, in the Options
of the Terminal and of the Host Screen, opens these settings. A Session pick uses the Attach's Topic membership rules.

Windows shows the current Session's Windows. With a Topic, it shows the full
title, Topic Note and Tags, then each live Session's Windows and Agent marks.
The current Session uses its live Topology. While the Terminal Screen or the
Web View shows the Topic, its Host Server pushes the Topic's detail, and the
chooser draws each push. A Topic that is gone, or a failed push, keeps the
last answer, says why and offers Retry. A Window pick switches Session when needed and selects that
Window. Browser Tabs for the current Window appear below these rows.

Topics shows the Host's Topics with the Bench open. A live Topic opens its
chosen Session in the current Attach. A Dormant Topic offers the wake choice.
An Empty Topic opens Add a Session. Closing and reopening the chooser returns
to the first enabled list.
_Avoid_: Windows picker, Windows sheet, Topic sheet

**Browser Tab**:
One page that is open in a Window's Browser on the Host. The Browser and its
Tabs are desktop Muxify's, and the phone reads them from the Host Server's
`browser_tabs` for one Window, named by tmux's id: the Tabs desktop Muxify
stored in the Window's tmux options. Each Tab has a URL, a title (empty for a
stored Tab) and whether it is the Tab that the Browser shows. The phone lists a Tab only when
it can reach the URL: http or https at a Tailscale address (a `*.ts.net` name,
or an IPv4 address in 100.64.0.0/10), or at a public site such as
`github.com`. It does not list host-local Tabs, such as `localhost`, a name
with no dot or a private IPv4 address, because on the phone that address is
the phone or a network that the phone is not on. A Window whose
Browser has no Tabs, and a Host in Sessions only, list no Tabs. See ADR
0015 and ADR 0017.
_Avoid_: page, link, bookmark, browser tab (in lower case, for the term)

**Web View**:
The screen that a tap on a Browser Tab opens, in the Terminal Screen's place.
It loads the Tab's URL on the phone, so it shows what the address serves and
not the state of the Tab on the Host. Its title is the Header's for the Topic:
the Topic title over one dim line with 🌐, the page's title and the Session
name. Without a Topic, it is the Session name over the page's title. A tap on
the title opens the Title Sheet. A Window pick there goes to the Terminal
Screen. A Session or Topic pick goes there too, or to the page of its Place
when its Place has a Tab. A Tab pick shows that Tab in the same Web View.
Reload, and a pull down on the page, load the page again. A page that does not
load shows the reason and **Try again**. Back goes to the Host Screen, as Back
on the Terminal Screen does, and the Topic Place, or the Session Place for a
Session with no Topic, keeps the Tab, so opening the Topic or the Session again
shows the page again. A cold start whose Last Place has a Tab opens the page
directly, with the Connection Screen over it until the Session is attached. The page stands in the Terminal Screen's place, so the
swipe from the edge shows the Host Screen under it. A Window pick in the Title
Sheet is the way to the terminal: it puts the Terminal Screen back and clears
the Tab. The page it shows is a Live Page, so Back, a pick and another Tab
hide the page and do not end it. **Close Page** ends it: the Terminal Screen
takes its place, and the Tab opened again loads a new page.
_Avoid_: browser (that is the Host's), in-app browser, preview

**Live Page**:
The page that the phone loaded for one Browser Tab of one Topic, or of one
Session with no Topic, on one Host. It stays loaded while the Web View does
not show it, with its form text, its script state and its scroll, so
the Tab opened again by the same owner shows it as the user left it. The same
Tab in another Topic is another Live Page: a Topic never sees what was typed
in another. Only these release it: Close Page, a Tab that the Host lists no
more when a Place opens it, a Listing that no longer has its Topic (the Topic
was settled or forgotten) or its Session, and deleting the Host. A Disconnect
keeps it. Live Pages do not survive an app restart: the Place then loads the
page again at its address and scroll. See ADR 0033.
_Avoid_: tab (that is the Host's), cached page, kept page

**Options**:
The Header's ⋯ menu starts with Compose. For an Attach with a Topic, Topic
follows with Edit Topic and Add a Session. Session follows, with the Session
Actions of the Session the Attach is on. Then come Zoom Pane, New Window, Split
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
Muxify's own strip of keys, docked on top of the software keyboard, or at
the bottom of the Terminal Screen while the keyboard is down: the keys a
phone keyboard does not have, in three sections. At the left, fixed: ⎋ escape, ⌃ control, ⌥ option and ⇥ tab.
In the middle, scrolling sideways: twelve pair keys, each with two symbols:
the *main* symbol large, and the *alternate* symbol small and grey above it. A
tap types the main symbol. A touch dragged down types the alternate one. As
the touch moves down, the main symbol drops out of the key and the alternate
one grows into the centre of the key, in the key and in a bubble over it.
The drag is complete at 14 pt, and the release types the large symbol, then
the key springs back. The pairs fade
at an end while there are more past it. At the right, fixed: the arrow key,
Panes, which opens the Panes picker, ⌘ command, and Keyboard, which shows or
hides the system keyboard. The strip is the same on iPhone and iPad, in the
system keyboard's own light or dark colour, so it reads as the keyboard's top
row. Over a floating or split iPad keyboard it stays at the bottom of the
screen. The arrow key is one key for the four arrows: a
touch sends nothing, a drag of 12 pt sends the arrow it points at, a hold
repeats that arrow until the finger lifts, and moving the finger to another
side changes the arrow. VoiceOver has an action for each arrow. ⌃, ⌥ and ⌘ are *sticky*: armed by a tap,
and spent on the next key from either the row or the system keyboard. The
Surface presses that key with the modifier held, as a hardware keyboard does,
so ⌘ and delete removes the line and ⌥ and an arrow goes one word. See ADR
0003. A chord with ⌘ is first a Keyboard Shortcut, decided as for a
hardware keyboard. While the Composer is open,
or while Typing is not open, the keys are disabled. The strip and key frames stay
fixed during touch. A physical keyboard hides the row. iOS supplies its
initial state, connection changes, and a fresh state on foreground entry.
That state can stay "connected" after a Bluetooth keyboard goes, so the full
software keyboard overrules it: iOS shows that keyboard only when no physical
keyboard is in use, and the row comes back with it until a keyboard connects
again or iOS shrinks its keyboard to the bar it shows for a physical one.
Hiding the software keyboard alone does not hide the row. Hiding the row
clears armed modifiers and stops arrow repeat. Options keeps Panes and
Keyboard available. Software keyboard clearance belongs to the Terminal
Screen and remains when the row is hidden.
_Avoid_: Dock (the old name), Key Bar (the old middle), toolbar, tab bar,
bottom bar, modifiers

**Key Row quick action**:
A choice in the Thumb grid above the Key Row. Hold ⌃ or ⌘ to open its grid,
slide to a tile, and lift to run the action. Lift outside a tile to cancel.
A short tap still arms or releases the modifier. VoiceOver offers each
configured action on its modifier key.

Each grid has four positions. Settings lets the user choose and reorder the
actions for each key. An empty position stays empty. A tile for a Keyboard
Shortcut shows its current binding.

**Keyboard Shortcut**:
A ⌘ chord that does something in Muxify: ⌘, opens Settings, ⌘D and ⇧⌘D split
the active Pane right and down, ⇧⌘H, ⇧⌘J, ⇧⌘K and ⇧⌘L go to the Pane on that
side, ⌘C copies the active Pane's text as Copy Pane text does, and ⌘K clears
the active Pane: the program in it draws its screen again and the Scrollback
goes. tmux finds the Pane on a side, wraps at the edge, and keeps the Zoom.
On the Host Screen, ⌘P puts the keys in the Go to field, ⌘N opens New Topic
and ⌥⌘T goes to the other tab. In the Terminal, ⌘P goes to the Host Screen
with the keys in the Go to field. In the Go to list, ⌘↩ is New Session here
for the row.
Settings > Keyboard Shortcuts changes the key of each one. Every one holds ⌘,
because tmux has no ⌘ to give a Pane, and no two share a key.

The List Keys are not Keyboard Shortcuts. They hold no ⌘, and the user cannot
change them: ↑ and ↓ move the row that Return picks, ↩ picks it, Esc closes
the list, and ⌥↩ in Add a Session adds the Session in a new Worktree. They
work only while the list of Go to, or of the second step of New Topic, has the
keys, where no Pane waits for a key. The KeyCommands module takes them by the
same rule as a ⌘ chord.

One rule, in the KeyCommands module, decides what a ⌘ chord is, for a
hardware keyboard and for the Key Row's ⌘ alike: the Keyboard Shortcut with
that chord, if the screen on top handles one. Any other chord goes on to what
has the keys, and in a Pane that is ghostty, so ⌘ and delete removes the line.
The module sees a hardware chord before any view does; see ADR 0022. Only
those the screen on top can do are offered, so a chord nothing handles still
reaches the Pane. ⌘C is not offered while a Selection, the Composer or a sheet
has the keys, so there it is the system's Copy. On the Key Row, ⌘ and then D
on the software keyboard is ⇧⌘D, and an armed ⌃ or ⌥ counts as held. While
the recorder in Settings listens, no Keyboard Shortcut runs.

⌘V is not a Keyboard Shortcut. On both keyboards it is the system's Paste
into the active Pane, which presses nothing after it. iOS asks "Allow Paste"
for ⌘V from the Key Row each time, because the app reads the clipboard by
itself there; a hardware ⌘V and Paste in the menu are the system's own, and
iOS asks nothing for them. Text goes in as it is, and an image goes up to the
Host as the Composer sends an Attachment, with its path pasted. Text goes
through a tmux buffer with bracketed paste, so a program that asked for
bracketed paste gets many lines as one piece and runs none. For text with a
line break into a program that did not ask, the phone asks first, because
that program runs each line as the line arrives.
_Avoid_: hotkey, key binding, Shortcut (on its own)

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
shown. A sent message stays in the Draft until tmux confirms it on the Pane;
a held or discarded message stays, with the reason. A failed upload keeps it.
Drafts do not survive an app restart.

**Attachment**:
An image or file included in a Draft. Can be previewed when it is an image,
removed, or retried when preparation fails. Send copies it to the Host and
includes its remote path in the message delivered to the Pane.

**Banner**:
The Terminal Screen's one kind of notice: a Liquid Glass card that slides in
under the Header, the way iOS delivers a notification over whatever is on
screen. It says what the Attach waits for over content already painted —
Connecting, Reconnecting, Restoring. A failure is not a Banner: it is a card
in the middle of the dimmed content, with the actions for it (see Cover).
Drawn in the Appearance of the Theme in use, so a light card never sits over
a Dracula terminal. Not a toast: it stays while the thing it
reports is true and leaves when it stops, rather than timing out.
_Avoid_: toast, notification, snackbar, alert (that is the system's modal)

**Typing**:
Whether keys reach the active Pane now. Open, waiting (connecting,
reconnecting, restoring, a Session switch, or a changed Host key that the user
has not accepted), or stopped (a disconnect reason, or closed on purpose). The
Attach decides it and publishes it. The cursor, the keyboard, the Key Row, the
trackpad and the Cover read only it. A cursor shows only while Typing is open,
in the active Pane, after Muxify has painted that Pane, and where the program
in it shows one. The keyboard goes down when Typing stops and comes back when
it opens, if the Keyboard Intent is up. A Pane's first paint is not part of
Typing: before it, the Connection is up and tmux takes keys.
_Avoid_: connected (which is one phase of the Attach), input enabled, ready

**Keyboard Intent**:
Whether the user wants the system keyboard up: `up` or `down`. The Attach holds
it, so it stays through a split, a Pane change, a Composer, a sheet, and a trip
to the Host Screen and back. Only a user act changes it: the Keyboard key, a tap
on the Pane, a hardware keyboard that leaves while the Pane holds the keyboard,
and a Pane that the phone makes (a split, a New Window, a Session made on the
phone), which sets it `up` when tmux has made the Pane. A new Attach starts
`down`, unless the phone made the Pane it opens on. One rule turns the intent
into the keyboard: only the active Pane's Surface holds it, and only while
Typing is open. A hardware keyboard always wants the active Pane. The Composer,
a Selection, a sheet, the Edge Drawer, and another screen hold input
themselves, and the rule touches nothing while they do. A key from any other
Surface goes to the active Pane. See ADR 0039.
_Avoid_: keyboard state, keyboard visible (the system's own fact, which the Key Row reads)

**Cover**:
What the Terminal Screen draws over the Window while Typing is not open, and
before the Attach has painted anything. With nothing painted yet, it is the
Connection Screen: the steps of the connect,
the failure if there is one, and Go to Host. With content painted, it is that
content dimmed, which takes no touch, with a Banner for a wait or a card for a
failure. Each failure has its actions: Try again (Reconnect for a lost link)
where a retry by the user could work, Edit Host where the Host record could be
the cause, Choose a Session for a Session that ended, Accept new key for a
changed key, and always Go to Host. A Session switch dims and says nothing:
the Title Sheet shows it. No Surface shows before its Pane is painted, so an
empty Surface is never on screen.
_Avoid_: overlay, loading screen, error screen, Reconnect Screen (the old name)

**Outbox**:
Every key on its way into a Pane, kept by the Attach until tmux confirms it or
the user has seen what became of it. One per Attach. It outlives each
Connection, so a key typed just before or during a break is not lost. Every
write to a Pane's input goes through it: typed keys, Key Row keys, a paste, a
Composer Send and a clear. Keys do not survive an app restart, and
closing the Attach discards them with a count in the Log. See ADRs 0019 and
0022.
_Avoid_: queue, buffer, pending input

**Lane**:
One Pane's part of the Outbox: its keys in the order typed, and what tmux last
said about the Pane. The keys of a Lane go one Batch at a time.

**Batch**:
One key, one run of typed text, one paste, one Composer Send (its paste and
its Enter together) or one clear, written to tmux under a number (its Seq).
The Outbox has one count of Seqs, which only grows. The Pane keeps the highest
Seq it took, so the Outbox can ask if a Batch arrived, and tmux refuses a Batch
that arrives twice.
_Avoid_: packet, message (which is the Composer's)

**Held keys**:
Keys from before a reconnect that the Outbox does not send by itself: Enter, a
control key, a clear, a paste with a newline, a Composer Send, any paste on
tmux below 3.2, keys older than 30 seconds, or keys for a Pane that runs
another program now. A card above the Key Row shows them as typed, with Send,
Move to Composer and Discard; the open Composer shows the same for its Pane.
Plain text and arrows are sent again without a question. Keys for a Pane that
is gone are discarded, and the card says so until it is dismissed. A discarded
Composer message stays in its Draft, and Move to Composer brings it to the
Pane on screen. Keys that were typed for a new Pane that tmux never made (a
refused or dropped split or New Window) are held on the Pane they were typed
in, behind its other keys, with the same card.

**Verb guard**:
What makes a split or a New Window happen one time across a break. Each verb
gets a number from one count that only grows (its Op), and the Session keeps
the highest Op it took. tmux runs a verb only while the Session's Op is below
the verb's. One verb with no answer is kept through a break and sent again only
when the Session does not have its Op. The Session also keeps the Pane that the
Op made, so the guard ends every verb as made (with that Pane), refused, or
dropped, also after a break. Keys typed between the tap and that end are kept
in a make hold, one for each tap in the order tapped. They go to the new Pane
when the verb is made, and are held on the old Pane when it is not. See ADR 0023
and ADR 0039.
_Avoid_: retry, queue (a verb tapped with no Connection does nothing)

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
