import Foundation
import Observation

/// Runs local call/WhatsApp sync: on demand, and every 30 minutes while the app is open.
@MainActor
@Observable
final class SyncModel {
  struct Status {
    var lastRun: Date?
    var summary: String?
    var error: String?
  }

  static let interval: Duration = .seconds(30 * 60)
  private static let backfillDays = 180

  var statuses: [LocalSource: Status] = [:]
  var isRunning = false
  var fullDiskAccess = hasFullDiskAccess()

  var autoSync: Bool {
    didSet { UserDefaults.standard.set(autoSync, forKey: "sync.auto") }
  }
  private var enabled: [LocalSource: Bool] = [:]
  private var loop: Task<Void, Never>?

  init() {
    autoSync = UserDefaults.standard.object(forKey: "sync.auto") as? Bool ?? true
    for source in LocalSource.allCases {
      // Off until you switch a source on: nothing local is read without an explicit opt-in.
      enabled[source] = UserDefaults.standard.object(forKey: "sync.\(source.rawValue).enabled") as? Bool ?? false
      if let last = UserDefaults.standard.object(forKey: "sync.\(source.rawValue).lastRun") as? Date {
        statuses[source, default: Status()].lastRun = last
      }
    }
  }

  func isEnabled(_ source: LocalSource) -> Bool { enabled[source] ?? false }

  func setEnabled(_ source: LocalSource, _ on: Bool) {
    enabled[source] = on
    UserDefaults.standard.set(on, forKey: "sync.\(source.rawValue).enabled")
  }

  /// Starts the background loop once; it syncs right away and then on an interval.
  func start(app: AppModel) {
    guard loop == nil else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        if let self, self.autoSync, app.isSignedIn { await self.syncNow(app: app) }
        try? await Task.sleep(for: Self.interval)
      }
    }
  }

  func syncNow(app: AppModel) async {
    guard !isRunning, app.isSignedIn, LocalSource.allCases.contains(where: isEnabled) else { return }
    isRunning = true
    defer { isRunning = false }
    fullDiskAccess = hasFullDiskAccess()

    for source in LocalSource.allCases where isEnabled(source) {
      let cursorKey = "sync.\(source.rawValue).cursor"
      let since = (UserDefaults.standard.object(forKey: cursorKey) as? Date) ?? Date().addingTimeInterval(-Double(Self.backfillDays) * 86_400)
      var status = statuses[source] ?? Status()
      do {
        // SQLite reads block; keep them off the main actor.
        let result = try await Task.detached(priority: .utility) { try source.read(since: since) }.value
        guard let result else {
          status.error = source == .whatsapp ? "WhatsApp for Mac isn't installed or hasn't synced yet." : "No call history on this Mac."
          statuses[source] = status
          continue
        }
        var linked = 0
        var created = 0
        for start in stride(from: 0, to: result.items.count, by: 25) {
          let batch = Array(result.items[start..<min(start + 25, result.items.count)])
          let pushed = try await app.api.importInteractions(source: source.rawValue, items: batch)
          linked += pushed.interactions
          created += pushed.contactsCreated
        }
        UserDefaults.standard.set(result.lastDate, forKey: cursorKey)
        // Reading the database at all proves access, whatever the probe said.
        fullDiskAccess = true
        status.error = nil
        status.summary = result.items.isEmpty
          ? "Up to date"
          : "\(linked) timeline entr\(linked == 1 ? "y" : "ies")\(created > 0 ? ", \(created) new contact\(created == 1 ? "" : "s")" : "")"
      } catch SyncError.noFullDiskAccess {
        fullDiskAccess = false
        status.error = SyncError.noFullDiskAccess.errorDescription
      } catch let error as APIError where error.isUnauthorized {
        app.signOut()
        status.error = "Signed out: the API token was revoked."
      } catch {
        status.error = error.localizedDescription
      }
      status.lastRun = Date()
      UserDefaults.standard.set(status.lastRun, forKey: "sync.\(source.rawValue).lastRun")
      statuses[source] = status
    }
    app.changed()
  }

  /// Forgets sync progress so the next run re-reads the last 180 days (safe: the server de-duplicates).
  func resetProgress() {
    for source in LocalSource.allCases { UserDefaults.standard.removeObject(forKey: "sync.\(source.rawValue).cursor") }
  }
}
