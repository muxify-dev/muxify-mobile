# One keyboard snapshot and one rule decide the Key Row

## Problem

On an iPad with a physical keyboard, the Key Row came back at random moments
and never went away. A trace on an iPad simulator (iOS 27.2, minimization off,
so the software keyboard is full while GameController says "connected") showed
the cause:

- The presence store read only the height of a keyboard frame. iOS reports a
  keyboard that hides at its full size below the screen
  (`keyboardDidChangeFrame, y 1210, height 302, screen 1210`), so a hide
  counted as a full software keyboard. 302 is more than 120, which set
  `overruled`, and the Key Row showed over a connected keyboard.
- Nothing cleared it. `shortcutBar` was `attached`, so `overruled` emptied the
  iPad shortcut bar, which was the only short frame that cleared it. The
  return check agreed with `reported` and changed nothing. A reconnect cleared
  it, and the next hide frame set it again.
- At launch, `isConnected()` read false at import, and the Key Row mounted for
  about 70 ms.

Behind these was a design fault. One iOS fact, the software keyboard, came in
through seven subscriptions of two event sets, and was kept in three copies.
The Terminal Screen made five keyboard decisions inline, and `heldForHardware`
kept the last render's answer in a ref.

## Decision

The user chose these on the planning page of 28 Nov 2026 (D1 to D5). The rest
is the design of this change.

- **One native owner.** `modules/keyboard-snapshot` (the module `KeyboardSnapshot`,
  was `PhysicalKeyboard`) is the only code that listens to the UIKit keyboard
  notifications and to GameController. It sends one `onChange` event with the
  whole snapshot, only when the snapshot changes, and it has a synchronous
  `snapshot()`. The snapshot is `physical` (`unknown`, `inUse` or `absent`), the
  `software` keyboard as a rectangle in the key window or none, and, for the
  Log, the event that changed it with `gcConnected` and `staleSuspected`.
- **The software keyboard is its visible part in the window.** The end frame of
  `keyboardWillChangeFrame`, `keyboardWillShow` and `keyboardWillHide` is
  converted from screen space into the key window and clipped to its bounds.
  The hide frame is below the window, so it is none.
- **A key press from a physical keyboard is a native fact.** The `sendEvent` hook
  of `KeyCommandsModule` posts a notification on the first press of a key,
  which is the one proof that no other input gives. The module hears it. There
  is one hook and no second swizzle.
- **One latch decides `physical`.** It is a pure Swift struct, `KeyboardLatch`,
  with a test that needs no simulator (`pnpm test:keyboard-latch`). It holds
  `gcConnected` (nothing before the first check) and `staleSuspected`.
  `physical` is `unknown` before the first check, `inUse` when `gcConnected` and
  not `staleSuspected`, and else `absent`.
  - A GameController connect or disconnect notice sets `gcConnected` and clears
    `staleSuspected`.
  - A check (the first one, then each return to the foreground) sets
    `gcConnected` the first time. After that it changes the state only when it
    differs from `gcConnected`, and then it clears `staleSuspected`. A check that
    agrees can be the stale "connected" again.
  - `keyboardDidShow` with 120 pt or more of its frame visible sets
    `staleSuspected`: iOS shows a full keyboard only when no physical keyboard
    is in use. With more than 0 and less than 120 pt visible, which is the bar
    iOS shows for a physical keyboard, it clears it. With none visible it does
    nothing.
  - A key press from a physical keyboard sets `gcConnected` and clears
    `staleSuspected`.
  - `keyboardDidChangeFrame` and `keyboardDidHide` are not evidence.
  CONTEXT.md keeps its rule: hiding the software keyboard alone does not hide
  the Key Row.
- **The module listens from its creation.** The first read of GameController at
  OnStartObserving said "not connected" a few milliseconds before the connect
  notice, and with a Terminal Screen open at launch the Key Row mounted for that
  time (seen in `e2e/keyboard-latch.sh`). So the module touches GameController
  and listens for the notices when it is created, long before JS starts. The
  first check at OnStartObserving then finds the settled answer, and the first
  snapshot that JS reads has it.
- **One mirror in JS.** `useKeyboard()` (`useSyncExternalStore`) reads a store
  that starts at `physical: 'unknown'`, with no software keyboard, until the
  native snapshot arrives. It writes one Log line for each snapshot, from the
  speaker `keyboard`: the event, `physical`, the software rectangle,
  `gcConnected` and `staleSuspected`. A change of `physical` to `inUse` or
  `absent` also writes `physical keyboard connected` or `disconnected`, as the
  Log has always had it. A device Log can now name the event that brought the
  Key Row back.
- **One rule, `keyboardPlan(snapshot, intent, screen)`.** It is pure and lives
  in `src/domain/keyboard.ts`, and it replaces `keyboardTarget`. It returns
  the focus target, whether the Key Row shows, the shortcut bar, whether a
  software keyboard shows (which points the Keyboard button), the clearance,
  the room the Key Row reserves, and the Window height. The Terminal Screen
  calls it once and reads its result for the Key Row, the offset of the input
  card, the shortcut bar of each Pane, the focus effect, the Window height,
  the Window area and the armed modifiers (cleared when the row is hidden).
  The Edge Drawer reads `useKeyboard().software`.
  - The Key Row shows only when `physical` is `absent`, and never while it is
    `unknown`.
  - The active Pane is the target when `physical` is `inUse` or the intent is
    `up`. `unknown` is not `inUse`.
  - **The shortcut bar is on when `physical` is `inUse`.** The planning page
    proposed to drop this link, so that the bar would not depend on the
    state. It stays, for two reasons. With the bar always off, a user with a
    physical keyboard loses the language switch of the iPad's keyboard that
    the bar carries (the change of 25 Nov 2026). With the bar always on, a
    full software keyboard shows it again, and it takes the 55 pt that ADR 0003
    gave to the Key Row. The loop that made the old rule trap cannot close now:
    a key press, a notice or a changed check clears `staleSuspected`, and the
    bar's own short frame clears it too. The shortcut bar no longer sets the
    state it reads from.
- **Removed.** `physical-keyboard-presence.ts`, `usePhysicalKeyboard`,
  both `useKeyboardFrame` copies and `heldForHardware` are gone.
- **"A physical keyboard left" is an event of the Attach side.** When `physical`
  goes from `inUse` to `absent`, the `AttachHolder` tells the Attach it holds,
  through a subscribe function that it is given (so a test gives it a fake).
  The Attach sets the Keyboard Intent `up` once, if Typing is open and a
  Terminal Screen is in focus. ADR 0039 said "while the Pane holds the
  keyboard", and the Attach cannot see the Composer, a Selection or a sheet.
  So the condition is what it can see. When a physical keyboard leaves while
  the Composer or a sheet is open, the intent is also `up`, and the keyboard
  goes to the Pane when that screen closes. That is the keyboard the user now has.
  Typing waiting or stopped, or no Terminal Screen in focus, leaves the intent as it is.

## The Keyboard button still asks the Surface

The planning page proposed that the Keyboard button flip the intent, because a
keyboard that iOS hid itself (the iPad's hide key) would reach the intent as an
event. It needs the snapshot to tell that hide from a blur that the app asked
for. It cannot: both are `software none` (a hide frame below the window), and the
snapshot has no cause for either. The check on the iPad simulator confirms that
the Surface is the better witness. With the full keyboard up on the Pane, the
iPad's hide key (`agent-device keyboard dismiss`) hid the keyboard, and then the
Keyboard button logged `keyboard: toggle, Surface has it → blur`. The Surface
is still first responder after iOS hides its keyboard, so the intent reads `up`
while nothing is on screen, and only the Surface knows. `toggleKeyboard` in
`pane-view.ts` keeps `isFocused()`.

## Consequences

- With `staleSuspected` set, the Key Row stays through a hide of the keyboard,
  through Home and back, and through every hide frame, until a key press on a
  physical keyboard, a GameController notice, a check that differs, or a bar
  clears it. This is the right answer for a Bluetooth keyboard that leaves with no
  notice, the case of the earlier change. Over a physical keyboard in use, a real software keyboard that the user
  raised on purpose (the emoji panel, dictation, the bar's "show keyboard") shows the
  Key Row until the next key. The device triggers of the old bug are still a
  guess until a device Log names one.
- There is no way to send a key from a physical keyboard to a simulator without
  the keyboard of the Mac, and no test sends keys to the Mac. `e2e/keyboard-latch.sh`
  covers launch, the full keyboard, the hide key, and Home and back. The Swift
  test covers the key press, the notices and the changed check.
- The first snapshot has the answer, but a GameController notice can still come
  after a first read that says "not connected", for a keyboard that connects
  after launch. The Key Row then shows and hides, as it should.
- Keyboard frames are in the window's coordinates, so the Edge Drawer's panel
  and the Key Row's clearance share one space.
- A Pane's Surface is not on screen yet when the Pane is first the active one:
  the plan names the Pane, and the focus effect asks again when the slot exists.
- The native module is renamed. A build made before this change has the old
  module, so the app must be rebuilt.
