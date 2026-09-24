# The app keeps a Log, and the user carries it out

A Pane came up blank once: no text, no cursor, the Dock's keyboard button doing
nothing, and everything back the moment a sheet was opened over it. It did not
happen again on demand. Everything that could have caused it — a Surface that
never reported its grid, a Topology that arrived with no Panes, a `select-pane`
tmux refused, a Connection replaced under a Surface that had already spoken —
is a decision one module made in the half-second before, and every one of
those decisions was gone by the time anyone was looking. The only account of
the failure was a person's memory of a black screen.

Muxify runs on a phone. There is no console to read, no debugger attached, and
the person holding it is often not the person who can read the code. So the
question was not whether to record what the app does but where the record
lives and how it reaches whoever can act on it.

We decided the app keeps its own **Log** — a bounded, in-memory list of
one-line entries, each saying which part of the app decided what — and that
the user carries it out by hand: a long press on a Session row of the Host
Screen offers Copy log, which puts the Log on the clipboard with a head
describing the Attach as it stands. Every module that makes a decision a
screen cannot show takes a `Log` and speaks into it under its own name: the
Attach, the Topology store, each Pane view, the sizing module, the Control
Connection, the holder, the Terminal Screen and the Host Screen. A module given
no Log is silent, which is what every test gets.

The Log records what the app *decided* and never what the user *typed* or the
Host *showed*. Keystrokes go down the Control Connection as `send-keys -H` and
are written down as a byte count; Pane content is not written down at all;
Session names, Pane ids, grids, phases and tmux's own error text are. That
rule is what makes the Log safe to paste into a chat without reading it first,
and it is the reason the Log is not a dump of the byte stream.

## Considered options

- **`console.log` and read it from Metro or Xcode.** Only works with a cable
  and a laptop, which is never where the failure happens; and it is not there
  at all in a build that was installed rather than run.
- **A Debug screen that shows the Log in the app.** Considered and deferred: a
  screen of two thousand lines on a phone is not how anyone reads a Log, and
  the thing that is done with it is always to send it somewhere. Copy is the
  whole of the need for now; a screen can be added over the same Log later.
- **Send it somewhere automatically.** Rejected: this is a probe of a stack,
  not a product with a backend, and a Log that leaves the phone without being
  asked to is a different kind of thing, with a privacy conversation attached.
- **Write it to a file so it survives a crash.** Deferred. A crash is not the
  failure being chased, and a file adds a write on every line at exactly the
  moments the Log is describing.
- **Structured entries with levels and fields.** Rejected: one method, a tag
  and a sentence is what every call site needs, and a framework would have
  been more code than the thing it was recording.

## Consequences

- Every deep module takes an optional `Log`, and its tests can assert what it
  said as well as what it did. The recording is part of the module's contract:
  the line "not painting yet: no grid" is as much a fact about the Pane view
  as the absence of a write.
- The Log is a ring of two thousand lines. Output chunks, cursor moves and
  Scrollback positions are deliberately not recorded per event, because a Log
  full of them holds nothing else.
- The Log lives for the process and no longer. A failure that kills the app
  takes its Log with it.
- `expo-clipboard` is a dependency, for the one thing the Log has to do.
