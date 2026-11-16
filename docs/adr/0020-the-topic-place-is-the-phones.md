# The Topic Place is the phone's

When the user opens a Topic again on the phone, the phone takes them back to
where they were in it: the Session, the Window, the Pane and, if the Web View
was on top, the Browser Tab and how far the page was scrolled. That place is
the Topic Place. The phone keeps one for each Topic of each Host, in its own
records file, next to the Last Place. tmux and the Host CLI do not keep it, and
the Mac does not see it.

## Why on the phone

- **tmux's active Window is shared.** A Session has one active Window for every
  Client. The Mac and each other Client move it, so on the phone's return it
  says where the Mac was, not where the phone was.
- **The Mac keeps its last Window only in memory.** There is no record on the
  Host that a phone could read and that would also follow the Mac.
- **A Place shared with the Mac needs a new Host CLI and a desktop release.**
  The user wants this on the phone now, and nothing on the Mac asks for it.

## What it does

- The Attach (ADR 0007) is the only writer. It writes the Topic Place through
  the same serialized writes as the Recent Session and the Last Place, when the
  Session, the active Window, the active Pane or the shown Tab changes. It does
  not write during a Session switch or a restore, because the Window that tmux
  shows then is one that the user only passes through.
- The Web View tells the Attach which Tab it shows and gets a token. Back
  returns the token and clears the Tab. A Topic change makes the token stale, so
  the Web View that the change dismisses leaves the old Topic's Tab in its
  Topic Place.
- Opening a Topic (a Topic card, the Title Sheet's Topics, a cold start with a
  Last Place Topic, a wake after Reopen) prefers the Topic Place's Session while
  the Topic lists it live. The Attach then selects the Window by tmux's id,
  else by index and name, because Reopen makes the Windows again with new ids.
  It selects the Pane when that Window still has it, with the Zoom carried as
  the Panes picker carries it. The Terminal Screen reads the Window's Tabs and
  opens the Web View when the Host still lists the Tab, or when the read fails.
- A Disconnect keeps the Topic Places. It means "do not take me back on a cold
  start", which is the Last Place's job. Deleting a Host removes its Topic
  Places.

## Considered and rejected

- **A tmux Session option.** It is shared with every Client like the active
  Window, so the Mac would write it too, and the phone would need a write to
  tmux for every move.
- **The Topic record on the Host.** The phone never writes the record files
  itself (CONTEXT.md, Topics). It would need a new Host CLI command and a
  desktop Muxify that keeps the field, for a value that only the phone reads.

## Consequences

**The Mac moving tmux's active Window does not move the Topic Place** while the
phone is in another Topic or not attached. While the phone is attached to the
Topic, the phone shows what tmux shows, and that is where the user is.

**A Tab the Host lists no more is dropped.** The phone stays on the Pane and
clears the Tab from the Topic Place.
