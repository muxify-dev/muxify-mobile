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

## Where Copy log is now

Copy log is a long press on a Host in Settings, under Hosts. It left the
Host Screen's Session rows when Home became the front door and the Hosts moved
to Settings. The report and its head are the same.

## Crash diagnostics, November 2026

The user reported crashes from the installed iPhone build. The previous choice
to keep the Log only in memory removed the evidence at the moment it was needed.
This replaces the memory-only storage decision and the deferred viewer decision.

The app appends each Log entry to a local file before returning to its caller.
It keeps five launches, each with the two most recent 256 KiB file segments.
A new launch uses new files. An incomplete last record is ignored on read.
Disk errors leave the memory Log available and show a storage notice in Logs.
No timer is the only path to disk, and each entry appends instead of rewriting
the growing file.

Settings > Logs shows saved launches and lets the user view and copy a report.
A saved launch is not called a crash. iOS can stop the app, and the user can
force quit it. Neither event proves a fault. Old files expire under the fixed
retention limit. Nothing sends these files to a service.

The bootstrap installs JavaScript error hooks before loading Expo Router.
React Native 0.86 has native and JavaScript exception pipelines. The app uses
the native exception listener and the JavaScript exception decorator. The
decorator returns the original report unchanged. Neither path replaces the
read-only runtime handler or prevents its response. Console messages and
nonfatal reports are not collected. Error
messages and stacks each have a 16 KiB limit. Existing Log callers still omit
keystrokes, credentials and Pane content.

A local Expo module registers a MetricKit subscriber at native startup. It saves
up to ten diagnostic payloads, with a 2 MiB limit per payload. Atomic writes
protect each saved report. iOS decides when reports are supplied, so an empty
list does not prove that no crash occurred. The Logs screen states this limit.
The module does not install a custom signal handler or claim it can recover
the app Log from a build that never saved it.

The JavaScript archive and error forwarding have automated tests. The installed
app must also prove log survival after termination and restart. MetricKit report
delivery requires a physical-device check and is not proven by a simulator.
