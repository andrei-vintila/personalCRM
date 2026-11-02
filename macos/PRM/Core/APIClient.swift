import Foundation

struct APIError: LocalizedError, Sendable {
  let status: Int
  let message: String
  var errorDescription: String? { message }
  var isUnauthorized: Bool { status == 401 }
}

/// Talks to the PRM's REST API with a bearer token (the same API the web app uses).
struct APIClient: Sendable {
  let baseURL: URL
  let token: String?

  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.httpCookieStorage = .shared
    config.timeoutIntervalForRequest = 30
    return URLSession(configuration: config)
  }()

  static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      if let ms = try? container.decode(Double.self) { return Date(timeIntervalSince1970: ms / 1000) }
      let string = try container.decode(String.self)
      if let date = isoWithFraction.date(from: string) ?? iso.date(from: string) { return date }
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date \(string)")
    }
    return decoder
  }()

  static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(isoWithFraction.string(from: date))
    }
    return encoder
  }()

  nonisolated(unsafe) private static let isoWithFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()

  // MARK: Plumbing

  private struct Empty: Codable {}
  private struct ErrorBody: Decodable { let message: String? }

  /// Performs a request and returns the raw body; throws APIError for non-2xx responses.
  private func perform(_ method: String, _ path: String, query: [String: String], body: (some Encodable)?) async throws -> Data {
    var components = URLComponents(url: baseURL.appending(path: "api" + path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
    var request = URLRequest(url: components.url!)
    request.httpMethod = method
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try Self.encoder.encode(body)
    }

    let (data, response) = try await Self.session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? Self.decoder.decode(ErrorBody.self, from: data))?.message ?? HTTPURLResponse.localizedString(forStatusCode: status)
      throw APIError(status: status, message: message)
    }
    return data
  }

  func send<Response: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], body: (some Encodable)? = Empty?.none) async throws -> Response {
    try Self.decoder.decode(Response.self, from: try await perform(method, path, query: query, body: body))
  }

  /// For calls whose response body doesn't matter (including 204 No Content).
  func send(_ method: String, _ path: String, body: (some Encodable)? = Empty?.none) async throws {
    _ = try await perform(method, path, query: [:], body: body)
  }

  // MARK: Auth

  /// Signs in with the app password (cookie session), then mints an API token for this Mac.
  static func signIn(baseURL: URL, password: String, deviceName: String) async throws -> String {
    let anonymous = APIClient(baseURL: baseURL, token: nil)
    struct Login: Encodable { let password: String }
    struct TokenRequest: Encodable { let name: String }
    struct TokenResponse: Decodable { let token: String }
    try await anonymous.send("POST", "/auth/login", body: Login(password: password))
    let created: TokenResponse = try await anonymous.send("POST", "/tokens", body: TokenRequest(name: deviceName))
    return created.token
  }

  // MARK: Contacts

  func contacts(query: String = "", filter: ContactFilter = .all, tag: String? = nil) async throws -> [ContactSummary] {
    var params = ["q": query, "filter": filter.rawValue]
    if let tag { params["tag"] = tag }
    return try await send("GET", "/contacts", query: params)
  }

  func contact(_ id: String) async throws -> ContactDetail { try await send("GET", "/contacts/\(id)") }

  func createContact(_ input: ContactInput) async throws -> ContactDetail { try await send("POST", "/contacts", body: input) }

  func updateContact(_ id: String, _ input: ContactInput) async throws -> ContactDetail { try await send("PATCH", "/contacts/\(id)", body: input) }

  func deleteContact(_ id: String) async throws { try await send("DELETE", "/contacts/\(id)") }

  func tags() async throws -> [TagCount] { try await send("GET", "/tags") }

  func home() async throws -> HomeData { try await send("GET", "/home") }

  // MARK: Timeline

  func logInteraction(contactIds: [String], type: InteractionType, body: String, occurredAt: Date) async throws {
    struct Body: Encodable { let contactIds: [String]; let type: InteractionType; let body: String; let occurredAt: Date }
    try await send("POST", "/interactions", body: Body(contactIds: contactIds, type: type, body: body, occurredAt: occurredAt))
  }

  func deleteInteraction(_ id: String) async throws { try await send("DELETE", "/interactions/\(id)") }

  // MARK: Reminders

  func reminders(done: Bool) async throws -> [Reminder] { try await send("GET", "/reminders", query: ["status": done ? "done" : "open"]) }

  func createReminder(contactId: String?, note: String, dueAt: Date) async throws {
    struct Body: Encodable { let contactId: String?; let note: String; let dueAt: Date }
    try await send("POST", "/reminders", body: Body(contactId: contactId, note: note, dueAt: dueAt))
  }

  func setReminder(_ id: String, completed: Bool) async throws {
    struct Body: Encodable { let completed: Bool }
    try await send("PATCH", "/reminders/\(id)", body: Body(completed: completed))
  }

  func deleteReminder(_ id: String) async throws { try await send("DELETE", "/reminders/\(id)") }

  // MARK: Duplicates

  func duplicates() async throws -> DuplicatesResponse { try await send("GET", "/duplicates") }

  func requestDuplicateScan() async throws { try await send("POST", "/duplicates/scan") }

  func dismissDuplicates(pairs: [[String]]) async throws {
    struct Body: Encodable { let pairs: [[String]] }
    try await send("POST", "/duplicates/dismiss", body: Body(pairs: pairs))
  }

  func merge(into targetId: String, sources: [String], fields: [String: String?]) async throws -> ContactDetail {
    struct Body: Encodable { let sourceIds: [String]; let fields: [String: String?] }
    return try await send("POST", "/contacts/\(targetId)/merge", body: Body(sourceIds: sources, fields: fields))
  }

  // MARK: Import (used by local sync)

  struct ImportResult: Decodable, Sendable {
    let interactions: Int
    let contactsCreated: Int
  }

  func importInteractions(source: String, items: [LocalInteraction]) async throws -> ImportResult {
    struct Body: Encodable { let source: String; let items: [LocalInteraction] }
    return try await send("POST", "/import/interactions", body: Body(source: source, items: items))
  }
}
