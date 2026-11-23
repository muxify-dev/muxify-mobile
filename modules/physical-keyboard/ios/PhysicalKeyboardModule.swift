import ExpoModulesCore
import GameController

public class PhysicalKeyboardModule: Module {
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("PhysicalKeyboard")
    Events("onChange")

    Function("isConnected") {
      GCKeyboard.coalesced != nil
    }

    OnStartObserving { [weak self] in
      guard let self else { return }
      // All keyboards are one coalesced GCKeyboard, so a disconnect is posted
      // only when the last one goes. The notification is the answer:
      // `coalesced` can still hold the leaving keyboard while it is posted.
      self.observers = [
        NotificationCenter.default.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
          self?.report(connected: true, cause: "connect")
        },
        NotificationCenter.default.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
          self?.report(connected: false, cause: "disconnect")
        },
      ]
      self.report(connected: GCKeyboard.coalesced != nil, cause: "check")
    }

    OnStopObserving { [weak self] in
      self?.stopObserving()
    }

    OnAppBecomesActive { [weak self] in
      self?.report(connected: GCKeyboard.coalesced != nil, cause: "check")
    }

    OnDestroy { [weak self] in
      self?.stopObserving()
    }
  }

  private func report(connected: Bool, cause: String) {
    sendEvent("onChange", ["connected": connected, "cause": cause])
  }

  private func stopObserving() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
  }
}
