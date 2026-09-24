# Control Commands instead of tmux control mode

> **Status: superseded by [ADR 0006](0006-tmux-control-mode-in-typescript.md).**
> The premise below — that control mode needs `ghostty_tmux_client_*` — holds
> only for keeping live screens for Panes that have no view on them. Speaking
> the protocol needs no native support, rendering Panes needs only a Surface
> each, and control mode borrows no Session option.

`remux`, the native Swift app this project probes, drives tmux with control mode
(`tmux -C`) and lets Ghostty's C API parse the protocol, reconcile state, and
project panes. Muxify cannot: `expo-libghostty` exposes exactly one component,
three ref methods (`write`, `writeText`, `finish`) and two events (`onInput`,
`onResize`) — none of the `ghostty_tmux_client_*` surface remux depends on.
So Muxify runs `tmux attach` on a normal PTY Shell Channel and reads Topology or
switches the attached client with one-shot Control Commands on separate SSH exec
channels.

## Considered Options

- **Port the control-mode parser to TypeScript.** Rejected: reimplementing a Zig
  protocol parser and topology reconciler is larger than the rest of the app
  combined, and it is the part most likely to be subtly wrong.
- **Drop to passthrough** — send tmux's own keybinds (`prefix + s`) and let tmux
  draw `choose-tree` inside the Surface. Rejected: unreadable on a phone, and it
  removes the only reason to build a mobile client rather than use Blink.

## Consequences

Pickers are native and cheap, but Muxify never holds a live model of the
Topology — each picker re-reads it. Pane thumbnails and multi-pane rendering are
impossible, because only one Surface exists and it shows whatever the attached
tmux client draws. Switching a Window is a Control Command; the Shell Channel
just redraws.
