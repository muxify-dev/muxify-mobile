# 03 — Render a Surface in a custom dev client

**What to build:** A real terminal Surface appears on screen in a custom
development client, showing bytes pushed into it from the app. Nothing is
connected yet — the bytes are canned — but the terminal is genuine: text,
colour and cursor all render through the terminal library's own engine.

This ticket exists to prove the infrastructure the rest of the project needs
before any of it is built. The terminal library fetches a large prebuilt
framework in a postinstall step, which pnpm blocks by default; the workspace
must allow builds for that package or the iOS build fails on a missing
framework. The app cannot run in Expo Go — it needs a prebuild and a custom
development client.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The terminal library is installed at an exact pinned published version
- [ ] The workspace permits that package's build script so its framework is fetched
- [ ] A prebuild succeeds and a custom development client builds and installs
- [ ] A Surface renders on screen and displays canned bytes written to it
- [ ] Text, colour and cursor positioning all render correctly
- [ ] Verified on both the simulator and a physical device
