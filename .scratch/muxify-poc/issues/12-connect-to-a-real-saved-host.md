# 12 — Connect to a real saved Host

**What to build:** The hardcoding disappears and the app becomes usable end to
end. Tapping a Host opens a detail screen listing the Sessions running on it;
tapping a Session attaches the terminal to that Host and that Session.

The Session list shows a loading state while it is being read, so the user knows
the app is working rather than stuck. Failures are distinguishable: a wrong
credential must not read the same as an unreachable machine. A Host running no
tmux server shows as having no Sessions, not as an error.

**Blocked by:** 06, 11

**Status:** ready-for-agent

- [ ] Tapping a Host pushes a detail screen listing its Sessions
- [ ] A loading state shows while the Session list is being read
- [ ] Tapping a Session attaches the terminal to that Host and Session
- [ ] The Connection uses the credential stored for that Host's Identity
- [ ] Authentication failure and an unreachable Host produce distinguishable messages
- [ ] A Host with no tmux server shows an empty Sessions state, not an error
- [ ] Home returns to the Hosts list, and returning to a Session re-attaches to it
- [ ] No hardcoded Host or Session name remains anywhere in the app
