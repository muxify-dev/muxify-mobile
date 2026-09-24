# Does this stack hold together?

The probe's question was whether Expo's Liquid Glass UI, `expo-libghostty` and a
React Native SSH library can be composed into a usable tmux client. This is the
answer, written from what was measured rather than what was hoped for.

**Yes, and it is close to genuinely pleasant — but only because three of the
four moving parts were worked around rather than used as documented.**

## What was actually proven

Not by inspection. Each of these was verified on a device against a real Host:

- A real tmux Session renders on a phone, attached over SSH through a real
  client — not control mode. `tmux list-clients` shows one client at the
  Surface's grid.
- Typing on the phone runs commands on the Host and the output comes back:
  `e2e/ls-round-trip.sh` types `ls`, presses Enter **on the device**, and
  asserts the result in the pane.
- Sessions, Windows and Panes can be listed, previewed and switched between,
  each read live off the Host.
- Hosts persist with credentials in the keychain, and host keys are checked on
  every Connection.
- A full-screen program (`top`) draws correctly at the Surface's grid, which is
  the real test of the resize path: headers, inverse video and column
  alignment all land where they should.
- 219 unit tests, three `.ad` suites and four shell suites, including one that
  proves its own instrument before asserting with it.

## The libraries

**`@expo/ui` (Liquid Glass): partly reliable.** The glass itself is real and
looks the part — merged capsules, the morphing Dock, sheets over a live
terminal. Its *interaction* is the problem. Buttons in the Dock work. Buttons
inside a presented `BottomSheet` respond to a finger but never to automation.
Buttons on the Hosts list responded to neither, while a React Native
`Pressable` on the same screen fired immediately. Three different behaviours
from the same component, and no way to tell in advance which you get.

The cost: the Hosts list, the Host form and the Host detail are React Native
views with `GlassView` for the glass. They look nearly the same and can be
tested. The Dock and the picker sheets stay `@expo/ui`, where they are proven.

**`expo-libghostty`: reliable, and easily extended.** It rendered everything
correctly at every size, handled multi-byte input, and never lost bytes. Two
things needed a local patch, and both were already possible in the vendored view
and merely unexported: focus/blur (the keyboard toggle), and hiding the Accessory
Bar. Both were single-line changes once found.

The one real trap is not a bug: iOS delivers every keystroke through
`insertText`, so ghostty cannot tell typing from pasting and wraps **every
keystroke in a bracketed paste**. Enter therefore inserts a newline instead of
running the line. Unwrapping it is four lines; finding it took much longer,
because the symptom points at the Enter key and the cause is the wrapper around
it.

**`@osuki-dev/react-native-ssh`: reliable except for `resize`, which does not
work.** Connections, auth, shell channels, exec channels and host-key
verification all behaved. `shell.resize()` does not deliver a window-change
request: measured with a scripted sequence — alone, twice in a tick, four times
in a tick, with an outbound write, with inbound output — the remote did not move
once in eighteen seconds. It occasionally lands when made alongside other channel
traffic, which is a race, not a feature.

The cost: the remote's size is driven through tmux instead (`window-size manual`
plus `resize-window` over the exec channel), and the Client size is treated as
unknowable. This works, and it is the single largest workaround in the project.
The Rust core ships prebuilt, so unlike the terminal library it cannot be patched
locally. **This needs an upstream report.**

**tmux itself: entirely reliable**, and the right place to put the hard parts.
Every piece of state — which Session, which Window, which Pane, what is zoomed —
lives on the Host, and Muxify reads it on demand.

## What the workarounds cost

| Workaround | Why | Cost |
| --- | --- | --- |
| Size through tmux, not the channel | `resize()` does not deliver | A Control Command per resize; the Client size stays wrong and is not asserted |
| `refresh-client` after every size change | tmux leaves padding behind | One more exec per resize |
| Unwrap bracketed paste | every keystroke arrives as a paste | A multi-line paste now runs every line |
| Patch the terminal library twice | capabilities existed but were unexported | A patch file to carry across upgrades |
| React Native for the Hosts screens | `@expo/ui` buttons did not respond | Two UI idioms in one app |
| Hide the status line, restore on exit | a real client draws real chrome | Session options are mutated and must be handed back |

## Where ADR 0003 stands

ADR 0003 dropped the brief's ctrl/esc/tab group because the terminal library
"exposes no prop to hide" its own Accessory Bar. **That premise was wrong** —
the property was `open` on the vendored view and one assignment away — and the
ADR is amended rather than deleted, because the decision it recorded is now a
choice rather than a constraint.

On whether losing those keys grates: with the Accessory Bar now hidden at the
user's request, there are **no modifier keys at all**. In use, `ctrl-C` is the
one that is missed immediately; esc matters the moment anything modal is
running; arrows matter for shell history. The honest assessment is that a
terminal client without ctrl-C is a viewer, not a client. If this goes further,
the Dock needs that group, and it must compute bytes itself (`ctrl+A` → `0x01`)
and write them to the Shell Channel, since it can no longer borrow ghostty's key
encoder through the bar.

## Recommendation

**Continue on this stack, with two conditions.**

The two libraries doing the hard work — terminal rendering and SSH — both
delivered, and the one that did not is failing in a single, well-understood,
reportable way. The architecture underneath (ADR 0001's Control Commands, a
single transport seam, tmux as the source of truth) survived every surprise in
this build without being revised once, which is the strongest signal here.

1. **Report the `resize` bug upstream**, with the scripted sequence in
   `findings.md`. If it is fixed, the largest workaround in the project
   disappears and the Client size becomes assertable.
2. **Decide `@expo/ui`'s scope deliberately.** It is excellent for the Dock and
   the sheets and unpredictable elsewhere. Treat it as a component library to
   reach for per-component, having verified the component responds, rather than
   as the app's UI framework.

What would be needed beyond this probe: the modifier group above, reconnection
handling when a phone sleeps or changes network, scrollback, and a real answer
for multi-line paste now that bracketed paste is unwrapped.

## Where the evidence lives

- `findings.md` — every measurement, in the order it was made, including the
  three wrong diagnoses and what corrected them
- `docs/adr/` — the decisions, and the one the build contradicted
- `e2e/` — what is checked on a device, and what could not be
