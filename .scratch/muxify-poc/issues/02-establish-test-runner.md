# 02 — Establish the test runner

**What to build:** The project can run unit tests. A developer runs one command
and sees a test suite execute and pass. This exists as its own ticket so the
runner is chosen for the project rather than shaped by whichever module happens
to need tests first.

Use `jest-expo` matched to the Expo SDK, with the preset's standard transform
ignore pattern — the workspace uses a hoisted node linker, so the flat-layout
pattern is correct and the pnpm-specific variant is not needed.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] `jest-expo` and its companions are installed at versions matched to the SDK
- [x] A test script runs the suite from the command line
- [x] Jest types are registered so test files typecheck
- [x] A trivial placeholder test passes, proving the harness works end to end
- [x] Dependency versions are pinned exactly and the lockfile is committed
