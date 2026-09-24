# Control mode

Move Muxify off `tmux attach` and onto `tmux -C attach`, speaking the control
protocol in TypeScript. See [ADR 0006](../../docs/adr/0006-tmux-control-mode-in-typescript.md)
for the decision and the measurements behind it; this file is the shape of the
work.

## The point

Attaching a real client forces Muxify to borrow three Session options —
`status`, `window-size`, `mouse` — which are visible to every other Client and
outlive the Connection. A control client borrows nothing. Measured against tmux
3.7c: after a control client attaches, `show-options` on the Session lists only
what `new-session` put there.

The laptop keeps its status line while the phone is attached. That is the
whole of it.

## What stays the same

- One Surface, one Pane. Muxify already attaches zoomed.
- The Layout string. `%layout-change` carries the same `#{window_layout}`
  `layout.ts` already parses.
- Every screen above the terminal: Hosts, Host detail, Settings, the Dock.

## What changes

- **Attach** stops being a PTY channel running `tmux attach` and becomes a
  Control Connection: one SSH channel running `tmux -C attach`, carrying both
  commands and Pane output.
- **Control Command** stops meaning a one-shot exec channel. Commands go down
  the Control Connection and are correlated by `%begin`/`%end`.
- **Input** goes through `send-keys -H`, so tmux's prefix key never fires.
- **Topology** is pushed by notifications rather than polled.
- **Scrollback** is rendered from `capture-pane` rather than driven through
  tmux's copy-mode, so nothing needs `mouse on`.

## What is given up

Nothing that was there. Muxify shows one Pane because it mounts one Surface,
and `expo-libghostty` will hold several — verified on the simulator. Control
mode is in fact the thing that makes a real split *possible*, since `%output`
arrives per Pane; see ticket 08, which is not in scope for the migration.

What stays out of reach is a live screen for a Pane with no view on it, so
thumbnails of Panes nobody is looking at need remux's forked headless terminal.
`capture-pane` is the substitute.
