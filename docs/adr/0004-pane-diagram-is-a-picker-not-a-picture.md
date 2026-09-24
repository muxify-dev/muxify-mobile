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

## Superseded in part: the tiles are drawn to tmux's proportions

Equal weight was reversed at the user's request: a diagram in which every Pane
is the same size does not answer "which one" when what the user remembers is
"the wide one" or "the little one at the bottom". So each split now divides its
space by the cells tmux gave each side, dividers excluded, and a Pane dragged
wide is wide on the diagram.

What survives of the original reasoning is a **floor**: neither side of a split
is given less than a fifth of the space (`MIN_SHARE`). That is the smallest
tile on which the title and the command both still fit on the sheet's 4:3
well, and the smallest a thumb can be sure of. A four-row Pane in a forty-row
Window is drawn at the floor rather than at a tenth, and the Pane beside it
gives up the difference. The floor is per split, so a deep stack of Panes on
one axis can still go below it — as it could under equal weight, which gave a
five-Pane stack a fifth each and a six-Pane stack less.

The consequence above changes accordingly: the diagram is now a map of
proportions as well as arrangement, with the floor as the one place it lies,
and a user who resizes a Pane sees the diagram follow. "No Pane contents in the
tiles" stands.
