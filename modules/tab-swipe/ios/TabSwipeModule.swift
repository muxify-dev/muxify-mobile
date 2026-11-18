import ExpoModulesCore
import UIKit

public class TabSwipeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabSwipe")
    View(TabSwipeView.self) {
      Events("onTabSwipe")
      Prop("enabled") { (view: TabSwipeView, enabled: Bool) in
        view.enabled = enabled
      }
      Prop("backEdge") { (view: TabSwipeView, edge: Double) in
        view.backEdge = CGFloat(edge)
      }
    }
  }
}

/// A sideways drag that starts on a screen's tab control or on the bar at the
/// bottom, reported to JavaScript. This view wraps the tab control.
///
/// UIKit draws the bar at the bottom in the navigation controller's view,
/// beside the screens and the navigation bar, not in the screen's view (on
/// iOS 26, as a floating bar). So the drag sits on the navigation
/// controller's view and takes only the touches that land on this view or on
/// that bar, while this screen is on top. Elsewhere on the screen, a drag is
/// the list's or the stack's back swipe.
internal final class TabSwipeView: ExpoView, UIGestureRecognizerDelegate {
  let onTabSwipe = EventDispatcher()
  /// Off cancels a drag in progress.
  var enabled = false {
    didSet { drag.isEnabled = enabled }
  }
  var backEdge: CGFloat = 0 {
    didSet { drag.backEdge = backEdge }
  }

  private lazy var drag = SidewaysDrag(target: self, action: #selector(handleDrag))
  private weak var navigation: UINavigationController?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    drag.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    drag.delegate = self
    drag.isEnabled = false
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    drag.view?.removeGestureRecognizer(drag)
    navigation = window == nil ? nil : screen?.navigationController
    navigation?.view.addGestureRecognizer(drag)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let touched = touch.view, isOnTop else { return false }
    return touched.isDescendant(of: self) || isOnBarAtBottom(touched)
  }

  /// The stack's back swipe from anywhere waits for this drag to fail, so a
  /// sideways drag on the control or the bar is the tab swipe.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    guard #available(iOS 26, *) else { return false }
    return otherGestureRecognizer === navigation?.interactiveContentPopGestureRecognizer
  }

  /// The view controller of the screen this view is on.
  private var screen: UIViewController? {
    var responder: UIResponder? = self
    while let each = responder {
      if let controller = each as? UIViewController { return controller }
      responder = each.next
    }
    return nil
  }

  private var isOnTop: Bool {
    guard let top = navigation?.topViewController?.view else { return false }
    return isDescendant(of: top)
  }

  /// In the navigation controller's view, and outside the screens and the navigation bar.
  private func isOnBarAtBottom(_ touched: UIView) -> Bool {
    guard let navigation else { return false }
    guard let branch = navigation.view.subviews.first(where: { touched.isDescendant(of: $0) }) else { return false }
    return !isDescendant(of: branch) && !touched.isDescendant(of: navigation.navigationBar)
  }

  @objc private func handleDrag() {
    switch drag.state {
    case .began: emit("began")
    case .changed: emit("changed")
    case .ended: emit("ended")
    case .cancelled, .failed: emit("cancelled")
    default: break
    }
  }

  private func emit(_ phase: String) {
    onTabSwipe(["phase": phase, "translation": drag.translation, "velocity": drag.velocity])
  }
}

/// A one-finger drag that begins only sideways, as the Pane Swipe does.
///
/// A segmented control says no to every sideways UIPanGestureRecognizer that
/// lands on it, so that its thumb can slide. It says no only to pans and
/// taps, so this is a gesture of its own kind. It decides the axis once,
/// when the finger leaves the tap slop, from the travel so far. The numbers
/// are the Pane Swipe's: `TAP_SLOP` in terminal.tsx, and `panAxis` and
/// `HORIZONTAL_PAN_RATIO` in pan-axis.ts. A drag right that landed in the
/// back edge band fails, because it is the stack's back swipe.
internal final class SidewaysDrag: UIGestureRecognizer {
  private static let tapSlop: CGFloat = 10
  private static let horizontalPanRatio: CGFloat = 1.5
  /// A finger that rests this long before it lifts has no speed.
  private static let restBeforeLift: TimeInterval = 0.1

  var backEdge: CGFloat = 0
  /// How far the finger is sideways from where it landed, in points.
  private(set) var translation: CGFloat = 0
  /// How fast it goes sideways, in points a second.
  private(set) var velocity: CGFloat = 0

  private var finger: UITouch?
  private var landed = CGPoint.zero
  private var lastX: CGFloat = 0
  private var lastTime: TimeInterval = 0

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    for touch in touches where touch !== finger {
      guard finger == nil else {
        ignore(touch, for: event)
        continue
      }
      finger = touch
      landed = touch.location(in: nil)
      lastX = landed.x
      lastTime = touch.timestamp
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger) else { return }
    let point = finger.location(in: nil)
    let elapsed = finger.timestamp - lastTime
    if elapsed > 0 { velocity = (point.x - lastX) / CGFloat(elapsed) }
    lastX = point.x
    lastTime = finger.timestamp
    translation = point.x - landed.x
    let dy = point.y - landed.y

    switch state {
    case .possible:
      guard hypot(translation, dy) > Self.tapSlop else { return }
      let sideways = abs(translation) > abs(dy) * Self.horizontalPanRatio
      let backSwipe = translation > 0 && landed.x < backEdge
      state = sideways && !backSwipe ? .began : .failed
    case .began, .changed:
      state = .changed
    default:
      break
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger) else { return }
    if finger.timestamp - lastTime > Self.restBeforeLift { velocity = 0 }
    state = isDragging ? .ended : .failed
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let finger, touches.contains(finger) else { return }
    state = isDragging ? .cancelled : .failed
  }

  override func reset() {
    super.reset()
    finger = nil
    translation = 0
    velocity = 0
  }

  private var isDragging: Bool { state == .began || state == .changed }
}
