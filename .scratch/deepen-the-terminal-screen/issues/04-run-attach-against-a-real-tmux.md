# 04 — Run Attach against a real tmux

**What to build:** the control-mode harness stops hand-assembling the Attach
sequence and drives the Attach module through the local-process transport it
already has. A refused Attach reaches the user in tmux's own words, which
settles whether tmux's stderr survives the control parser; if it does not, it
is made to.

**Blocked by:** 03

**Status:** done

- [x] `pnpm e2e:control` opens the Attach module against a throwaway tmux
      socket through the existing local transport and reaches the connected
      phase
- [x] Attaching to a Session that does not exist ends in a failed phase whose
      reason contains tmux's own text (measured, then asserted), and the same
      for a wrong tmux executable path
- [x] Switching Session through the verb re-sizes the new Session's Window to
      the Client's grid, observed with `display-message`
- [x] A `split-window` on the tmux side reaches the state subscription as a
      Topology change with the new Pane, without a picker being opened
- [x] Killing the child process ends in the closed phase with a reason
- [x] Every check still confirms no Session option was changed, as the harness
      does today
- [x] The base64 helper and the UTF-8 helper agree, in their comments and in
      what they do, about whether Hermes has `TextEncoder`
