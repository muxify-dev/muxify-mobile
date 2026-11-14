import ExpoModulesCore
import UIKit

/// One Keyboard Shortcut, as JS hands it over. `key` is a `UIKeyCommand`
/// input: a character such as "d", or a constant such as
/// `UIKeyCommand.inputLeftArrow`. Command is always held.
struct KeyCommandRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
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
    }

    Function("setCommands") { (records: [KeyCommandRecord]) in
      DispatchQueue.main.async { KeyCommandRegistry.shared.set(records) }
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

/// Puts the commands on the key window's root view controller.
///
/// UIKit looks for a key command along the responder chain from the first
/// responder, and every screen's views lead up to the root view controller,
/// presented sheets included. So a command there works on every screen, and
/// UIKit takes it before the press reaches the Surface's `pressesBegan`.
final class KeyCommandRegistry {
  static let shared = KeyCommandRegistry()

  var fire: ((String) -> Void)?
  private var records: [KeyCommandRecord] = []
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?
  /// While the recorder listens, no command may take the press it waits for.
  var suspended = false {
    didSet { install() }
  }

  func set(_ records: [KeyCommandRecord]) {
    self.records = records
    install()
  }

  func install() {
    host.map { old in installed.forEach(old.removeKeyCommand) }
    installed = []
    guard let root = Self.rootViewController() else { return }
    host = root
    guard !suspended else { return }
    installed = records.map(Self.command)
    installed.forEach(root.addKeyCommand)
  }

  private static func command(_ record: KeyCommandRecord) -> UIKeyCommand {
    var flags: UIKeyModifierFlags = [.command]
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

extension UIResponder {
  /// The action of every Keyboard Shortcut. On UIResponder so the first
  /// responder, whatever it is, answers, and the command needs no target.
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
    guard let input = Self.input(of: key) else { return }
    onRecord([
      "key": input,
      "command": flags.contains(.command),
      "shift": flags.contains(.shift),
      "option": flags.contains(.alternate),
      "control": flags.contains(.control),
    ])
  }

  /// The `UIKeyCommand` input for a key, which is what JS stores.
  private static func input(of key: UIKey) -> String? {
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
