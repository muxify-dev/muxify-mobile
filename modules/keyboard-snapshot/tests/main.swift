import CoreGraphics
import Foundation

// Tests for KeyboardLatch.swift, the rule of the KeyboardSnapshot module.
// Run with `pnpm test:keyboard-latch`. No simulator is needed: the rule has no UIKit.

// The iPad Pro 11-inch (M5) in portrait, in the window's coordinates.
let window = CGRect(x: 0, y: 0, width: 834, height: 1210)
let fullKeyboard = CGRect(x: 0, y: 870, width: 834, height: 340)
/// The frame iOS reports for a hiding keyboard: its full size, below the screen. Seen in the iPad simulator.
let hideFrame = CGRect(x: 0, y: 1210, width: 834, height: 302)
let bar = CGRect(x: 0, y: 1150, width: 834, height: 60)
let floating = CGRect(x: 200, y: 600, width: 400, height: 200)

typealias Step = KeyboardEvent

let connected = Step.check(connected: true)
let notConnected = Step.check(connected: false)
let joined = Step.gameControllerNotice(connected: true)
let left = Step.gameControllerNotice(connected: false)
let shown = Step.keyboardDidShow(frame: fullKeyboard, window: window)
let barShown = Step.keyboardDidShow(frame: bar, window: window)
let hidden = Step.keyboardDidShow(frame: hideFrame, window: window)
let key = Step.keyPress

struct Case {
  let name: String
  let steps: [Step]
  let physical: PhysicalKeyboard
  let stale: Bool
  let software: CGRect?
  init(_ name: String, _ steps: [Step], _ physical: PhysicalKeyboard, stale: Bool = false, software: CGRect? = nil) {
    self.name = name
    self.steps = steps
    self.physical = physical
    self.stale = stale
    self.software = software
  }
}

let cases: [Case] = [
  Case("launch, before the first check, is unknown and not absent", [], .unknown),
  Case("a frame before the first check does not decide it", [shown], .unknown, stale: true),
  Case("the first check says connected: in use", [connected], .inUse),
  Case("the first check says not connected: absent", [notConnected], .absent),
  Case("a full keyboard after connected: stale, absent",
       [connected, shown], .absent, stale: true),
  Case("a keyboard that hides off screen after a full one: still stale",
       [connected, shown, .software(frame: hideFrame, window: window)], .absent, stale: true),
  Case("a bar clears stale: in use",
       [connected, shown, barShown], .inUse),
  Case("a frame with no visible part is no evidence",
       [connected, hidden], .inUse),
  Case("a full keyboard that is not visible does not set stale",
       [connected, .keyboardDidShow(frame: CGRect(x: 0, y: 1300, width: 834, height: 340), window: window)], .inUse),
  Case("the floating keyboard is a full keyboard when it is 120 pt tall",
       [connected, .keyboardDidShow(frame: floating, window: window)], .absent, stale: true),
  Case("a keyboard of 119 pt is a bar",
       [connected, shown, .keyboardDidShow(frame: CGRect(x: 0, y: 1091, width: 834, height: 119), window: window)], .inUse),
  Case("a check that agrees while stale changes nothing",
       [connected, shown, connected], .absent, stale: true),
  Case("a check that differs, and back, clears stale",
       [connected, shown, notConnected, connected], .inUse),
  Case("a disconnect notice: absent, and stale is cleared",
       [connected, shown, left], .absent),
  Case("a connect notice while stale clears it",
       [connected, shown, joined], .inUse),
  Case("reconnect, then the off-screen hide frame: in use and stays",
       [connected, shown, left, joined, .software(frame: hideFrame, window: window), hidden], .inUse),
  Case("a key press from a physical keyboard clears stale",
       [connected, shown, key], .inUse),
  Case("a key press with no GameController answer is in use",
       [key], .inUse),
  Case("a key press after a disconnect brings it back",
       [connected, left, key], .inUse),
  Case("a full keyboard after a key press sets stale again",
       [connected, shown, key, shown], .absent, stale: true),
  Case("a return check while stale, in the same state, keeps stale",
       [connected, shown, .software(frame: hideFrame, window: window), connected], .absent, stale: true),
  Case("software frame inside the window is kept clipped",
       [.software(frame: fullKeyboard, window: window)], .unknown, software: fullKeyboard),
  Case("the hide frame below the screen is none",
       [.software(frame: fullKeyboard, window: window), .software(frame: hideFrame, window: window)], .unknown),
  Case("a frame half below the screen is clipped to the window",
       [.software(frame: CGRect(x: 0, y: 1100, width: 834, height: 340), window: window)], .unknown,
       software: CGRect(x: 0, y: 1100, width: 834, height: 110)),
  Case("a frame with zero height is none",
       [.software(frame: CGRect(x: 0, y: 500, width: 834, height: 0), window: window)], .unknown),
]

var failures = 0
for test in cases {
  var state = KeyboardState()
  test.steps.forEach { state.apply($0) }
  var problems: [String] = []
  if state.physical != test.physical { problems.append("physical \(state.physical), expected \(test.physical)") }
  if state.latch.staleSuspected != test.stale { problems.append("stale \(state.latch.staleSuspected), expected \(test.stale)") }
  if state.software != test.software { problems.append("software \(String(describing: state.software)), expected \(String(describing: test.software))") }
  if problems.isEmpty {
    print("ok   \(test.name)")
  } else {
    failures += 1
    print("FAIL \(test.name): \(problems.joined(separator: "; "))")
  }
}

print("\(cases.count - failures) of \(cases.count) passed")
exit(failures == 0 ? 0 : 1)
