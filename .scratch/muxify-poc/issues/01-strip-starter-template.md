# 01 — Strip the starter template

**What to build:** The app boots into a single navigation stack instead of the
Expo starter's tab bar. The demo screens and showcase components that ship with
`create-expo-app` are gone, leaving a clean shell to build on. Theming and the
colour-scheme hooks stay — they are still wanted.

No user-facing feature is added here. This is prefactoring: make the change
easy, then make the easy change.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] The tab bar and its second route are removed; navigation is a single stack
- [x] Starter demo components not used by the design are deleted
- [x] Theme constants and colour-scheme hooks are retained and still applied
- [x] The app builds and launches to one screen with no dead imports
- [x] A typecheck passes with no errors
