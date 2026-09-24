# 07 — Glass Dock with Home and Keyboard

**What to build:** A Liquid Glass Dock pinned to the bottom of the terminal
screen, carrying its Home and Keyboard group. Keyboard dismisses the system
keyboard to reveal more of the terminal and brings it back; Home returns to the
previous screen without requiring a gesture the user has to discover.

Build it from SwiftUI glass primitives inside a hosting boundary, using a
glass-effect container and a shared namespace so adjacent buttons merge and
morph. An RN-positioned glass container is the fallback if hosting-boundary
sizing fights the keyboard.

Guard against iOS 26 builds that lack the underlying effect class using the
runtime availability probe, not the design-mode check — they are different
functions and only the former prevents a crash. No non-glass fallback theme is
built; every target device is iOS 26.4 or later.

There is no modifier-key group and no composer button. The terminal library
ships its own Accessory Bar with ctrl, esc and tab above the keyboard and
exposes no way to hide it; see ADR 0003.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The Dock renders in Liquid Glass, pinned to the bottom of the terminal
- [ ] Adjacent buttons merge and morph via a shared namespace
- [ ] Keyboard toggles the system keyboard and the terminal reflows around it
- [ ] Home returns to the previous screen
- [ ] The runtime glass-availability probe guards rendering so a device without the effect does not crash
- [ ] The library's Accessory Bar still appears above the keyboard and is not duplicated
