import SwiftUI

/// Create (contact == nil) or edit a contact in a sheet.
struct ContactEditorView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let contact: ContactDetail?
  let onSaved: (ContactDetail) -> Void

  @State private var name = ""
  @State private var company = ""
  @State private var title = ""
  @State private var location = ""
  @State private var birthday = ""
  @State private var avatarUrl = ""
  @State private var about = ""
  @State private var tags = ""
  @State private var cadence: Int?
  @State private var identities: [ContactInput.IdentityInput] = []
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          TextField("Name", text: $name)
          TextField("Company", text: $company)
          TextField("Title", text: $title)
          TextField("Location", text: $location)
          TextField("Birthday", text: $birthday, prompt: Text("YYYY-MM-DD or --MM-DD"))
        }
        Section("Contact details") {
          ForEach($identities.indices, id: \.self) { index in
            HStack {
              Picker("Kind", selection: $identities[index].kind) {
                ForEach(IdentityKind.allCases) { Text($0.label).tag($0) }
              }
              .labelsHidden()
              .frame(width: 110)
              TextField("Value", text: $identities[index].value, prompt: Text(identities[index].kind.placeholder)).labelsHidden()
              TextField("Label", text: Binding(get: { identities[index].label ?? "" }, set: { identities[index].label = $0.isEmpty ? nil : $0 }), prompt: Text("Label"))
                .labelsHidden()
                .frame(width: 90)
              Button { identities.remove(at: index) } label: { Image(systemName: "minus.circle.fill").foregroundStyle(.red) }
                .buttonStyle(.plain)
            }
          }
          Button { identities.append(.init(kind: .email, value: "")) } label: { Label("Add email, phone or link", systemImage: "plus.circle.fill") }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
        }
        Section {
          Picker("Keep in touch", selection: $cadence) {
            ForEach(cadenceOptions, id: \.label) { Text($0.label).tag($0.days) }
          }
          TextField("Tags", text: $tags, prompt: Text("friends, berlin"))
          TextField("Photo URL", text: $avatarUrl)
        }
        Section("About") {
          TextEditor(text: $about).frame(minHeight: 70)
        }
      }
      .formStyle(.grouped)

      if let error {
        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.callout).padding(.horizontal)
      }
      HStack {
        Spacer()
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Button(contact == nil ? "Create" : "Save", action: save)
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
      }
      .padding()
    }
    // Fits small windows: the form scrolls and the buttons stay visible.
    .frame(width: 520)
    .frame(minHeight: 420, idealHeight: 600, maxHeight: 640)
    .onAppear(perform: load)
  }

  private func load() {
    guard let c = contact else {
      identities = [.init(kind: .email, value: "")]
      return
    }
    name = c.name
    company = c.company ?? ""
    title = c.title ?? ""
    location = c.location ?? ""
    birthday = c.birthday ?? ""
    avatarUrl = c.avatarUrl ?? ""
    about = c.about ?? ""
    tags = c.tags.joined(separator: ", ")
    cadence = c.keepInTouchDays
    identities = c.identities.map { .init(kind: $0.kind, value: $0.value, label: $0.label) }
  }

  private func save() {
    let trimmed = { (s: String) -> String in s.trimmingCharacters(in: .whitespacesAndNewlines) }
    // Empty strings clear a field (the API treats "" as null).
    let input = ContactInput(
      name: trimmed(name),
      company: trimmed(company),
      title: trimmed(title),
      location: trimmed(location),
      about: trimmed(about),
      birthday: trimmed(birthday),
      avatarUrl: trimmed(avatarUrl),
      keepInTouchDays: .some(cadence),
      identities: identities.filter { !trimmed($0.value).isEmpty },
      tags: tags.split(separator: ",").map { trimmed(String($0)) }.filter { !$0.isEmpty })
    saving = true
    error = nil
    Task {
      do {
        let saved: ContactDetail
        if let contact {
          saved = try await app.api.updateContact(contact.id, input)
        } else {
          saved = try await app.api.createContact(input)
        }
        app.changed()
        onSaved(saved)
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
      saving = false
    }
  }
}

struct RemindersView: View {
  @Environment(AppModel.self) private var app
  @State private var showDone = false
  @State private var reminders: [Reminder]?

  var body: some View {
    @Bindable var app = app
    List(selection: $app.selectedContactID) {
      ForEach(reminders ?? []) { r in
        ReminderRow(reminder: r).tag(r.contact?.id ?? "reminder-\(r.id)")
      }
    }
    .overlay {
      if reminders?.isEmpty == true {
        ContentUnavailableView(showDone ? "Nothing Completed Yet" : "All Done", systemImage: "checkmark.circle", description: Text(showDone ? "" : "Add reminders from a contact."))
      }
    }
    .navigationTitle("Reminders")
    .toolbar {
      Picker("Show", selection: $showDone) {
        Text("Open").tag(false)
        Text("Done").tag(true)
      }
      .pickerStyle(.segmented)
    }
    .task(id: "\(showDone)|\(app.revision)") {
      reminders = await app.run { try await $0.reminders(done: showDone) } ?? reminders
    }
  }
}
