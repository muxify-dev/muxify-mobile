import ExpoModulesCore
import UIKit

/// One Keyboard Shortcut, as JS hands it over. `key` is a `UIKeyCommand`
/// input: a character such as "d", or a constant such as
/// `UIKeyCommand.inputLeftArrow`. Command is held, except for a List Key,
/// which JS hands over only while a list has the keys.
struct KeyCommandRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var key: String = ""
  @Field var command: Bool = true
  @Field var shift: Bool = false
  @Field var option: Bool = false
  @Field var control: Bool = false

  var chord: Chord { Chord(key: key, command: command, shift: shift, option: option, control: control) }
}

/// A key and the modifiers held with it. The Key Row builds one in JS, with
/// command. A hardware key gives one through `init?(_:)`.
struct Chord: Equatable {
  var key: String
  var command: Bool
  var shift: Bool
  var option: Bool
  var control: Bool

  /// The chord of a hardware key, or nil for a key with no input, such as a
  /// modifier on its own.
  init?(_ uiKey: UIKey) {
    let flags = uiKey.modifierFlags
    guard let key = Self.input(of: uiKey) else { return nil }
    self.init(
      key: key,
      command: flags.contains(.command),
      shift: flags.contains(.shift),
      option: flags.contains(.alternate),
      control: flags.contains(.control)
    )
  }

  init(key: String, command: Bool, shift: Bool, option: Bool, control: Bool) {
    self.key = key
    self.command = command
    self.shift = shift
    self.option = option
    self.control = control
  }

  /// The `UIKeyCommand` input for a key, which is what JS stores.
  static func input(of key: UIKey) -> String? {
    switch key.keyCode {
    case .keyboardLeftArrow: return UIKeyCommand.inputLeftArrow
    case .keyboardRightArrow: return UIKeyCommand.inputRightArrow
    case .keyboardUpArrow: return UIKeyCommand.inputUpArrow
    case .keyboardDownArrow: return UIKeyCommand.inputDownArrow
    case .keyboardReturnOrEnter: return "\r"
    case .keyboardTab: return "\t"
    case .keyboardSpacebar: return " "
    case .keyboardDeleteOrBackspace: return "\u{8}"
    case .keyboardEscape: return UIKeyCommand.inputEscape
    default:
      // Without modifiers, so shift-D is "d" with shift, as UIKeyCommand
      // matches it.
      let characters = key.charactersIgnoringModifiers.lowercased()
      return characters.isEmpty ? nil : characters
    }
  }
}

/// A chord from the Key Row, as JS hands it over.
struct ChordRecord: Record {
  @Field var key: String = ""
  @Field var shift: Bool = false
  @Field var option: Bool = false
  @Field var control: Bool = false
}

public class KeyCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyCommands")
    Events("onCommand")

    OnCreate {
      KeyCommandRegistry.shared.fire = { [weak self] id in
        self?.sendEvent("onCommand", ["id": id])
      }
      UIApplication.takeKeyCommandsFirst
    }

    Function("setCommands") { (records: [KeyCommandRecord]) in
      KeyCommandRegistry.shared.set(records)
    }

    Function("perform") { (chord: ChordRecord) -> Bool in
      KeyCommandRegistry.shared.perform(
        Chord(key: chord.key, command: true, shift: chord.shift, option: chord.option, control: chord.control)
      )
    }

    OnAppBecomesActive {
      DispatchQueue.main.async { KeyCommandRegistry.shared.install() }
    }

    View(KeyRecorderView.self) {
      Events("onRecord", "onCancel")
      Prop("active") { (view: KeyRecorderView, active: Bool) in
        view.setActive(active)
      }
    }
  }
}

/// The one place that decides what a command chord means, for a hardware
/// keyboard and for the Key Row alike: the Keyboard Shortcut whose chord it
/// is, if the screen on top handles one; else nothing here, and the key goes
/// on to the first responder, which in a Session is the Surface and so
/// ghostty.
///
/// It also puts the commands on the key window's root view controller as
/// `UIKeyCommand`s. Those never see a hardware chord, which `sendEvent` took
/// before them. They are there so iPadOS lists the Keyboard Shortcuts when ⌘
/// is held and in the menu bar, and choosing one there runs it.
final class KeyCommandRegistry {
  static let shared = KeyCommandRegistry()

  var fire: ((String) -> Void)?
  /// `perform` runs on the JS thread for the Key Row and on the main thread
  /// for a hardware key, so what it reads is behind a lock.
  private let lock = NSLock()
  private var records: [KeyCommandRecord] = []
  private var listening = false
  /// Hardware keys whose press ran a Keyboard Shortcut, so that their release
  /// is taken too and the first responder never sees half a key. Main thread.
  private var taken: Set<UIKeyboardHIDUsage> = []
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  /// While the recorder listens, no command may take the press it waits for.
  var suspended: Bool {
    get { lock.withLock { listening } }
    set {
      lock.withLock { listening = newValue }
      install()
    }
  }

  func set(_ records: [KeyCommandRecord]) {
    lock.withLock { self.records = records }
    DispatchQueue.main.async { self.install() }
  }

  /// Runs the Keyboard Shortcut this chord is, and says whether there was
  /// one.
  func perform(_ chord: Chord) -> Bool {
    let id = lock.withLock { listening ? nil : records.first { $0.chord == chord }?.id }
    guard let id else { return false }
    fire?(id)
    return true
  }

  /// Whether a hardware key event is a Keyboard Shortcut's, run here, so the
  /// app must not deliver it.
  func takes(_ event: UIEvent) -> Bool {
    guard let event = event as? UIPressesEvent else { return false }
    for press in event.allPresses {
      guard let key = press.key else { continue }
      switch press.phase {
      case .began:
        if let chord = Chord(key), perform(chord) {
          taken.insert(key.keyCode)
          return true
        }
      case .ended, .cancelled:
        if taken.remove(key.keyCode) != nil { return true }
      default:
        continue
      }
    }
    return false
  }

  func install() {
    host.map { old in installed.forEach(old.removeKeyCommand) }
    installed = []
    guard let root = Self.rootViewController() else { return }
    host = root
    let (records, listening) = lock.withLock { (self.records, self.listening) }
    guard !listening else { return }
    installed = records.map(Self.command)
    installed.forEach(root.addKeyCommand)
  }

  private static func command(_ record: KeyCommandRecord) -> UIKeyCommand {
    var flags: UIKeyModifierFlags = record.command ? [.command] : []
    if record.shift { flags.insert(.shift) }
    if record.option { flags.insert(.alternate) }
    if record.control { flags.insert(.control) }
    let command = UIKeyCommand(
      title: record.title,
      action: #selector(UIResponder.muxifyPerformKeyCommand(_:)),
      input: record.key,
      modifierFlags: flags,
      propertyList: record.id
    )
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  private static func rootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
    return (windows.first(where: \.isKeyWindow) ?? windows.first)?.rootViewController
  }
}

extension UIApplication {
  /// Puts `KeyCommandRegistry.takes` in front of every event the app gets.
  ///
  /// `sendEvent` is where UIKit hands an event to the window, before any
  /// view, key command or text input sees it, and the place Apple documents
  /// for an app to intercept events. A press that only a key command would
  /// answer otherwise needs every first responder to pass it on, and the
  /// Surface passes on nothing. Runs once.
  static let takeKeyCommandsFirst: Void = {
    guard
      let original = class_getInstanceMethod(UIApplication.self, #selector(sendEvent(_:))),
      let replacement = class_getInstanceMethod(UIApplication.self, #selector(muxifySendEvent(_:)))
    else { return }
    method_exchangeImplementations(original, replacement)
  }()

  /// After the exchange, `muxifySendEvent` here is UIKit's own `sendEvent`.
  @objc private func muxifySendEvent(_ event: UIEvent) {
    // Tells the KeyboardSnapshot module that a physical keyboard is in use: no
    // key of the software keyboard is a press. The name is read there too.
    if let presses = event as? UIPressesEvent, presses.allPresses.contains(where: { $0.phase == .began && $0.key != nil }) {
      NotificationCenter.default.post(name: Notification.Name("dev.muxify.hardwareKeyPressed"), object: nil)
    }
    if KeyCommandRegistry.shared.takes(event) { return }
    muxifySendEvent(event)
  }
}

extension UIResponder {
  /// The action of every Keyboard Shortcut chosen from the iPadOS list or
  /// menu bar. On UIResponder so the first responder, whatever it is,
  /// answers, and the command needs no target.
  @objc func muxifyPerformKeyCommand(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    KeyCommandRegistry.shared.fire?(id)
  }
}

/// Takes the next key pressed on a hardware keyboard, for Settings to bind.
///
/// It is the first responder while active, so the press comes here and not to
/// a text field. Escape alone cancels. A press of a modifier on its own has no
/// characters and is waited past.
final class KeyRecorderView: ExpoView {
  let onRecord = EventDispatcher()
  let onCancel = EventDispatcher()
  private var active = false

  override var canBecomeFirstResponder: Bool { active }

  func setActive(_ on: Bool) {
    guard on != active else { return }
    active = on
    KeyCommandRegistry.shared.suspended = on
    if on {
      DispatchQueue.main.async { [weak self] in _ = self?.becomeFirstResponder() }
    } else {
      _ = resignFirstResponder()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil, active {
      active = false
      KeyCommandRegistry.shared.suspended = false
    }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard active, let key = presses.first(where: { $0.key != nil })?.key else {
      super.pressesBegan(presses, with: event)
      return
    }
    let flags = key.modifierFlags
    if key.keyCode == .keyboardEscape, flags.intersection([.command, .shift, .alternate, .control]).isEmpty {
      onCancel()
      return
    }
    guard let input = Chord.input(of: key) else { return }
    onRecord([
      "key": input,
      "command": flags.contains(.command),
      "shift": flags.contains(.shift),
      "option": flags.contains(.alternate),
      "control": flags.contains(.control),
    ])
  }
}
