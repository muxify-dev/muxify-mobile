# 08 — Record the decision: a Connection is the app's, not a screen's

**What to build:** an ADR that records why Muxify stops tearing the Connection
down on leaving the Terminal Screen, what it copies from `remux` (Home keeps
the Session, background keeps it, foreground checks and restores once,
transport loss reconnects once, only a lost transport is retried, a reconnect
is a replacement, one Attach at a time), what it deliberately does not copy
(several Attaches at once; anything to keep the link alive in the background),
and what it supersedes (the Terminal Screen's "Connections are ephemeral by
design" and the CONTEXT.md Connection entry). Written now, because the decision
is taken; corrected in a "what shipped" section when ticket 07 lands, as ADR
0006 was.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A new ADR under the repo's ADR directory, numbered next, with Considered
      Options (keep tearing down on unmount; keep alive in the background with
      a background task or keepalives; hold several Attaches as `remux` does)
      and Consequences, including that a Session left attached from the Host
      Screen is a Connection the user has to remember to end
- [x] The ADR names `remux`'s root model and screen model as the source of the
      policy and the date they were read
- [x] The architecture review's crutch ledger entry for the `disposed` ref and
      the teardown effect is referenced as the friction that made this possible
