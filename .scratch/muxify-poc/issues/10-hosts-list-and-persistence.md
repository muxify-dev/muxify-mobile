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

**Status:** ready-for-agent

- [ ] Saved Hosts render in a list showing display name and address
- [ ] The list survives an app restart
- [ ] An empty state appears when no Hosts are saved and points at adding one
- [ ] Swiping a row deletes that Host and its list entry
- [ ] Host, Identity and Fingerprint records persist as JSON
- [ ] Credentials are stored in the device keychain keyed by Identity, never in the JSON
- [ ] Deleting a Host does not orphan a credential still used by another Host
