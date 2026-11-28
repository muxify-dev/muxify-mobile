import CoreGraphics
import Foundation

/// Whether the user has a physical keyboard in use, as far as the app can
/// know. `unknown` is the state before the first GameController check, and it
/// is never "absent": a reader must wait, not decide.
enum PhysicalKeyboard: String {
  case unknown
  case inUse
  case absent
}

/// The rule that turns the evidence about a physical keyboard into one answer.
/// Pure: it holds no UIKit, so a script on macOS tests it (see
/// `scripts/test-keyboard-latch.sh`).
///
/// GameController says whether a keyboard is connected, and it is right about
/// connections and wrong about one case: a Bluetooth keyboard that leaves can
/// stay "connected" with no notice. iOS shows its full software keyboard only
/// when no physical keyboard is in use, so a full keyboard in the window makes
/// GameController's word *stale*. `inUse` is "connected, and not stale".
///
/// The evidence that clears stale is positive: a notice from GameController,
/// a check that says something new, a bar (the short strip iOS shows for a
/// physical keyboard), or a key pressed on a physical keyboard. The frames
/// `keyboardDidChangeFrame` and `keyboardDidHide` carry no evidence: iOS sends
/// a hide as a full-height frame below the screen.
struct KeyboardLatch: Equatable {
  /// The least visible height of a keyboard that only the full software
  /// keyboard has. A bar is about 45 to 70 pt on iPhone and iPad, and a
  /// software keyboard starts near 160 pt in landscape on iPhone.
  static let fullKeyboardHeight: CGFloat = 120

  /// What GameController last said, or nil before the first check.
  private(set) var gcConnected: Bool?
  /// A full software keyboard came up after GameController said "connected".
  private(set) var staleSuspected = false

  var physical: PhysicalKeyboard {
    guard let gcConnected else { return .unknown }
    return gcConnected && !staleSuspected ? .inUse : .absent
  }

  /// A connect or disconnect notice: news of a change.
  mutating func gameControllerNotice(connected: Bool) {
    gcConnected = connected
    staleSuspected = false
  }

  /// A read of `GCKeyboard.coalesced`, at start and on each return to the
  /// foreground. The first read is the first answer. After it, a read that
  /// agrees with what is held changes nothing, because it can be the stale
  /// "connected" again.
  mutating func check(connected: Bool) {
    guard let gcConnected else {
      self.gcConnected = connected
      return
    }
    guard connected != gcConnected else { return }
    self.gcConnected = connected
    staleSuspected = false
  }

  /// `keyboardDidShow`, with the height of its end frame that is visible in
  /// the app's window. A frame with no visible height is no evidence.
  mutating func keyboardDidShow(visibleHeight: CGFloat) {
    if visibleHeight >= Self.fullKeyboardHeight {
      staleSuspected = true
    } else if visibleHeight > 0 {
      staleSuspected = false
    }
  }

  /// A key pressed on a physical keyboard: the one direct proof.
  mutating func keyPressed() {
    gcConnected = true
    staleSuspected = false
  }
}

/// The part of a software keyboard frame that is inside the window, or nil
/// when none of it is. Both are in the window's coordinates. A keyboard that
/// hides is reported at its full size below the screen, so this is nil for it.
func visibleKeyboardFrame(_ frame: CGRect, in window: CGRect) -> CGRect? {
  let visible = frame.intersection(window)
  return visible.isNull || visible.isEmpty ? nil : visible
}

/// What the module hears, with every frame already converted into the window's
/// coordinates (the module does that, because only UIKit can).
enum KeyboardEvent {
  case gameControllerNotice(connected: Bool)
  case check(connected: Bool)
  /// `keyboardWillChangeFrame`, `keyboardWillShow` or `keyboardWillHide`: where the
  /// software keyboard is going to be.
  case software(frame: CGRect, window: CGRect)
  /// `keyboardDidShow`: the keyboard settled, which is evidence about stale.
  case keyboardDidShow(frame: CGRect, window: CGRect)
  case keyPress
}

/// Everything the module knows about the keyboard, which JS mirrors. It
/// changes only through `apply`.
struct KeyboardState: Equatable {
  private(set) var latch = KeyboardLatch()
  /// The software keyboard in the window's coordinates, or nil when none shows.
  private(set) var software: CGRect?

  var physical: PhysicalKeyboard { latch.physical }

  mutating func apply(_ event: KeyboardEvent) {
    switch event {
    case .gameControllerNotice(let connected):
      latch.gameControllerNotice(connected: connected)
    case .check(let connected):
      latch.check(connected: connected)
    case .software(let frame, let window):
      software = visibleKeyboardFrame(frame, in: window)
    case .keyboardDidShow(let frame, let window):
      latch.keyboardDidShow(visibleHeight: visibleKeyboardFrame(frame, in: window)?.height ?? 0)
    case .keyPress:
      latch.keyPressed()
    }
  }
}
