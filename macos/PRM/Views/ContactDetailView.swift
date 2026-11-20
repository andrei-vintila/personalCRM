import SwiftUI

struct ContactDetailView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.openURL) private var openURL
  let contactID: String

  @State private var contact: ContactDetail?
  @State private var editing = false
  @State private var mergingWith = false
  @State private var confirmingDelete = false

  var body: some View {
    Group {
      if let c = contact {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            header(c)
            // Two columns when there's room; stacked in narrow windows.
            ViewThatFits(in: .horizontal) {
              HStack(alignment: .top, spacing: 20) {
                activity(c).frame(minWidth: 380, maxWidth: .infinity)
                sidebar(c).frame(width: 270)
              }
              VStack(alignment: .leading, spacing: 20) {
                sidebar(c)
                activity(c)
              }
            }
          }
          .padding(24)
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(contact?.name ?? "")
    .toolbar {
      if let c = contact {
        ToolbarItemGroup {
          Button { update(ContactInput(starred: !c.starred)) } label: {
            Label(c.starred ? "Unstar" : "Star", systemImage: c.starred ? "star.fill" : "star")
          }
          Button { update(ContactInput(archived: !c.archived)) } label: {
            Label(c.archived ? "Unarchive" : "Archive", systemImage: c.archived ? "archivebox.fill" : "archivebox")
          }
          Button { mergingWith = true } label: { Label("Merge With…", systemImage: "arrow.triangle.merge") }
          Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
          Menu {
            Button("Delete Contact…", role: .destructive) { confirmingDelete = true }
          } label: {
            Label("More", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    .sheet(isPresented: $editing) {
      if let contact { ContactEditorView(contact: contact) { _ in } }
    }
    .sheet(isPresented: $mergingWith) {
      if let contact { MergePickerView(contact: contact) }
    }
    .confirmationDialog("Delete \(contact?.name ?? "")?", isPresented: $confirmingDelete) {
      Button("Delete", role: .destructive) {
        Task {
          await app.run { try await $0.deleteContact(contactID) }
          app.selectedContactID = nil
          app.changed()
        }
      }
    } message: {
      Text("Their reminders are deleted too. This can't be undone.")
    }
    .task(id: app.revision) {
      contact = await app.run { try await $0.contact(contactID) } ?? contact
    }
  }

  private func update(_ input: ContactInput) {
    Task {
      await app.run { try await $0.updateContact(contactID, input) }
      app.changed()
    }
  }

  // MARK: Sections

  private func activity(_ c: ContactDetail) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      LogInteractionView(contactID: c.id)
      timeline(c)
    }
  }

  private func sidebar(_ c: ContactDetail) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      keepInTouch(c)
      details(c)
      RemindersBox(contact: c)
    }
  }

  private func header(_ c: ContactDetail) -> some View {
    HStack(alignment: .center, spacing: 16) {
      AvatarView(name: c.name, url: c.avatarUrl, size: 64)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(c.name).font(.title.bold()).textSelection(.enabled)
          SourceIcons(sources: c.sources).imageScale(.large)
          if c.archived { Text("Archived").font(.caption).padding(.horizontal, 6).padding(.vertical, 2).background(.quaternary, in: Capsule()) }
        }
        HStack(spacing: 14) {
          if !c.subtitle.isEmpty { Label(c.subtitle, systemImage: "briefcase") }
          if let location = c.location { Label(location, systemImage: "mappin") }
          if let birthday = c.birthday { Label(birthdayText(birthday), systemImage: "gift") }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        if !c.tags.isEmpty {
          FlowLayout { ForEach(c.tags, id: \.self) { TagChip(text: $0) } }.padding(.top, 2)
        }
      }
    }
  }

  private func keepInTouch(_ c: ContactDetail) -> some View {
    GroupBox {
      VStack(spacing: 8) {
        LabeledContent("Keep in touch", value: cadenceLabel(c.keepInTouchDays))
        LabeledContent("Last interaction", value: c.lastInteractionAt?.relative ?? "never")
        if let due = c.dueAt {
          let date = Date(timeIntervalSince1970: due / 1000)
          LabeledContent("Next catch-up") {
            Text(date < Date() ? "Overdue" : date.relative).foregroundStyle(date < Date() ? .orange : .secondary)
          }
        }
      }
      .font(.callout)
      .padding(4)
    }
  }

  private func details(_ c: ContactDetail) -> some View {
    GroupBox("Contact details") {
      VStack(alignment: .leading, spacing: 6) {
        if c.identities.isEmpty { Text("None yet").foregroundStyle(.secondary) }
        ForEach(c.identities) { identity in
          Button {
            if let url = identity.kind.url(for: identity.value) { openURL(url) }
          } label: {
            HStack {
              Image(systemName: identity.kind.symbol).frame(width: 16).foregroundStyle(.secondary)
              Text(identity.value).lineLimit(1).truncationMode(.middle)
              Spacer()
              if let label = identity.label { Text(label).font(.caption).foregroundStyle(.secondary) }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .contextMenu { Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(identity.value, forType: .string) } }
        }
        if let about = c.about, !about.isEmpty {
          Divider().padding(.vertical, 4)
          Text(about).font(.callout).textSelection(.enabled)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(4)
    }
  }

  private func timeline(_ c: ContactDetail) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Timeline").font(.headline)
      if c.timeline.isEmpty {
        Text("Nothing logged yet.").foregroundStyle(.secondary).padding(.vertical, 8)
      }
      ForEach(c.timeline) { entry in
        switch entry {
        case .birthday(let birthday):
          BirthdayRow(birthday: birthday, showPerson: false).padding(.vertical, 4)
        case .interaction(let interaction):
          InteractionRow(interaction: interaction, showPeople: false)
            .padding(.vertical, 4)
            .contextMenu {
              Button("Delete", role: .destructive) {
                Task {
                  await app.run { try await $0.deleteInteraction(interaction.id) }
                  app.changed()
                }
              }
            }
        }
        Divider()
      }
    }
  }
}

struct InteractionRow: View {
  let interaction: Interaction
  var showPeople: Bool

  private static let sourceLabels = ["gmail": "Gmail", "gcal": "Calendar", "calls": "Phone", "whatsapp": "WhatsApp", "linkedin": "LinkedIn"]

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: interaction.type.symbol)
        .frame(width: 26, height: 26)
        .background(.quaternary, in: Circle())
        .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 2) {
        Text(interaction.title ?? interaction.type.label).fontWeight(.medium).lineLimit(1)
        // People, date and source on their own line so narrow columns don't collide.
        HStack(spacing: 4) {
          if showPeople {
            Text(interaction.contacts.map(\.name).joined(separator: ", ")).foregroundStyle(.tint).lineLimit(1)
            Text("·").foregroundStyle(.tertiary)
          }
          Text([interaction.occurredAt.relative, Self.sourceLabels[interaction.source]].compactMap { $0 }.joined(separator: " · "))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .help(interaction.occurredAt.formatted(date: .complete, time: .shortened))
        }
        .font(.caption)
        if let body = interaction.body, !body.isEmpty {
          Text(body).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
        }
      }
    }
  }
}

struct BirthdayRow: View {
  let birthday: BirthdayEvent
  var showPerson: Bool

  private var title: String {
    let days = birthday.daysFromToday
    let name = showPerson ? birthday.contact?.name : nil
    if let age = birthday.age {
      let verb = days >= 0 ? "turns" : "turned"
      let text = "\(name.map { "\($0) " } ?? "")\(verb) \(age)\(days == 0 ? " today" : "")"
      return name == nil ? text.prefix(1).uppercased() + text.dropFirst() : text
    }
    if let name { return "\(name)’s birthday\(days == 0 ? " is today" : "")" }
    return days == 0 ? "Birthday today" : "Birthday"
  }

  private var when: String {
    let days = birthday.daysFromToday
    if days == 0 { return "today" }
    if abs(days) < 30 {
      return RelativeDateTimeFormatter().localizedString(from: DateComponents(day: days))
    }
    return birthday.day.formatted(date: .abbreviated, time: .omitted)
  }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "gift")
        .frame(width: 26, height: 26)
        .background(Color.accentColor.opacity(0.15), in: Circle())
        .foregroundStyle(.tint)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).fontWeight(.medium).lineLimit(1)
        Text(birthday.daysFromToday > 0 ? "\(when) · upcoming" : when)
          .font(.caption)
          .foregroundStyle(.secondary)
          .help(birthday.day.formatted(date: .complete, time: .omitted))
      }
    }
  }
}

struct LogInteractionView: View {
  @Environment(AppModel.self) private var app
  let contactID: String
  @State private var type: InteractionType = .note
  @State private var text = ""
  @State private var when = Date()
  @State private var saving = false

  var body: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 10) {
        Picker("Type", selection: $type) {
          ForEach(InteractionType.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        TextEditor(text: $text)
          .font(.body)
          .frame(minHeight: 70)
          .scrollContentBackground(.hidden)
          .padding(6)
          .background(.background, in: RoundedRectangle(cornerRadius: 6))
          .overlay(alignment: .topLeading) {
            if text.isEmpty {
              Text(type == .note ? "Write a note…" : "What did you talk about?").foregroundStyle(.tertiary).padding(11).allowsHitTesting(false)
            }
          }
        HStack {
          DatePicker("When", selection: $when).labelsHidden()
          Spacer()
          Button("Log \(type.label)", action: save)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(saving || (type == .note && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
        }
      }
      .padding(4)
    }
  }

  private func save() {
    saving = true
    Task {
      if await app.run({ try await $0.logInteraction(contactIds: [contactID], type: type, body: text, occurredAt: when) }) != nil {
        text = ""
        when = Date()
        app.changed()
      }
      saving = false
    }
  }
}

struct RemindersBox: View {
  @Environment(AppModel.self) private var app
  let contact: ContactDetail
  @State private var note = ""
  @State private var inDays = 7

  var body: some View {
    GroupBox("Reminders") {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(contact.openReminders) { ReminderRow(reminder: $0, showContact: false) }
        HStack {
          TextField("Remind me to…", text: $note).textFieldStyle(.roundedBorder).onSubmit(add)
          Picker("In", selection: $inDays) {
            Text("1 day").tag(1)
            Text("1 week").tag(7)
            Text("1 month").tag(30)
            Text("3 months").tag(90)
          }
          .labelsHidden()
          .frame(width: 90)
        }
      }
      .padding(4)
    }
  }

  private func add() {
    let text = note.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return }
    Task {
      await app.run { try await $0.createReminder(contactId: contact.id, note: text, dueAt: Date().addingTimeInterval(Double(inDays) * 86_400)) }
      note = ""
      app.changed()
    }
  }
}

struct ReminderRow: View {
  @Environment(AppModel.self) private var app
  let reminder: Reminder
  var showContact = true

  var body: some View {
    HStack(spacing: 8) {
      Button {
        Task {
          await app.run { try await $0.setReminder(reminder.id, completed: reminder.completedAt == nil) }
          app.changed()
        }
      } label: {
        Image(systemName: reminder.completedAt == nil ? "circle" : "checkmark.circle.fill")
          .foregroundStyle(reminder.completedAt == nil ? Color.secondary : Color.accentColor)
      }
      .buttonStyle(.plain)
      .help(reminder.completedAt == nil ? "Mark as done" : "Mark as open")
      VStack(alignment: .leading, spacing: 1) {
        Text(reminder.note).strikethrough(reminder.completedAt != nil).lineLimit(2)
        if showContact, let contact = reminder.contact { Text(contact.name).font(.caption).foregroundStyle(.secondary) }
      }
      Spacer()
      let overdue = reminder.completedAt == nil && reminder.dueAt < Date()
      Text(reminder.dueAt.relative).font(.caption).foregroundStyle(overdue ? .orange : .secondary)
    }
    .contextMenu {
      Button("Delete", role: .destructive) {
        Task {
          await app.run { try await $0.deleteReminder(reminder.id) }
          app.changed()
        }
      }
    }
  }
}
