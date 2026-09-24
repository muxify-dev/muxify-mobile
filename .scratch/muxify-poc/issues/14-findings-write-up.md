# 14 — Findings write-up

**What to build:** The probe's actual answer, written down. This project exists
to establish whether Expo's Liquid Glass UI, the terminal library and a React
Native SSH stack can be composed into a usable tmux client — not merely to
produce an app. That answer is a deliverable, not a footnote.

Both load-bearing dependencies were young and unproven when this began: the SSH
library was days old at an early version with a single author, and the terminal
library had gone two months without a functional commit, also single-author,
with its vendored terminal core well over a thousand commits behind upstream.
Notes kept during the build should be consolidated here.

Cover what held up, what did not, what had to be worked around, and what it
would cost to take this further — including whether the always-visible
modifier-key group dropped in ADR 0003 turned out to matter in daily use.

**Blocked by:** 09, 12, 13

**Status:** ready-for-agent

- [ ] States plainly whether the stack holds together, with evidence
- [ ] Records which libraries proved reliable and which did not
- [ ] Lists workarounds that were needed and what they cost
- [ ] Assesses whether losing ctrl, esc and tab when the keyboard is hidden grates in practice
- [ ] Notes any ADR that the build contradicted, and why
- [ ] Gives a recommendation on whether to continue on this stack
