import Foundation
import Observation

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
  case home, contacts, reminders, duplicates, sync
  var id: String { rawValue }
  var label: String {
    switch self {
    case .home: "Home"
    case .contacts: "Contacts"
    case .reminders: "Reminders"
    case .duplicates: "Duplicates"
    case .sync: "Calls & WhatsApp"
    }
  }
  var symbol: String {
    switch self {
    case .home: "house"
    case .contacts: "person.crop.rectangle.stack"
    case .reminders: "bell"
    case .duplicates: "square.on.square"
    case .sync: "phone.bubble"
    }
  }
}

/// App-wide state: which server, whether we're signed in, and what's selected.
@MainActor
@Observable
final class AppModel {
  private static let serverKey = "serverURL"
  private static let tokenAccount = "api-token"

  var serverURL: URL?
  private(set) var token: String?
  var sidebar: SidebarItem? = .home
  var selectedContactID: String?
  /// Bumped after writes so lists and detail views reload.
  var revision = 0
  var errorMessage: String?

  /// Debug builds can be pointed at a server with PRM_DEV_SERVER / PRM_DEV_TOKEN (for UI testing).
  /// The token then stays in memory: nothing is written to the Keychain or defaults.
  private var usesDevToken = false

  init() {
    #if DEBUG
      let env = ProcessInfo.processInfo.environment
      if let server = env["PRM_DEV_SERVER"].flatMap(URL.init(string:)), let devToken = env["PRM_DEV_TOKEN"] {
        serverURL = server
        token = devToken
        usesDevToken = true
        return
      }
    #endif
    serverURL = UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:))
    token = Keychain.read(Self.tokenAccount)
  }

  var isSignedIn: Bool { serverURL != nil && token != nil }

  var api: APIClient {
    APIClient(baseURL: serverURL ?? URL(string: "http://localhost:3000")!, token: token)
  }

  func signIn(server: String, password: String) async throws {
    var text = server.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.contains("://") { text = "https://" + text }
    guard let url = URL(string: text.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else {
      throw APIError(status: 0, message: "That doesn't look like a server address")
    }
    let device = Host.current().localizedName ?? "Mac"
    let newToken = try await APIClient.signIn(baseURL: url, password: password, deviceName: "Mac app on \(device)")
    Keychain.write(newToken, for: Self.tokenAccount)
    UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
    serverURL = url
    token = newToken
  }

  func signOut() {
    if !usesDevToken { Keychain.delete(Self.tokenAccount) }
    token = nil
    selectedContactID = nil
  }

  /// Runs an API call, surfacing failures in the error banner. Signs out on a revoked token.
  @discardableResult
  func run<T>(_ work: @MainActor (APIClient) async throws -> T) async -> T? {
    do {
      return try await work(api)
    } catch let error as APIError where error.isUnauthorized {
      errorMessage = "Your session ended (the token may have been revoked). Please sign in again."
      signOut()
    } catch is CancellationError {
    } catch {
      errorMessage = error.localizedDescription
    }
    return nil
  }

  func changed() { revision += 1 }
}
