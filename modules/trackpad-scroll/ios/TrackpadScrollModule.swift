import ExpoModulesCore
import UIKit

public class TrackpadScrollModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TrackpadScroll")
    View(TrackpadScrollView.self) {
      Events("onTrackpadScroll")
      Prop("enabled") { (view: TrackpadScrollView, enabled: Bool) in
        view.enabled = enabled
      }
      Prop("contextEpoch") { (view: TrackpadScrollView, epoch: Int) in
        view.contextEpoch = epoch
      }
      Prop("backEdge") { (view: TrackpadScrollView, edge: Double) in
        view.backEdge = CGFloat(edge)
      }
    }
  }
}

internal final class TrackpadScrollView: ExpoView, UIGestureRecognizerDelegate {
  let onTrackpadScroll = EventDispatcher()
  var enabled = false {
    didSet { if enabled != oldValue { resetRecognizer() } }
  }
  var contextEpoch = 0 {
    didSet { if contextEpoch != oldValue { resetRecognizer() } }
  }
  /// The back swipe's band at the left edge of the window, in points.
  var backEdge: CGFloat = 0
  private var gestureId = 0
  private var activeEpoch: Int?
  private var start = CGPoint.zero
  private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan))

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    pan.allowedScrollTypesMask = .continuous
    pan.allowedTouchTypes = []
    pan.cancelsTouchesInView = false
    pan.isEnabled = false
    pan.delegate = self
    addGestureRecognizer(pan)
    NotificationCenter.default.addObserver(self, selector: #selector(becameInactive),
      name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    resetRecognizer()
  }

  /// A scroll right with the pointer in the band is the stack's back swipe,
  /// which takes trackpad scrolls too: this pan fails, and the back swipe
  /// begins. The pointer stays put during a scroll, so where it is now is
  /// where the gesture started.
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === pan else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
    let pointer = pan.location(in: nil)
    let moved = pan.translation(in: self)
    let backSwipe = pointer.x < backEdge && moved.x > 0 && abs(moved.x) > abs(moved.y)
    return !backSwipe
  }

  @objc private func becameInactive() {
    cancelGesture()
    pan.isEnabled = false
  }

  @objc private func becameActive() { resetRecognizer() }

  private func resetRecognizer() {
    cancelGesture()
    pan.isEnabled = false
    pan.isEnabled = enabled && window != nil && UIApplication.shared.applicationState == .active
  }

  private func cancelGesture() {
    if activeEpoch != nil { emit("cancelled") }
    activeEpoch = nil
  }

  @objc private func handlePan() {
    switch pan.state {
    case .began:
      guard enabled, window != nil else { return }
      gestureId += 1
      activeEpoch = contextEpoch
      start = pan.location(in: self)
      emit("began")
    case .changed:
      if activeEpoch != nil { emit("changed") }
    case .ended:
      if activeEpoch != nil { emit("ended") }
      activeEpoch = nil
    case .cancelled, .failed:
      cancelGesture()
    default:
      break
    }
  }

  private func emit(_ phase: String) {
    guard let epoch = activeEpoch else { return }
    let translation = pan.translation(in: self)
    let velocity = pan.velocity(in: self)
    onTrackpadScroll([
      "phase": phase, "gestureId": gestureId, "contextEpoch": epoch,
      "x": start.x, "y": start.y,
      "translationX": translation.x, "translationY": translation.y,
      "velocityX": velocity.x, "velocityY": velocity.y
    ])
  }

}
