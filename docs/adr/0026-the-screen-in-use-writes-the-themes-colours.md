# The screen in use writes the Theme's colours

> Changes, in [ADR 0018](0018-a-theme-for-each-appearance-reported-to-tmux.md) "A Theme for each Appearance, reported to tmux", the rule that a Pane is told the Theme's colours once per Client and per colours. The rest of ADR 0018 stands.

tmux keeps one Colour Report on each Pane: the last one that any control Client wrote, and it comes before any terminal's own answer. Desktop Muxify writes the Mac's colours too. Under ADR 0018 the phone told each Pane once per Client, so after the Mac wrote over a Pane, the phone never took it back, and coming back from the background wrote nothing. We decide that **the screen whose user acted last writes**, on the phone and on the Mac by the same rules (muxify-shell, "Colour Reports are written without waiting, by the screen in use").

The phone writes the Theme's colours without waiting for tmux:

- **at Attach**, to every Pane of the Session, and to each Pane that appears later, as before;
- **when the user picks a Pane or a Window** on the phone (`selectPane`, `selectPaneToward`, `selectWindow`), to every Pane of the Window now shown;
- **when the user switches the Session** on the phone, to every Pane of that Session;
- **when the app comes back from the background** and the Connection is still open, to every Pane of the Session;
- **on the first key after another screen took the Window.** The phone marks the Window it shows as taken when a focus change arrives there that the phone did not send, when another Client moves into its Session, or when its sizing sees the Window taken. The next key typed on the phone writes every Pane of that Window once and clears the mark, beside `sizing.reclaim()`. A key that finds no mark does nothing more;
- **when another screen's control Client detaches.** A control Client with `ignore-size`, a Listener, is not a screen and does not count.

A Theme change writes every Pane of the Session again, as before.

## Considered Options

- **Tell each Pane once per Client (ADR 0018).** Rejected: the Mac writes over the Panes, and the phone never takes them back.
- **Write on every key.** Rejected: a key costs one check of the mark, and only the key after a hand-over writes.
- **Find the screen in use from tmux.** Rejected: measured on tmux 3.8, a control Client's `select-pane` changes neither its `client_activity` nor the Window's latest Client, so tmux cannot say which screen made a focus change.

## Consequences

- A Pane's colours are those of the screen whose user acted last there, as the Window's size is.
- When the Mac quits, its Listener's detach does not count, but the Mac's last typing resized the Window, so the phone's next key takes the colours back.
