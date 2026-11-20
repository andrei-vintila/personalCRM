import Contacts
import Foundation

/// A birthday from the Mac's Contacts app, sent to POST /api/import/birthdays.
/// The server only fills in birthdays for people it already has; nobody new is created.
struct AddressBookBirthday: Encodable, Hashable, Sendable {
  struct Identity: Encodable, Hashable, Sendable {
    let kind: String
    let value: String
  }
  /// YYYY-MM-DD, or --MM-DD without a year
  let birthday: String
  let identities: [Identity]
}

enum AddressBook {
  static var isAuthorized: Bool { CNContactStore.authorizationStatus(for: .contacts) == .authorized }
  static var isDenied: Bool {
    let status = CNContactStore.authorizationStatus(for: .contacts)
    return status == .denied || status == .restricted
  }

  /// Shows the system prompt the first time; afterwards returns the stored answer.
  static func requestAccess() async -> Bool {
    (try? await CNContactStore().requestAccess(for: .contacts)) ?? false
  }

  /// Everyone in Contacts with a birthday and at least one email or phone. Blocking; call off the main actor.
  static func readBirthdays() throws -> [AddressBookBirthday] {
    let keys = [CNContactBirthdayKey, CNContactEmailAddressesKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]
    var out: [AddressBookBirthday] = []
    try CNContactStore().enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { contact, _ in
      guard let birthday = contact.birthday.flatMap(formatBirthday) else { return }
      let identities =
        contact.emailAddresses.map { AddressBookBirthday.Identity(kind: "email", value: $0.value as String) }
        + contact.phoneNumbers.map { AddressBookBirthday.Identity(kind: "phone", value: $0.value.stringValue) }
      guard !identities.isEmpty else { return }
      out.append(AddressBookBirthday(birthday: birthday, identities: Array(identities.prefix(20))))
    }
    return out
  }

  private static func formatBirthday(_ c: DateComponents) -> String? {
    guard let month = c.month, let day = c.day, (1...12).contains(month), (1...31).contains(day) else { return nil }
    // Contacts uses 1604 as the year for "no year".
    let year = c.year.flatMap { $0 > 1604 && $0 < 2100 ? $0 : nil }
    return String(format: "%@-%02d-%02d", year.map { String(format: "%04d", $0) } ?? "-", month, day)
  }
}
