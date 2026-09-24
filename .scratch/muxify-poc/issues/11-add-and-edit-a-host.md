# 11 — Add and edit a Host

**What to build:** The form that makes the Hosts list useful. A user adds a Host
by display name, address, port and user, choosing either a password or a pasted
private key to authenticate with, and optionally giving an absolute path to the
tmux binary for Hosts where tmux is not on a non-interactive shell's `PATH`.
The same form edits an existing Host, so a typo or a changed address can be
fixed without recreating it.

Validation happens before any connection is attempted, so a typo produces an
immediate, specific answer instead of a confusing network error.

Passphrase-protected keys, on-device key generation and importing a key from
Files are all out of scope.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] A form creates a Host with display name, address, port, user and authentication
- [ ] Authentication offers a password or a pasted private key
- [ ] An optional absolute tmux path can be set
- [ ] The same form edits an existing Host and preserves its identity
- [ ] Empty display name, address or user are rejected with a specific message
- [ ] A port outside 1–65535 is rejected
- [ ] A tmux path that is not absolute is rejected
- [ ] Validation runs before any Connection is attempted
- [ ] The entered credential is written to the keychain, not to the Host record
