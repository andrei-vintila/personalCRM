import Foundation
import SQLite3

enum SQLiteValue: Sendable {
  case int(Int64), double(Double), text(String), null

  var double: Double? {
    switch self {
    case .int(let v): Double(v)
    case .double(let v): v
    default: nil
    }
  }
  var string: String? { if case .text(let v) = self { v } else { nil } }
  var bool: Bool { (double ?? 0) != 0 }
}

enum SyncError: LocalizedError {
  case noFullDiskAccess
  case unrecognized(String)
  case sqlite(String)

  var errorDescription: String? {
    switch self {
    case .noFullDiskAccess: "PRM needs Full Disk Access to read this."
    case .unrecognized(let what): "Unrecognized database: \(what)"
    case .sqlite(let message): "SQLite: \(message)"
    }
  }
}

/// Read-only copy of a live SQLite database (plus its WAL files), so the app that owns it
/// is never locked or modified. The copy is deleted when this object goes away.
final class SQLiteSnapshot {
  private var db: OpaquePointer?
  private let directory: URL

  init?(copying source: URL) throws {
    let fm = FileManager.default
    guard fm.fileExists(atPath: source.path) else { return nil }
    directory = fm.temporaryDirectory.appending(path: "prm-sync-\(UUID().uuidString)")
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    let copy = directory.appending(path: "db.sqlite")
    do {
      try fm.copyItem(at: source, to: copy)
      for suffix in ["-wal", "-shm"] {
        let extra = URL(fileURLWithPath: source.path + suffix)
        if fm.fileExists(atPath: extra.path) { try fm.copyItem(at: extra, to: URL(fileURLWithPath: copy.path + suffix)) }
      }
    } catch let error as CocoaError where error.code == .fileReadNoPermission {
      try? fm.removeItem(at: directory)
      throw SyncError.noFullDiskAccess
    }
    guard sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
      try? fm.removeItem(at: directory)
      throw SyncError.sqlite(message)
    }
  }

  deinit {
    sqlite3_close(db)
    try? FileManager.default.removeItem(at: directory)
  }

  func columns(_ table: String) -> Set<String> {
    (try? rows("pragma table_info(\(table))").compactMap { $0["name"]?.string }).map(Set.init) ?? []
  }

  func rows(_ sql: String, _ args: [Double] = []) throws -> [[String: SQLiteValue]] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw SyncError.sqlite(String(cString: sqlite3_errmsg(db))) }
    defer { sqlite3_finalize(statement) }
    for (index, value) in args.enumerated() { sqlite3_bind_double(statement, Int32(index + 1), value) }

    var result: [[String: SQLiteValue]] = []
    while sqlite3_step(statement) == SQLITE_ROW {
      var row: [String: SQLiteValue] = [:]
      for column in 0..<sqlite3_column_count(statement) {
        let name = String(cString: sqlite3_column_name(statement, column))
        switch sqlite3_column_type(statement, column) {
        case SQLITE_INTEGER: row[name] = .int(sqlite3_column_int64(statement, column))
        case SQLITE_FLOAT: row[name] = .double(sqlite3_column_double(statement, column))
        case SQLITE_TEXT: row[name] = .text(String(cString: sqlite3_column_text(statement, column)))
        default: row[name] = .null
        }
      }
      result.append(row)
    }
    return result
  }
}

/// Full Disk Access can't be queried directly; this file is only readable with it.
func hasFullDiskAccess() -> Bool {
  let probe = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/com.apple.TCC/TCC.db")
  return FileManager.default.isReadableFile(atPath: probe.path)
}
