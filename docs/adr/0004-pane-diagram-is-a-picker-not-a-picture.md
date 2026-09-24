# The Pane diagram is a picker, not a picture

The Panes sheet draws the Window's splits so a Pane can be chosen by pointing
at where it is. Two decisions about that diagram, both taken from `remux` after
the honest version was tried and looked bad.

## Equal weight, not tmux's proportions

The diagram divides each split by **how many Panes are on each side**, not by
the cells tmux gave them. A Pane holding four rows of a forty-row Window is a
sliver: too small to label, too small to tap, and the sheet is a picker before
it is a picture. Equal weight keeps every Pane worth pointing at while the
*arrangement* — what is above what, what is beside what — still reads as itself.

The arrangement is recovered from tmux's real geometry by finding a guillotine
cut and recursing, which rebuilds the split tree tmux wrote in the first place.
So the real coordinates are still needed; they are just not drawn to scale. See
`paneTopologyFrames`.

## No Pane contents in the tiles

Window tiles show what the Window is displaying, because a Window called "bash"
among three others called "bash" is otherwise not a choice. Pane tiles show
nothing of the kind: the Panes are all on the screen behind the sheet already,
so the question is which one you mean, not what is in it.

Four tiles of six-point terminal text is a picture of a wall. The working
directory and the running command are what tell two Panes apart, and they fit at
a readable size. This also drops a `capture-pane` round trip from opening the
sheet.

## Consequences

The diagram is not a faithful map. A user who resizes a Pane will not see the
diagram change, and one who reads it as a preview of their layout will be
wrong about the proportions — the tiles say *which*, never *how big*.

`#{pane_title}` is not shown at all. It is the Host's name on every Pane of a
Session, which made every tile identical; `#{pane_current_path}` replaced it.
