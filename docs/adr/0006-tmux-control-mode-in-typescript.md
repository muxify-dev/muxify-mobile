# tmux control mode, in TypeScript

Muxify attaches a real tmux client and borrows three Session options to make it
presentable — `status`, `window-size`, `mouse`. It will stop. It will drive tmux
with control mode (`tmux -C attach`) instead, speaking the protocol in
TypeScript, and touch no Session option at all.

This supersedes ADR 0001, which read the situation correctly and drew the wrong
line.

## What 0001 got wrong

0001 observed that remux drives control mode through `ghostty_tmux_client_*` —
a Zig implementation in a libghostty fork — and that `expo-libghostty` exposes
none of it. True, and still true: the vendored `GhosttyKit.xcframework` has zero
`ghostty_tmux` symbols. From that it concluded Muxify *cannot* do control mode,
and that the alternative was porting the fork's parser and topology reconciler
to TypeScript — "larger than the rest of the app combined".

That conflated two different pieces of work. The fork earns its size by holding
**a terminal for a Pane with no view on it**:
`ghostty_tmux_client_retain_pane_terminal` keeps live screen state for every
Pane, whether or not anything is drawing it, which is how remux composes
thumbnails of Panes nobody is looking at. That is the expensive part, and it is
not what rendering a split needs — remux draws a split from ordinary surfaces,
one per visible Pane. Muxify can do the same, and can substitute `capture-pane`
for the rest.

What is left, once that is set aside, is a line-oriented text protocol. It was
measured rather than guessed, against tmux 3.7c:

- A control client attaches **with no tty at all** and sets **no Session
  option**. After attaching, `show-options` on the Session listed only
  `default-size`, which `new-session -x/-y` had set. Nothing to borrow, nothing
  to give back, nothing to strand on a force-quit.
- An unsized control client does **not** drag the Window down. A control client
  reporting 80 wide sat on a 120x40 Window and left it at 120x40. Sizing is
  opt-in: `refresh-client -C 40x20` moved it, and only then.
- `send-keys -t %pane -H 65 63 68 6f ...` carries arbitrary bytes into a Pane.
  That is the input path, and it needs no PTY.
- `%layout-change` pushes the same `#{window_layout}` string `layout.ts`
  already parses. `%window-pane-changed`, `%session-changed` and
  `%window-renamed` push the rest. Topology stops being something to poll.
- `capture-pane -pe -N`, with `#{cursor_x}`, `#{cursor_y}` and
  `#{alternate_on}`, reconstructs what is already on a Pane's screen — the one
  thing `%output` alone cannot give, since it only carries what happens next.
- The escaping costs almost nothing. tmux octal-escapes control bytes, which
  inflates the stream 1.29x, and a `charCodeAt` loop un-escapes at 571 MB/s on
  V8. Hermes is slower, but not by the order of magnitude that would matter
  against an SSH channel to a phone. *(Measured again while implementing, by
  writing all 256 byte values out of a Pane: the rule is bytes below 0x20 and
  backslash, as three octal digits, and nothing above 0x7f is touched. 1.26x.)*

None of that needs a native change. The parser 0001 declined to write is a few
hundred lines, not a reimplementation of Zig.

## Why it is worth doing

Because of what the borrowing costs somebody else. `status off` is a session
option, so a phone attaching for five minutes takes the status line away from
the laptop watching the same Session, and `window-size smallest` squeezes that
laptop to phone width. Both are visible to every Client, and both outlive the
Connection. ADR 0005 called the teardown contract the thing that kept Muxify
honest; commit 111efda had to hand the undoing to a `client-detached` hook,
because a force-quit runs no code of ours and left the damage permanent.

That is a lot of machinery to make a borrowing safe. Control mode does not
borrow. A control client never renders, so the `status` option is simply not its
business, and the laptop keeps its status line while the phone is attached.

Sizing does not disappear: `refresh-client -C` under the default `window-size
latest` still moves the Window to the phone while Muxify is looking at it, and
the laptop is still squeezed for that time. The difference is that it is
tmux's ordinary sizing, reverting when the client goes, rather than an option
rewritten behind the user's back. Nothing is left to restore.

## Considered options

- **Vendor remux's forked GhosttyKit.** It is on this machine, it carries
  ios-arm64 and simulator slices, and its header has 78 `ghostty_tmux`
  references — so this is real, not theoretical. Rejected on two counts. It is
  an unversioned binary with no source and no build recipe here, which is not a
  dependency so much as an artifact of somebody else's build. And it *lacks*
  `ghostty_surface_write_buffer` and `ghostty_surface_process_exit`, which
  `expo-libghostty`'s own fork added and its Surface view is built on — so
  swapping the framework breaks the existing rendering path on day one, with no
  incremental migration and no way back.
- **Keep attaching, keep borrowing.** The status quo, now with a hook to limit
  the damage. Rejected: the hook makes the damage recoverable, not absent, and
  every new option Muxify wants is another thing to borrow.
- **Port the fork's topology reconciler as well.** Still rejected, for 0001's
  reasons — and now unnecessary, because one Surface needs one Pane's bytes.

## Consequences

`session-preparer.ts` goes, and with it the `client-detached` hook, the three
borrow/restore pairs, and the **Attached** warning on the Host Screen that
exists to say joining will shrink somebody's Window.

Muxify shows one Pane at a time, because it mounts one Surface. That is a
choice, not a limit: `expo-libghostty` builds a surface per mounted view against
one shared `ghostty_app_t`, and two live Surfaces were verified on the simulator
rendering at once, each with its own grid, cursor and palette. A real split is
therefore reachable the way remux reaches it — its shipped
`GhosttyCompositeViewportView` "hosts every visible pane in the active tmux
window at its authoritative grid rectangle using one shared, unscaled cell
metric", which is a Surface per Pane placed by the Layout string. Control mode
is what makes it possible at all, since `%output` is per-Pane where an attached
client's byte stream is one composited Window. *(Shipped: see ticket 08. A
Window that is not zoomed now renders a Surface per Pane, and both the claim
about `ghostty_app_t` and the one about `%output` held.)*

What the fork does buy is terminal state for a Pane with *no view*:
`ghostty_terminal_surface_*` is a headless terminal, so remux can hold live
screens for Panes nobody is looking at and draw thumbnails of them. Muxify
cannot, and a Pane it is not showing has no state — which is why ADR 0004's
picker draws an arrangement rather than a picture, and why switching Pane is a
`capture-pane` resync.

Input reaches a Pane through `send-keys`, which means tmux's prefix key never
fires. Every tmux verb has to come from the Dock. That is arguably what a phone
client should do anyway, but it is now structural rather than a choice.

Topology becomes pushed rather than polled, which retires the picker warming and
much of the settling added for the attached-client path. Scrollback is rendered
from `capture-pane` rather than driven through tmux's copy-mode, so the `mouse`
borrow is not replaced by anything — wheel bytes for a full-screen application
go in as ordinary input, and the application scrolls itself exactly as before.

This is the terminal data path, not an addition to it: `tmux-client.ts`,
`ssh-transport.ts` and `terminal.tsx` are rewritten around a Control Connection.
`CONTEXT.md` changes with it — **Control Command**, **Shell Channel**,
**Attached** and **Scrollback** all describe the attached-client design and stop
being true as the migration lands.

## What shipped, where it differs

Two things this ADR said were wrong by a hair, and are recorded rather than
quietly fixed.

**A Control Command is not always on the Control Connection.** The Host Screen
lists a Host's Sessions, and the new-Session form makes one, and both happen
before there is a Session to attach to — so there is no Control Connection to
ask. Those two keep a one-shot channel. It is not a hole in the decision: what
this ADR objects to is borrowing Session options, and `list-sessions` and
`new-session -d` borrow nothing and are gone the moment they answer.

**Commands are quoted twice, not once.** A command going to a shell and the
same command going to tmux need different quoting, and tmux's own rules had to
be measured too — single quotes are wholly literal to its lexer, including a
trailing backslash; a value containing one has to go in double quotes with
`\`, `"` and `$` escaped. So commands are built as argument lists and rendered
per destination, rather than as strings. Nothing in the decision turns on this,
but a string built for one destination is wrong for the other in a way nothing
catches until a Session name has a quote in it.
