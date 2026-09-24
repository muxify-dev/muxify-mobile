# 12 — Connect to a real saved Host

**What to build:** The hardcoding disappears and the app becomes usable end to
end. Tapping a Host opens a detail screen listing the Sessions running on it;
tapping a Session attaches the terminal to that Host and that Session.

The Session list shows a loading state while it is being read, so the user knows
the app is working rather than stuck. Failures are distinguishable: a wrong
credential must not read the same as an unreachable machine. A Host running no
tmux server shows as having no Sessions, not as an error.

**Blocked by:** 06, 11

**Status:** done

- [x] Tapping a Host pushes a detail screen listing its Sessions
- [x] A loading state shows while the Session list is being read
- [x] Tapping a Session attaches the terminal to that Host and Session
- [x] The Connection uses the credential stored for that Host's Identity
- [x] Authentication failure and an unreachable Host produce distinguishable messages
- [x] A Host with no tmux server shows an empty Sessions state, not an error
- [x] Home returns to the Hosts list, and returning to a Session re-attaches to it
- [x] No hardcoded Host or Session name remains anywhere in the app

**Notes:** No hardcoded Host or Session remains on any connection path. The
empty Hosts list offers one press to *save* the Host described by a gitignored
`.env.local`, which writes an ordinary record through the ordinary store — it is
a way to avoid typing a private key into a phone, not a second way to connect.
The e2e suites use it, then go through the real flow: Hosts list, Sessions,
attach.

These screens are React Native views with `GlassView` for the glass, rather than
`@expo/ui` Buttons: those work in the Dock but never fired here, even pressed at
their own measured coordinates. The sheet was the same and turned out to work
for a finger, so this may too — but a Hosts list that cannot be proven to work
is not one to ship.
