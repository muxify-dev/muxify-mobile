# The Host Screen has the Mac's two views, and Go to

To start a Topic from a Session Path on the phone took three sheets: New
Topic, Save, then Add a Session with Create and open. New Session took a name
and no folder, so the Session started in the home folder. The Host Screen
showed up to three lists, which the user chose for each Host in Configure
panels. The Mac shows two views, Topics and Sessions, and has Go to… and New
Topic (⌘N) for the same work.

[ADR 0032](0032-the-host-ranks-go-to.md) updates the Go to list and its ranking for a Host Server with `go-to`.

## Decision

The phone follows the Mac.

- **Tabs.** The Host Screen has the Topics tab and the Sessions tab. The
  Host's Config decides which tabs show (`sidebar.topics`, `sidebar.sessions`
  in `environment show`). Configure panels and its settings go. The phone
  keeps only the last tab of each Host.
- **Bench peek.** While the Bench row is closed, the Topics tab shows the
  Benched card of the place the Attach is in. This is the Mac's rule for the
  card of its Location.
- **Go to.** A native bar at the bottom of the Host Screen has a search field
  and a **＋** menu. While the field has the keys, one list stands in place of
  the tab: the running Sessions, then the Session Paths and Worktrees, then a
  typed folder.
- **New Topic** is one sheet with two steps: the title and the Tags, then the
  folder of the first Session.
- **New Session at a folder** takes the place of New Session with a name.
- **Recent Session** is only a memory that ranks. The Recent Sessions list
  and its Forget swipe go.

The Host CLI says that it can do this with the capability `session-paths`.
Without it, the phone shows no bar, and the Options menu has New Session and
New Topic with the sheets from before. So an old Host CLI loses nothing.

## Who ranks the Go to list

The Host ranks the Session Paths, because the Mac has the match (`PickList`)
and the record of the last visit. The phone sends the text of the field with
`session-paths --query` and keeps the order of the answer. The phone tells
the Host each visit (`session-paths visit`), so the Mac and the phone rank by
one record.

The phone ranks the running Sessions. It has them from the Listing, and the
Host does not know which Sessions this phone opened. The Recent Sessions come
first, newest first, and the rest follow in tmux's order. So the list is not
one mixed ranking as on the Mac: the Sessions come first, then the paths.

The answer of the Host can be slow. The phone keeps the last answer for an
empty field for each Host and shows it at once. While the Host has no answer
for the text in the field, the phone keeps the rows on hand that match the
text. A new answer for an empty field does not move rows that are on show.

## What a pick of a path does

The Mac's rule: go to the Session in no Topic that runs at the folder, else
make one there. A Session in no Topic has the name of its Session Path, and a
Session of a Topic has `<name>/<slug>`. So the phone finds the Session by its
name and needs no other read. New Session here always makes one, and the
phone gives the next free name (`+2`), as the Host does.

The pick that makes a Session is a Host Write with a Request id (ADR 0020,
ADR 0021). It replaces the direct `tmux new-session` of ADR 0005 on a Host
CLI with the capability.

## The List Keys have no ⌘

ADR 0022 says that every Keyboard Shortcut holds ⌘. The keys of a list (↑, ↓,
↩, Esc, ⌥↩) hold none. Two ways were possible:

- `onSubmit` and key handlers of each field. The Go to field is the system's
  search bar and the field of New Topic is a SwiftUI field, so there would be
  two ways, and neither gets ↑ and ↓.
- The KeyCommands module. It sees each key before a view, for both fields.

The module takes them. A command now says if it holds ⌘. JS gives the List
Keys to the module only while a list has the keys, so a Pane never loses a
key. The user cannot change them, and they are not in the check that refuses
a Keyboard Shortcut without ⌘. Return on the software keyboard does not go
through the module: the field reports it, and the screen picks the same row.

## What was left out

- New Topic's second step lists no running Session. The Mac moves a running
  Session into the Topic there. The Host CLI has `window move --topic` for one
  Window, and no command for a Session.
- Add a Session for a Topic that exists is the sheet from before.
- The domain code for a Host's rows on Home (`homeSection`, `homeRows`) had
  no caller, because Home reads no Listing. It is removed, and not changed to
  the tabs.

## Consequences

- iOS 26 is the lowest version. The search field in the bottom bar needs it,
  and there is no other control for Go to.
- The settings file loses `hostScreenLists`, `hostListPreferences` and
  `recentSessionsFirst` at the next save. No value moves over: the Config of
  the Host has the choice now.
- A settings file that cannot be read gives the defaults. Before, the load
  with the migration of the lists stopped the app with Retry.
- A Session that the Host no longer has stays in the Recent Session records.
  It ranks nothing, because only running Sessions are ranked.
- Seen on the iPhone simulator, iOS 27.2, Release build, against the Host
  CLI with the capability: the tab control, the bar with the Go to field and
  **＋**, and the Go to list in place of the tab when the field has the keys.
  The module's Swift change compiles.
- Not measured: the focus of the field from ⌘P, and the List Keys on a
  hardware keyboard. The unit tests cover the rules above the module.
