import ExpoModulesCore
import GameController
import UIKit

/// The one owner of keyboard facts in the app. It is the only code that
/// listens to the UIKit keyboard notifications and to GameController, and it
/// tells JS one snapshot, with the event that changed it: whether a physical
/// keyboard is in use, and where the software keyboard shows in the app's key
/// window. The rule that decides the first is `KeyboardLatch`. JS decides what
/// to do with it (`keyboardPlan`).
///
/// A key pressed on a physical keyboard reaches it as a notification that
/// `KeyCommandsModule` posts from its `sendEvent` hook, which every hardware
/// key goes through. The name is written there too.
public class KeyboardSnapshotModule: Module {
  /// The notifications arrive on the main queue, and `snapshot` runs on the JS thread.
  private let lock = NSLock()
  private var state = KeyboardState()
  private var sent: SnapshotPayload?
  private var keyboardObservers: [NSObjectProtocol] = []
  private var gameControllerObservers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("KeyboardSnapshot")
    Events("onChange")

    // Everything is listened to from here on, so the module always knows
    // where the keyboard is and whether GameController has announced one.
    // GameController starts up on its first use and answers a few milliseconds
    // later, with a connect notice for a keyboard that is already there. A
    // read at that moment says "not connected", which was seen at launch. So
    // the module touches it now and listens for the notice, which comes long
    // before JS starts. The first check (OnStartObserving) then finds the
    // answer GameController settled on.
    OnCreate { [weak self] in
      self?.observeKeyboard()
      self?.observeGameController()
      _ = GCKeyboard.coalesced
    }

    Function("snapshot") { [weak self] () -> [String: Any?] in
      guard let self else { return [:] }
      return self.lock.withLock { SnapshotPayload(state: self.state, event: "read").dictionary }
    }

    OnStartObserving { [weak self] in
      self?.check(event: "GameController first check")
    }

    OnAppBecomesActive { [weak self] in
      self?.check(event: "GameController check on return")
    }

    OnDestroy { [weak self] in
      self?.gameControllerObservers.forEach(NotificationCenter.default.removeObserver)
      self?.gameControllerObservers.removeAll()
      self?.keyboardObservers.forEach(NotificationCenter.default.removeObserver)
      self?.keyboardObservers.removeAll()
    }
  }

  private func observeKeyboard() {
    let center = NotificationCenter.default
    func observe(_ name: Notification.Name, _ handle: @escaping (Notification) -> Void) -> NSObjectProtocol {
      center.addObserver(forName: name, object: nil, queue: .main, using: handle)
    }
    // Where the software keyboard is going: the end frame of every change.
    // A frame is in screen coordinates, and the Terminal Screen is laid out in
    // the window's, so each is converted, and clipped to the window by the rule.
    let software: [Notification.Name] = [
      UIResponder.keyboardWillChangeFrameNotification,
      UIResponder.keyboardWillShowNotification,
      UIResponder.keyboardWillHideNotification,
    ]
    keyboardObservers = software.map { name in
      observe(name) { [weak self] note in
        guard let self, let (frame, window) = self.endFrame(of: note) else { return }
        self.apply(.software(frame: frame, window: window), "\(Self.words(of: name)), \(Self.words(frame, in: window))")
      }
    }
    keyboardObservers.append(observe(UIResponder.keyboardDidShowNotification) { [weak self] note in
      guard let self, let (frame, window) = self.endFrame(of: note) else { return }
      self.apply(.keyboardDidShow(frame: frame, window: window), "keyboardDidShow, \(Self.words(frame, in: window))")
    })
    keyboardObservers.append(observe(Notification.Name("dev.muxify.hardwareKeyPressed")) { [weak self] _ in
      self?.apply(.keyPress, "key pressed on a physical keyboard")
    })
  }

  private func observeGameController() {
    // All keyboards are one coalesced GCKeyboard, so a disconnect is posted
    // only when the last one goes. The notification is the answer:
    // `coalesced` can still hold the leaving keyboard while it is posted.
    gameControllerObservers = [
      NotificationCenter.default.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
        self?.apply(.gameControllerNotice(connected: true), "GameController connect")
      },
      NotificationCenter.default.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
        self?.apply(.gameControllerNotice(connected: false), "GameController disconnect")
      },
    ]
  }

  private func check(event: String) {
    let connected = GCKeyboard.coalesced != nil
    apply(.check(connected: connected), "\(event), \(connected ? "connected" : "not connected")")
  }

  /// Changes the state, and tells JS when the snapshot is not what JS holds.
  private func apply(_ event: KeyboardEvent, _ words: String) {
    let payload: SnapshotPayload? = lock.withLock {
      state.apply(event)
      let now = SnapshotPayload(state: state, event: words)
      guard now != sent else { return nil }
      sent = now
      return now
    }
    if let payload { sendEvent("onChange", payload.dictionary) }
  }

  /// The end frame of a keyboard notification in the key window's coordinates,
  /// with the window's bounds.
  private func endFrame(of note: Notification) -> (CGRect, CGRect)? {
    guard
      let value = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue,
      let window = Self.keyWindow()
    else { return nil }
    return (window.convert(value.cgRectValue, from: window.screen.coordinateSpace), window.bounds)
  }

  private static func keyWindow() -> UIWindow? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
    return windows.first(where: \.isKeyWindow) ?? windows.first
  }

  /// A notification's name as the Log shows it: `keyboardWillChangeFrame`.
  private static func words(of name: Notification.Name) -> String {
    name.rawValue.replacingOccurrences(of: "UIKeyboard", with: "keyboard").replacingOccurrences(of: "Notification", with: "")
  }

  /// A frame as the Log shows it: where it starts in the window, and how much of it shows.
  private static func words(_ frame: CGRect, in window: CGRect) -> String {
    let shown = visibleKeyboardFrame(frame, in: window)
    return "frame y \(Int(frame.minY.rounded())), height \(Int(frame.height.rounded())), window \(Int(window.height.rounded())), "
      + "shows \(Int((shown?.height ?? 0).rounded()))"
  }
}

/// A snapshot as JS gets it. Two payloads are equal when the state is: the
/// event is only why, and a frame that changes nothing is not sent.
private struct SnapshotPayload: Equatable {
  let value: KeyboardState
  let event: String

  init(state: KeyboardState, event: String) {
    value = state
    self.event = event
  }

  static func == (a: SnapshotPayload, b: SnapshotPayload) -> Bool {
    a.value == b.value
  }

  var dictionary: [String: Any?] {
    [
      "physical": value.physical.rawValue,
      "software": value.software.map {
        ["x": $0.minX, "y": $0.minY, "width": $0.width, "height": $0.height]
      },
      "event": event,
      "gcConnected": value.latch.gcConnected,
      "staleSuspected": value.latch.staleSuspected,
    ]
  }
}
