# 06 — TmuxClient behind the transport seam

**What to build:** Session listing works through a real module rather than the
ad-hoc code of the previous tickets. A TmuxClient owns a Connection and exposes
the domain operations — list Sessions, Attach, read Topology, select a Window,
select a Pane, switch Session — depending on a transport interface rather than
on the SSH library directly.

That transport interface is the project's single test seam. It has two
operations: execute a command and return its output, and open a shell channel
returning a duplex stream. Tests drive the TmuxClient against a fake transport
returning canned tmux output; the SSH library sits behind it and is never
unit-tested, because asserting that a mock was called proves nothing about
whether bytes reach a terminal.

Topology is read on demand through Control Commands — one-shot tmux invocations
on their own exec channels, out of band from the Shell Channel. tmux control
mode is deliberately not used; see ADR 0001.

**Blocked by:** 02, 05

**Status:** ready-for-agent

- [ ] A transport interface exists with execute and open-shell operations
- [ ] TmuxClient exposes the domain operations and depends only on that interface
- [ ] The existing Attach path is routed through TmuxClient with no behaviour change
- [ ] Session names are escaped before being interpolated into any Control Command
- [ ] A Host running no tmux server reports an empty Session list, not an error
- [ ] Tests cover command construction, name escaping, listing parsing, active Window and Pane identification, and the no-server case
- [ ] Tests assert observable results, not internal call sequences
