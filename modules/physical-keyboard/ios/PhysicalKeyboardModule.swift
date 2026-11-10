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
      self.observers = [Notification.Name.GCKeyboardDidConnect, .GCKeyboardDidDisconnect].map { name in
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.reportPresence()
        }
      }
      self.reportPresence()
    }

    OnStopObserving { [weak self] in
      self?.stopObserving()
    }

    OnAppBecomesActive { [weak self] in
      self?.reportPresence()
    }

    OnDestroy { [weak self] in
      self?.stopObserving()
    }
  }

  private func reportPresence() {
    sendEvent("onChange", ["connected": GCKeyboard.coalesced != nil])
  }

  private func stopObserving() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
  }
}
