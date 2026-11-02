import Foundation

// Mirrors the JSON returned by the PRM's /api routes.

struct ContactRef: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let name: String
  let avatarUrl: String?
}

struct ContactSummary: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let name: String
  let company: String?
  let title: String?
  let location: String?
  let avatarUrl: String?
  let birthday: String?
  let keepInTouchDays: Int?
  let lastInteractionAt: Date?
  let starred: Bool
  let archived: Bool
  let email: String?
  let phone: String?
  let tags: [String]
  /// Milliseconds since 1970 when a catch-up is due, if tracked.
  let dueAt: Double?
  let sources: [String]

  var isOverdue: Bool { dueAt.map { $0 <= Date().timeIntervalSince1970 * 1000 } ?? false }
  var subtitle: String { [title, company].compactMap { $0 }.joined(separator: " · ") }
}

struct Identity: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let kind: IdentityKind
  let value: String
  let label: String?
}

enum IdentityKind: String, Codable, CaseIterable, Identifiable, Sendable {
  case email, phone, linkedin, twitter, url
  var id: String { rawValue }
  var label: String {
    switch self {
    case .email: "Email"
    case .phone: "Phone"
    case .linkedin: "LinkedIn"
    case .twitter: "X / Twitter"
    case .url: "Website"
    }
  }
  var placeholder: String {
    switch self {
    case .email: "name@example.com"
    case .phone: "+1 555 123 4567"
    case .linkedin: "linkedin.com/in/handle"
    case .twitter: "@handle"
    case .url: "https://…"
    }
  }
  var symbol: String {
    switch self {
    case .email: "envelope"
    case .phone: "phone"
    case .linkedin: "link"
    case .twitter: "at"
    case .url: "globe"
    }
  }
  func url(for value: String) -> URL? {
    switch self {
    case .email: URL(string: "mailto:\(value)")
    case .phone: URL(string: "tel:\(value)")
    case .linkedin: URL(string: "https://www.linkedin.com/in/\(value)")
    case .twitter: URL(string: "https://x.com/\(value)")
    case .url: URL(string: value.hasPrefix("http") ? value : "https://\(value)")
    }
  }
}

enum InteractionType: String, Codable, CaseIterable, Identifiable, Sendable {
  case note, meeting, call, message, email, other
  var id: String { rawValue }
  var label: String { rawValue.capitalized }
  var symbol: String {
    switch self {
    case .note: "note.text"
    case .meeting: "person.2"
    case .call: "phone"
    case .message: "bubble.left"
    case .email: "envelope"
    case .other: "calendar"
    }
  }
}

struct Interaction: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let type: InteractionType
  let occurredAt: Date
  let title: String?
  let body: String?
  let source: String
  let contacts: [ContactRef]
}

struct Reminder: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let contactId: String?
  let dueAt: Date
  let note: String
  let completedAt: Date?
  let contact: ContactRef?
}

struct ContactDetail: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let name: String
  let company: String?
  let title: String?
  let location: String?
  let avatarUrl: String?
  let about: String?
  let birthday: String?
  let keepInTouchDays: Int?
  let lastInteractionAt: Date?
  let starred: Bool
  let archived: Bool
  let createdAt: Date
  let identities: [Identity]
  let tags: [String]
  let reminders: [Reminder]
  let interactions: [Interaction]
  let dueAt: Double?
  let sources: [String]

  var subtitle: String { [title, company].compactMap { $0 }.joined(separator: " at ") }
  var openReminders: [Reminder] { reminders.filter { $0.completedAt == nil } }
}

struct HomeData: Codable, Sendable {
  struct Birthday: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let avatarUrl: String?
    let birthday: String
    let inDays: Int
    let sources: [String]
  }
  struct Stats: Codable, Sendable {
    let contacts: Int
    let tracked: Int?
    let interactionsLast30: Int
  }
  let reconnect: [ContactSummary]
  let recent: [Interaction]
  let reminders: [Reminder]
  let birthdays: [Birthday]
  let stats: Stats
}

struct TagCount: Codable, Hashable, Sendable {
  let name: String
  let count: Int
}

// MARK: Duplicates

struct MergeCandidate: Codable, Hashable, Identifiable, Sendable {
  struct IdentityValue: Codable, Hashable, Sendable {
    let kind: String
    let value: String
  }
  let id: String
  let name: String
  let company: String?
  let title: String?
  let location: String?
  let avatarUrl: String?
  let birthday: String?
  let about: String?
  let createdAt: Date
  let tags: [String]
  let sources: [String]
  let identities: [IdentityValue]

  init(_ c: ContactDetail) {
    id = c.id
    name = c.name
    company = c.company
    title = c.title
    location = c.location
    avatarUrl = c.avatarUrl
    birthday = c.birthday
    about = c.about
    createdAt = c.createdAt
    tags = c.tags
    sources = c.sources
    identities = c.identities.map { IdentityValue(kind: $0.kind.rawValue, value: $0.value) }
  }
}

struct DuplicateGroup: Codable, Hashable, Identifiable, Sendable {
  struct Pair: Codable, Hashable, Sendable {
    let ids: [String]
    let score: Double
    let reasons: [String]
  }
  let score: Double
  let confidence: String
  let contacts: [MergeCandidate]
  let pairs: [Pair]
  var id: String { contacts.map(\.id).joined(separator: ":") }
}

struct DuplicatesResponse: Codable, Sendable {
  struct Scan: Codable, Sendable {
    let status: String
    let finishedAt: Date?
    let error: String?
    let stale: Bool
  }
  let total: Int
  let capped: Bool
  let groups: [DuplicateGroup]
  let scan: Scan
}

// MARK: Writes

/// Body for creating or updating a contact. Nil fields are left out of PATCH requests.
struct ContactInput: Encodable, Sendable {
  struct IdentityInput: Encodable, Hashable, Sendable {
    var kind: IdentityKind
    var value: String
    var label: String?
  }
  var name: String?
  var company: String?
  var title: String?
  var location: String?
  var about: String?
  var birthday: String?
  var avatarUrl: String?
  /// Double optional: `.some(nil)` sends JSON null (stop tracking).
  var keepInTouchDays: Int??
  var starred: Bool?
  var archived: Bool?
  var identities: [IdentityInput]?
  var tags: [String]?

  enum CodingKeys: String, CodingKey {
    case name, company, title, location, about, birthday, avatarUrl, keepInTouchDays, starred, archived, identities, tags
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeIfPresent(name, forKey: .name)
    try c.encodeIfPresent(company, forKey: .company)
    try c.encodeIfPresent(title, forKey: .title)
    try c.encodeIfPresent(location, forKey: .location)
    try c.encodeIfPresent(about, forKey: .about)
    try c.encodeIfPresent(birthday, forKey: .birthday)
    try c.encodeIfPresent(avatarUrl, forKey: .avatarUrl)
    if let cadence = keepInTouchDays { try c.encode(cadence, forKey: .keepInTouchDays) }
    try c.encodeIfPresent(starred, forKey: .starred)
    try c.encodeIfPresent(archived, forKey: .archived)
    try c.encodeIfPresent(identities, forKey: .identities)
    try c.encodeIfPresent(tags, forKey: .tags)
  }
}

enum ContactFilter: String, CaseIterable, Identifiable, Sendable {
  case all, starred, reconnect, archived
  var id: String { rawValue }
  var label: String { rawValue.capitalized }
}

let cadenceOptions: [(days: Int?, label: String)] = [
  (nil, "Don't track"), (7, "Every week"), (14, "Every 2 weeks"), (30, "Every month"),
  (60, "Every 2 months"), (90, "Every quarter"), (180, "Every 6 months"), (365, "Every year"),
]

func cadenceLabel(_ days: Int?) -> String {
  cadenceOptions.first { $0.days == days }?.label ?? (days.map { "Every \($0) days" } ?? "Don't track")
}
