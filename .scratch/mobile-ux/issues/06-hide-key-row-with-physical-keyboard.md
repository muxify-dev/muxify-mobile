# Hide the Key Row while a physical keyboard is connected

Status: implemented, physical device checks pending

The user uses an Apple Magic Keyboard with an iPad and does not want the
Key Row while that keyboard is connected.

## Required behavior

- Hide the Key Row when a physical keyboard is connected. Include the
  iPad Magic Keyboard.
- Show the Key Row again when the physical keyboard disconnects.
- Read the initial keyboard state on app start. Recheck it on foreground
  entry and observe connection changes while Terminal is open.
- Detect the physical keyboard separately from software keyboard visibility.
  A hidden software keyboard alone does not mean a physical keyboard exists.
- Remove the hidden row's touch targets and unused clearance. Keep terminal
  input focus, selection, and the Attach intact.
- Keep hardware key input and shortcuts working. Clear any armed touch-only
  modifiers and stop a held arrow repeat when the Key Row disappears.
- Keep the existing normal-screen and alternate-screen sizing policy in
  ADR 0008. Do not add a resize loop for keyboard detection.

## Access to controls

Panes must remain reachable while the Key Row is hidden. The proposed design
adds Panes to Terminal Options and opens the existing Panes picker.
Keep a software keyboard action available through Options if the Key Row
was its only entry point. Do not require the Key Row to remain visible for
these actions.

## Acceptance checks

- Start with the Magic Keyboard attached. The Key Row is absent.
- Attach and detach the keyboard while Terminal is open. The row follows
  the physical keyboard state without reconnecting the Session.
- Return from the background after the keyboard state changes.
- Check rotation, iPad multitasking, the Composer, selection, and reconnect.
- Confirm that hardware input reaches the active Pane and that Panes remains
  reachable through Options.
- Check an iPad and an iPhone without a physical keyboard. Hiding the software
  keyboard must not hide the Key Row.

## Investigation

The Terminal currently renders the Key Row without a physical-keyboard
condition. Its keyboard listeners track software keyboard events.
Evaluate a public iOS keyboard connection API and verify it with the user's
Magic Keyboard. Do not infer connection from keyboard frame height alone.

## Comments

Added during the navigation design review on 10 November 2026.
These are requirements for implementation. No hardware-keyboard check has
been run on a device in this review.

## Implementation and verification

The local PhysicalKeyboard Expo module reads GCKeyboard.coalesced. It observes
connect and disconnect notifications, reports state after observation starts,
and reports state when the app becomes active. The initial JavaScript read
and native startup snapshot cover the subscription gap.

Terminal hides the Key Row, clears its armed modifiers, and keeps software
keyboard clearance outside the row. Unmount stops arrow repeat. Panes and
Keyboard remain in Options. Normal-screen height comes from the Terminal
bounds. A Selection still holds its size and Slide.

The native build passes. Six hook tests and four clearance tests pass.
The iPad Pro simulator reported a connected hardware keyboard, and its Key
Row was absent. Panes and Keyboard opened through Options. The iPhone
simulator kept its Key Row. The full sizing regression suite passed, including
normal-screen height, alternate-screen height, cursor clearance, and input.

The Apple Magic Keyboard itself was not available. Physical attach/detach,
foreground changes, hardware shortcuts, rotation, and iPad multitasking still
need a physical-device check. The simulator's reported hardware connection
is not proof of those device behaviors. Run e2e/physical-keyboard.sh to check
native presence and Options on a simulator.
