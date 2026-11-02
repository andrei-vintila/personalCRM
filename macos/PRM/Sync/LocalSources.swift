import Foundation

/// A timeline entry sent to POST /api/import/interactions (same shape as the Node connector's).
struct LocalInteraction: Encodable, Sendable {
  struct Participant: Encodable, Sendable {
    let kind: String
    let value: String
    let name: String?
    let create: Bool
  }
  let externalId: String
  let type: String
  let occurredAt: Date
  let title: String
  let participants: [Participant]
}

struct ReadResult: Sendable {
  let items: [LocalInteraction]
  /// Newest record seen; the next run starts here.
  let lastDate: Date
  let scanned: Int
}

enum LocalSource: String, CaseIterable, Identifiable, Sendable {
  case calls, whatsapp
  var id: String { rawValue }
  var label: String { self == .calls ? "Phone calls" : "WhatsApp" }
  var symbol: String { self == .calls ? "phone" : "bubble.left.and.bubble.right" }
  var detail: String {
    self == .calls
      ? "Answered Phone, FaceTime and WhatsApp calls. Includes iPhone calls when “Calls on Other Devices” is on."
      : "Who you chatted with and when, from the WhatsApp Mac app. Message text is never read."
  }

  var databaseURL: URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    switch self {
    case .calls: return home.appending(path: "Library/Application Support/CallHistoryDB/CallHistory.storedata")
    case .whatsapp: return home.appending(path: "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")
    }
  }

  /// Reads everything after `since`. Blocking; call off the main actor. Nil when the database doesn't exist.
  /// `database` overrides the default location (used by tests).
  func read(since: Date, database: URL? = nil) throws -> ReadResult? {
    switch self {
    case .calls: try readCalls(since: since, from: database ?? databaseURL)
    case .whatsapp: try readWhatsApp(since: since, from: database ?? databaseURL)
    }
  }
}

/// Core Data stores dates as seconds since 2001-01-01.
private func coreData(_ date: Date) -> Double { date.timeIntervalSinceReferenceDate }
private func fromCoreData(_ seconds: Double) -> Date { Date(timeIntervalSinceReferenceDate: seconds) }

// MARK: Calls

private func readCalls(since: Date, from url: URL) throws -> ReadResult? {
  guard let db = try SQLiteSnapshot(copying: url) else { return nil }
  let cols = db.columns("ZCALLRECORD")
  guard cols.contains("ZADDRESS"), cols.contains("ZDATE") else { throw SyncError.unrecognized("call history has no ZCALLRECORD table") }
  let opt = { (name: String) in cols.contains(name) ? name : "NULL" }
  let rows = try db.rows(
    """
    select \(opt("ZUNIQUE_ID")) as id, ZADDRESS as address, \(opt("ZNAME")) as name, ZDATE as date,
           \(opt("ZDURATION")) as duration, \(opt("ZORIGINATED")) as originated,
           \(opt("ZSERVICE_PROVIDER")) as provider, \(opt("ZCALLTYPE")) as callType
    from ZCALLRECORD where ZDATE > ? order by ZDATE
    """,
    [coreData(since)])

  var items: [LocalInteraction] = []
  var lastDate = since
  for row in rows {
    guard let seconds = row["date"]?.double else { continue }
    let at = fromCoreData(seconds)
    lastDate = max(lastDate, at)
    // Missed and unanswered calls aren't conversations.
    guard let address = row["address"]?.string?.trimmingCharacters(in: .whitespaces), let duration = row["duration"]?.double, duration > 0 else { continue }
    let isEmail = address.contains("@")
    if !isEmail && address.filter(\.isNumber).count < 6 { continue }

    let provider = row["provider"]?.string ?? ""
    let kind = provider.contains("FaceTime") ? (row["callType"]?.double == 8 ? "FaceTime video" : "FaceTime audio") : provider.contains("whatsapp") ? "WhatsApp call" : "call"
    let minutes = max(1, Int((duration / 60).rounded()))
    let name = row["name"]?.string
    items.append(
      LocalInteraction(
        externalId: row["id"]?.string ?? "\(address):\(seconds)",
        type: "call",
        occurredAt: at,
        title: "\(row["originated"]?.bool == true ? "Outgoing" : "Incoming") \(kind) · \(minutes) min",
        // A cached name means the number is in your contacts: worth creating a PRM contact for.
        participants: [.init(kind: isEmail ? "email" : "phone", value: address, name: name, create: name != nil)]))
  }
  return ReadResult(items: items, lastDate: lastDate, scanned: rows.count)
}

// MARK: WhatsApp

private func jidToPhone(_ jid: String?) -> String? {
  // Groups, broadcasts and anonymized @lid ids have no phone number.
  guard let jid, jid.hasSuffix("@s.whatsapp.net") else { return nil }
  let digits = jid.split(separator: "@")[0].filter(\.isNumber)
  return digits.count >= 6 ? "+\(digits)" : nil
}

private func readWhatsApp(since: Date, from url: URL) throws -> ReadResult? {
  guard let db = try SQLiteSnapshot(copying: url) else { return nil }
  for table in ["ZWAMESSAGE", "ZWACHATSESSION"] where db.columns(table).isEmpty {
    throw SyncError.unrecognized("WhatsApp store has no \(table) table")
  }
  let hasMembers = !db.columns("ZWAGROUPMEMBER").isEmpty
  // Re-read whole days so per-day message counts stay complete across runs.
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "UTC")!
  let fromDay = calendar.startOfDay(for: since)
  let rows = try db.rows(
    """
    select m.ZMESSAGEDATE as date, m.ZISFROMME as fromMe, s.ZCONTACTJID as chatJid, s.ZPARTNERNAME as chatName,
           \(hasMembers ? "gm.ZMEMBERJID" : "NULL") as memberJid, \(hasMembers ? "gm.ZCONTACTNAME" : "NULL") as memberName
    from ZWAMESSAGE m
    join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION
    \(hasMembers ? "left join ZWAGROUPMEMBER gm on gm.Z_PK = m.ZGROUPMEMBER" : "")
    where m.ZMESSAGEDATE > ? order by m.ZMESSAGEDATE
    """,
    [coreData(fromDay)])

  struct Day {
    let chatJid: String
    let chatName: String?
    let isGroup: Bool
    var at: Date
    var count = 0
    var mine = 0
    var members: [String: String?] = [:]
  }
  var days: [String: Day] = [:]
  var order: [String] = []
  var lastDate = since
  let dayFormat = Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()

  for row in rows {
    guard let jid = row["chatJid"]?.string, !jid.hasSuffix("@broadcast"), !jid.hasPrefix("status@"), let seconds = row["date"]?.double else { continue }
    let at = fromCoreData(seconds)
    lastDate = max(lastDate, at)
    let key = "\(jid):\(at.formatted(dayFormat))"
    if days[key] == nil {
      days[key] = Day(chatJid: jid, chatName: row["chatName"]?.string, isGroup: jid.hasSuffix("@g.us"), at: at)
      order.append(key)
    }
    days[key]!.at = max(days[key]!.at, at)
    days[key]!.count += 1
    if row["fromMe"]?.bool == true {
      days[key]!.mine += 1
    } else if days[key]!.isGroup, let phone = jidToPhone(row["memberJid"]?.string) {
      days[key]!.members[phone] = row["memberName"]?.string
    }
  }

  let items: [LocalInteraction] = order.compactMap { key in
    let day = days[key]!
    let participants: [LocalInteraction.Participant]
    if day.isGroup {
      participants = day.members.prefix(20).map { .init(kind: "phone", value: $0.key, name: $0.value, create: false) }
    } else if let phone = jidToPhone(day.chatJid) {
      // People you wrote to become contacts; inbound-only chats just link.
      participants = [.init(kind: "phone", value: phone, name: day.chatName, create: day.mine > 0)]
    } else {
      participants = []
    }
    guard !participants.isEmpty else { return nil }
    let counts = "\(day.count) message\(day.count == 1 ? "" : "s")"
    return LocalInteraction(
      externalId: "wa:\(key)",
      type: "message",
      occurredAt: day.at,
      title: day.isGroup ? "WhatsApp group\(day.chatName.map { " “\($0)”" } ?? "") · \(counts)" : "WhatsApp · \(counts)",
      participants: participants)
  }
  return ReadResult(items: items, lastDate: lastDate, scanned: rows.count)
}
