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

**Status:** done

- [x] A form creates a Host with display name, address, port, user and authentication
- [x] Authentication offers a password or a pasted private key
- [x] An optional absolute tmux path can be set
- [x] The same form edits an existing Host and preserves its identity
- [x] Empty display name, address or user are rejected with a specific message
- [x] A port outside 1–65535 is rejected
- [x] A tmux path that is not absolute is rejected
- [x] Validation runs before any Connection is attempted
- [x] The entered credential is written to the keychain, not to the Host record

**Notes:** Validation firing before any Connection is verified on the device —
saving an empty form shows "Give this Host a name.", "Enter an address or
hostname." and "Enter a password." with no network attempt. Text entry itself
is not automatable: agent-device's `delete` key press types a `v`, the same
class of on-screen-keyboard limitation as the `return` key (see findings). Two
fields were driven successfully by coordinate, which is enough to show the
wiring; the rest is covered by the validation and store unit tests.
