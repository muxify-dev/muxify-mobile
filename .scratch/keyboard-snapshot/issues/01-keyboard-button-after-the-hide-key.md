Status: needs-triage
Type: task

# The Keyboard button after the iPad hide key needs two taps

## What happens

1. With no physical keyboard in use, the active Pane holds the software keyboard.
2. Press the iPad's hide key. iOS hides the keyboard.
3. Tap the Keyboard button (the Key Row or Options > Keyboard).

The Log says `keyboard: toggle, Surface has it → blur`. The Surface stays first
responder after iOS hides its keyboard, so the first tap blurs a keyboard that
is already down. The Keyboard Intent stays `up` after the hide key. The user
must tap again to raise the keyboard.

Seen on an iPad Pro 11-inch (M5) simulator, iOS 27.2, in `e2e/keyboard-latch.sh`
phase 5.

## Why it is not fixed by ADR 0043

The Keyboard Snapshot sees "software keyboard none" both for this hide and for
a blur that the app asks for, so it cannot tell them apart. The toggle still
asks the Surface `isFocused()`, and that answer is true here.

## A possible way

The Surface (the `expo-libghostty` patch) can tell that iOS hid its keyboard
while it stayed first responder. It could send that fact as an event, like
`onKeyboardTap`. The Attach would then write the intent `down`, and the toggle
could flip the intent.
