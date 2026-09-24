import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// Snapshot item providers at the user's Paste action, before crossing to JS.
// A Promise owns preparation after that, even if its Pane's view unmounts.
private enum PastedImages {
  static var providers: [String: (NSItemProvider, String)] = [:]
}

public class ComposerInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ComposerInput")

    AsyncFunction("preparePaste") { (id: String, promise: Promise) in
      guard let (provider, type) = PastedImages.providers[id] else {
        promise.reject("PASTE_MISSING", "The pasted image is no longer available.")
        return
      }
      provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
        guard let url else {
          promise.reject("PASTE_READ", error?.localizedDescription ?? "Couldn’t read the pasted image.")
          return
        }
        do {
          let directory = FileManager.default.temporaryDirectory.appendingPathComponent("muxify-paste-\(UUID().uuidString)")
          try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
          let ext = UTType(type)?.preferredFilenameExtension ?? "png"
          let file = directory.appendingPathComponent("image.\(ext)")
          try FileManager.default.copyItem(at: url, to: file)
          promise.resolve(["uri": file.absoluteString, "name": file.lastPathComponent])
        } catch {
          promise.reject("PASTE_COPY", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("releasePaste") { (id: String) in
      _ = PastedImages.providers.removeValue(forKey: id)
    }.runOnQueue(.main)

    View(ComposerInputView.self) {
      Events("onTextChange", "onImagePaste")
      Prop("value") { (view: ComposerInputView, value: ComposerText) in
        if value.eventCount >= view.eventCount && view.input.text != value.text && view.input.markedTextRange == nil {
          view.input.text = value.text
        }
      }
      Prop("editable") { (view: ComposerInputView, editable: Bool) in view.input.isEditable = editable }
      Prop("dark") { (view: ComposerInputView, dark: Bool) in
        view.overrideUserInterfaceStyle = dark ? .dark : .light
        view.input.keyboardAppearance = dark ? .dark : .light
      }
      Prop("textColor") { (view: ComposerInputView, color: UIColor) in view.input.textColor = color }
      Prop("tintColor") { (view: ComposerInputView, color: UIColor) in view.input.tintColor = color }
      AsyncFunction("focus") { (view: ComposerInputView) in view.input.becomeFirstResponder() }
      AsyncFunction("blur") { (view: ComposerInputView) in view.input.resignFirstResponder() }
      AsyncFunction("paste") { (view: ComposerInputView) in view.input.paste(nil) }
    }
  }
}

internal struct ComposerText: Record {
  @Field var text: String = ""
  @Field var eventCount: Int = 0
}

internal final class PasteTextView: UITextView {
  var imagePaste: ((NSItemProvider, String) -> Void)?

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(paste(_:)), isEditable, UIPasteboard.general.hasImages { return true }
    return super.canPerformAction(action, withSender: sender)
  }

  override func paste(_ sender: Any?) {
    guard isEditable else { return }
    if UIPasteboard.general.hasImages {
      var handled = false
      for provider in UIPasteboard.general.itemProviders {
        if let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) {
          handled = true
          imagePaste?(provider, type)
        }
      }
      if handled { return }
    }
    super.paste(sender)
  }
}

internal final class ComposerInputView: ExpoView, UITextViewDelegate {
  let input = PasteTextView()
  let onTextChange = EventDispatcher()
  let onImagePaste = EventDispatcher()
  var eventCount = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    input.backgroundColor = .clear
    input.font = .preferredFont(forTextStyle: .body)
    input.adjustsFontForContentSizeCategory = true
    input.accessibilityLabel = "Message"
    input.accessibilityIdentifier = "composer-input"
    input.delegate = self
    input.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
    input.imagePaste = { [weak self] provider, type in
      let id = UUID().uuidString
      PastedImages.providers[id] = (provider, type)
      self?.onImagePaste(["id": id])
    }
    addSubview(input)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    input.frame = bounds
  }

  func textViewDidChange(_ textView: UITextView) {
    eventCount += 1
    onTextChange(["text": textView.text ?? "", "eventCount": eventCount])
  }
}
