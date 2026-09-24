# 13 — Trust-on-first-use host keys

**What to build:** The app notices when a Host's key changes. The Fingerprint is
recorded the first time a Connection to a Host succeeds, and compared on every
later Connection. If it differs, the user gets a prominent warning naming the
Host, so a rebuilt machine can be told from an interception attempt.

The warning does not block the Connection — a user who knows they rebuilt the
machine must still be able to reach it, and can accept the new Fingerprint to
replace the stored one.

Accepting any key silently is explicitly rejected: it is a habit that survives
into production, and the SSH library hands the key to a verification callback we
control.

**Blocked by:** 12

**Status:** done

- [x] The Fingerprint is recorded on the first successful Connection to a Host
- [x] Every later Connection compares the presented key against the stored Fingerprint
- [x] A matching Fingerprint connects with no interruption
- [x] A mismatch shows a prominent warning naming the Host
- [x] The warning does not block the Connection
- [x] Accepting the new Fingerprint replaces the stored one for later comparisons
- [x] Fingerprint comparison is covered by tests
