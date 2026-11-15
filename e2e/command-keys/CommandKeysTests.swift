import XCTest

/// The UI half of e2e/command-keys.sh, compiled into agent-device's runner.
///
/// The same chords go in from a hardware keyboard (`typeKey`) and from the
/// Key Row, and must do the same. One test, one launch: under XCUITest a
/// second launch of the app can hang. The hardware half leaves Split right
/// on ⌘E, which the Key Row checks last. What only tmux can
/// tell, the shell checks: `host(step)` writes "<number> <step>" to
/// $MUXIFY_KEYS_DIR/step and waits for the shell's verdict in
/// $MUXIFY_KEYS_DIR/ack-<number>.
final class CommandKeysTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "dev.muxify.app")
  private lazy var dir = ProcessInfo.processInfo.environment["MUXIFY_KEYS_DIR"] ?? ""

  override func setUp() {
    continueAfterFailure = false
  }

  func testChordsFromBothKeyboards() throws {
    attach()
    let keyRowShown = app.buttons.matching(NSPredicate(format: "label == 'command'")).firstMatch
      .waitForExistence(timeout: 5)
    if !keyRowShown {
      try? "".write(toFile: "\(dir)/no-key-row", atomically: true, encoding: .utf8)
    }
    // The Key Row goes first: it raises the software keyboard, and so gives
    // the Pane the focus that `typeKey` needs.
    if keyRowShown { keyRowDefaults() }
    hardwareKeyboard()
    if keyRowShown { keyRowRecordedChord() }
  }

  private func keyRowDefaults() {
    host("fresh")
    keyRow("d")
    host("two-panes")

    keyRow(",")
    XCTAssert(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Key Row ⌘, opened no Settings")
    back()

    host("fresh-with-scrollback")
    keyRow("k")
    host("cleared")

    host("typed")
    keyRow("delete")
    host("line-removed")
  }

  private func hardwareKeyboard() {
    host("fresh")
    hardware("d")
    host("two-panes")

    hardware(",")
    XCTAssert(app.navigationBars["Settings"].waitForExistence(timeout: 10), "⌘, opened no Settings")
    rebindSplitRight(to: "e")
    back()
    back()
    host("fresh")
    hardware("d")
    host("one-pane")
    hardware("e")
    host("two-panes")

    host("fresh-with-scrollback")
    hardware("k")
    host("cleared")

    host("typed")
    hardware(XCUIKeyboardKey.leftArrow.rawValue)
    app.typeText("X")
    host("x-at-line-start")
  }

  /// Split right is on ⌘E now, from the hardware half.
  private func keyRowRecordedChord() {
    host("fresh")
    keyRow("e")
    host("two-panes")
    keyRow("d")
    host("two-panes")
  }

  private var steps: Int {
    get { Int((try? String(contentsOfFile: "\(dir)/count", encoding: .utf8)) ?? "0") ?? 0 }
    set { try? String(newValue).write(toFile: "\(dir)/count", atomically: true, encoding: .utf8) }
  }

  private func attach() {
    XCTAssertFalse(dir.isEmpty, "MUXIFY_KEYS_DIR is not set")
    app.launch()
    let hostRow = app.descendants(matching: .any)["Host Dev Host"]
    let pane = app.descendants(matching: .any)["pane-command"]
    // Reconnect on start can open the last Session by itself.
    if pane.waitForExistence(timeout: 8) { return }
    if !hostRow.waitForExistence(timeout: 30) {
      try? app.debugDescription.write(toFile: "\(dir)/screen.txt", atomically: true, encoding: .utf8)
      XCTFail("no Dev Host on Home; the screen is in screen.txt")
    }
    hostRow.tap()
    let session = app.descendants(matching: .any)["Session 0"]
    XCTAssert(session.waitForExistence(timeout: 20), "no Session 0")
    session.tap()
    XCTAssert(app.descendants(matching: .any)["pane-command"].waitForExistence(timeout: 20), "the Attach never connected")
  }

  /// ⌘ from the Key Row, then the key from the software keyboard.
  private func keyRow(_ key: String) {
    if !app.keys[key].exists { app.buttons.matching(NSPredicate(format: "label == 'Keyboard'")).firstMatch.tap() }
    XCTAssert(app.keys[key].waitForExistence(timeout: 10), "no \(key) key on the software keyboard")
    app.buttons.matching(NSPredicate(format: "label == 'command'")).firstMatch.tap()
    app.keys[key].tap()
    sleep(1)
  }

  private func hardware(_ key: String) {
    app.typeKey(key, modifierFlags: .command)
    sleep(1)
  }

  private func back() {
    app.navigationBars.buttons.element(boundBy: 0).tap()
    sleep(1)
  }

  /// From Settings: records ⌘<key> for Split right.
  private func rebindSplitRight(to key: String) {
    let row = app.buttons["Keyboard Shortcuts"]
    // The form makes its rows as they scroll into view.
    for _ in 0..<5 where !row.exists {
      app.swipeUp()
    }
    XCTAssert(row.waitForExistence(timeout: 5), "no Keyboard Shortcuts in Settings")
    row.tap()
    let splitRight = app.buttons["Split right, ⌘D"]
    XCTAssert(splitRight.waitForExistence(timeout: 10), "no Split right, ⌘D")
    splitRight.tap()
    sleep(1)
    // ⌘, is Open Settings everywhere, so the recorder only gets it if the
    // Keyboard Shortcuts step aside while it listens.
    app.typeKey(",", modifierFlags: .command)
    XCTAssert(
      app.staticTexts["⌘, is Open Settings."].waitForExistence(timeout: 10),
      "the recorder did not get ⌘,"
    )
    XCTAssert(app.navigationBars["Keyboard Shortcuts"].exists, "⌘, left the recorder")
    app.typeKey(key, modifierFlags: .command)
    let rebound = app.buttons["Split right, ⌘\(key.uppercased())"]
    XCTAssert(rebound.waitForExistence(timeout: 10), "the recorder did not take ⌘\(key)")
  }

  private func host(_ step: String) {
    steps += 1
    let number = steps
    let ack = "\(dir)/ack-\(number)"
    XCTAssertNoThrow(try "\(number) \(step)".write(toFile: "\(dir)/step", atomically: true, encoding: .utf8))
    let deadline = Date().addingTimeInterval(30)
    while Date() < deadline {
      if let verdict = try? String(contentsOfFile: ack, encoding: .utf8) {
        XCTAssertEqual(verdict, "ok", "\(step): \(verdict)")
        return
      }
      usleep(200_000)
    }
    XCTFail("\(step): the shell gave no verdict")
  }
}
