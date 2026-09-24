# 10 — Hosts list and persistence

**What to build:** The app's home screen: a list of saved Hosts that survives
restarts. Each row shows the Host's display name and address. A clear empty
state tells a first-time user to add one rather than leaving them wondering
whether the app is broken. Swiping a row deletes that Host.

Host, Identity and Fingerprint records persist as JSON files, mirroring remux's
layout. Credentials never go into that JSON — passwords and private keys live in
the device keychain, keyed by Identity. Identity is a separate record from Host
so one credential can serve several Hosts.

This ticket is independent of the transport work and can be built in parallel
with it.

**Blocked by:** 01

**Status:** done

- [x] Saved Hosts render in a list showing display name and address
- [x] The list survives an app restart
- [x] An empty state appears when no Hosts are saved and points at adding one
- [x] Swiping a row deletes that Host and its list entry
- [x] Host, Identity and Fingerprint records persist as JSON
- [x] Credentials are stored in the device keychain keyed by Identity, never in the JSON
- [x] Deleting a Host does not orphan a credential still used by another Host

**Notes:** Deleting a Host asks first and removes its credential, unless
another Host shares the Identity — covered by unit tests. Rows delete through a
Delete control rather than a swipe: the swipe gesture is `@expo/ui`'s
`SwipeActions`, whose Buttons do not respond in these screens (see ticket 12's
note), and a delete that cannot be proven to work is not one to ship.
