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

The Panes picker can no longer turn zoom off to show a real split: one Surface
cannot render two Panes. Rendering a split needs a Surface per Pane, which is
possible later and is not in scope here.
