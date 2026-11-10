import ExpoModulesCore
import MetricKit

private final class DiagnosticReports: NSObject, MXMetricManagerSubscriber {
  static let shared = DiagnosticReports()
  private let lock = NSLock()
  private var started = false
  private var storageError: String?
  private let maximumBytes = 2 * 1024 * 1024

  func start() {
    guard !started else { return }
    started = true
    MXMetricManager.shared.add(self)
  }

  private func directory() throws -> URL {
    var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                         appropriateFor: nil, create: true)
      .appendingPathComponent("MuxifyDiagnostics", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
    return url
  }

  private func reportFiles(_ directory: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    lock.lock()
    defer { lock.unlock() }
    do {
      let folder = try directory()
      for payload in payloads {
        let data = payload.jsonRepresentation()
        guard data.count <= maximumBytes else {
          storageError = "An iOS report exceeded the storage limit."
          continue
        }
        let id = "\(Int64(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString)"
        try data.write(to: folder.appendingPathComponent(id + ".json"), options: .atomic)
      }
      for file in try reportFiles(folder).dropFirst(10) {
        try FileManager.default.removeItem(at: file)
      }
    } catch {
      storageError = "iOS diagnostic reports could not be saved."
    }
  }

  func reports() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    var reports: [[String: String]] = []
    do {
      for file in try reportFiles(directory()).prefix(10) {
        let data = try Data(contentsOf: file)
        guard data.count <= maximumBytes, let text = String(data: data, encoding: .utf8) else { continue }
        reports.append(["id": file.deletingPathExtension().lastPathComponent, "text": text])
      }
    } catch {
      storageError = "iOS diagnostic reports could not be read."
    }
    var result: [String: Any] = ["reports": reports]
    if let storageError { result["error"] = storageError }
    return result
  }
}

public class DiagnosticsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
                          didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    DiagnosticReports.shared.start()
    return true
  }
}

public class DiagnosticsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MuxifyDiagnostics")
    Function("reports") { DiagnosticReports.shared.reports() }
  }
}
