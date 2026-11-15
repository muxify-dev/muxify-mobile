# The app decides a ⌘ chord before any view

On an iPad with a hardware keyboard, the Keyboard Shortcuts did nothing while
a Session had the keys. Muxify gave them to UIKit as `UIKeyCommand`s. UIKit
looks for a key command only for a press that no responder took. In a Session
the first responder is ghostty's terminal view. Its `pressesBegan` takes every
press and passes on only ⌘V. So ⌘D, ⌘, and the Pane moves reached ghostty.
The Key Row's ⌘ worked, because JS had its own copy of the rule. The two copies
also disagreed: the Key Row's ⌘C, ⌘V and ⌘K went to JS, while the hardware
⌘C and ⌘K went to ghostty.

The rule, as the user gave it: a Keyboard Shortcut comes before ghostty, and a
chord that no Keyboard Shortcut claims goes to ghostty.

## Decision

The KeyCommands module holds the rule, once, for both keyboards.

- **Hardware.** The module exchanges `UIApplication.sendEvent` for its own
  method one time, when the module is made. A press of a key with ⌘ that is
  a Keyboard Shortcut of the screen on top runs the shortcut, and the module
  does not deliver that press or its release. Every other event goes on
  unchanged, so ghostty gets it.
- **Key Row.** JS builds the chord from the armed modifiers and the key, and
  asks the module's `perform`. When it answers false, the key goes into the
  Surface as before.
- The `UIKeyCommand`s stay registered, so iPadOS lists the Keyboard
  Shortcuts when ⌘ is held and in the menu bar. They never see a hardware
  chord. A pick from the list runs the shortcut through the same `fire`.
- While the recorder in Settings listens, `perform` claims nothing.
- Copy Pane text (⌘C) and Clear Pane (⌘K) are Keyboard Shortcuts now. The
  Terminal Screen offers ⌘C only while the Pane has the keys, so in a
  Selection, the Composer or a sheet, ⌘C is the system's Copy. The Shortcut
  is gone as a term.
- ⌘V stays the system's Paste, on both keyboards. The Surface's `pressKey`
  gives ⌘V to Paste as its `pressesBegan` does. That is the only change to
  the `expo-libghostty` patch.

## Why not in ghostty's view

The other design changed the patch: `pressesBegan` would pass a ⌘ press to
UIKit when a key command in the responder chain matches it, and `pressKey`
would do the same check for the Key Row. It works, but:

- The rule would live in a vendored file under a patch, and the shortcut list
  in Muxify's module. Every Surface would walk the responder chain and match
  `UIKeyCommand`s by hand, which is UIKit's own matching done a second time.
- It covers only the Surface. A first responder that takes presses on another
  screen would need the same change.
- The patch is rebased on each `expo-libghostty` release. It grows in the
  most active file of the library.

`sendEvent` is public, and Apple names it as the place for an app to see
events before the window gets them. React Native's dev menu also hooks
`UIApplication` for its key commands, through a private method.

## Evidence

Measured on the iPad simulator, iOS 26, Release build, with XCUITest
`typeKey` and a log line in `takes` and `perform` (see
`e2e/command-keys.sh`):

- Each change of a key is its own `UIPressesEvent`, and `allPresses` also
  holds the keys that are still down. For ⌘D: D began with ⌘ stationary,
  then D ended with ⌘ stationary. The module took both. ghostty got the ⌘
  press and release, which type nothing.
- No `UIKeyCommand` action ran in any run, so a chord runs once. The suite
  checks that ⌘D makes exactly one new Pane.
- While the recorder listened, ⌘, and ⌘E went to it: `perform` answered no
  Keyboard Shortcut for both.
- After Split right moved to ⌘E, ⌘D was no Keyboard Shortcut and went on, and
  ⌘E split.
- ⌘← was no Keyboard Shortcut and reached ghostty, which moved to the start
  of the line.
- XCUITest's ⌘⌫ did not reach the app: `sendEvent` saw no event for the
  delete key. This is why ⌘⌫ removes the line on a real iPad and not under
  XCUITest. It is a limit of the simulator test, not of the app.

## Consequences

- A Keyboard Shortcut runs before any text view on the screen sees the chord.
  A Keyboard Shortcut that a text view also uses must not be offered while
  that view has the keys. ⌘C is the one case today.
- Not measured: key repeat. A held chord is expected to run once, because
  the module takes the press and nothing downstream sees it to repeat.
- Not measured: another library that also exchanges `sendEvent`. Each
  exchange calls the method it replaced, so both are expected to run.
- Not measured on a device: the Key Row half. On the simulator under
  XCUITest, iOS reports a hardware keyboard and keeps the software keyboard
  down, so the Key Row is hidden. The Key Row only builds the chord (unit
  tests) and calls the same `perform` that the hardware path proves.
