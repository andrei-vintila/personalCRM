import SwiftUI

struct ContactsListView: View {
  @Environment(AppModel.self) private var app
  @State private var contacts: [ContactSummary]?
  @State private var query = ""
  @State private var filter: ContactFilter = .all
  @State private var tag: String?
  @State private var tags: [TagCount] = []

  var body: some View {
    @Bindable var app = app
    List(selection: $app.selectedContactID) {
      ForEach(contacts ?? []) { c in
        HStack {
          ContactRow(name: c.name, avatarUrl: c.avatarUrl, sources: c.sources, subtitle: c.subtitle.isEmpty ? (c.email ?? c.phone ?? "") : c.subtitle, starred: c.starred)
          Spacer()
          if c.isOverdue {
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.orange).help("Time to reconnect")
          }
        }
        .tag(c.id)
        .swipeActions(edge: .leading) {
          Button { setStar(c) } label: { Label(c.starred ? "Unstar" : "Star", systemImage: c.starred ? "star.slash" : "star") }.tint(.yellow)
        }
        .contextMenu {
          Button(c.starred ? "Unstar" : "Star") { setStar(c) }
          Button(c.archived ? "Unarchive" : "Archive") { setArchived(c) }
        }
      }
    }
    .overlay {
      if contacts == nil {
        ProgressView()
      } else if contacts?.isEmpty == true {
        ContentUnavailableView(query.isEmpty ? "No Contacts" : "No Results", systemImage: "person.2", description: Text(query.isEmpty ? "Add someone with ⌘N, or import on the web." : "Try a different search."))
      }
    }
    .navigationTitle("Contacts")
    .navigationSubtitle(contacts.map { "\($0.count)\($0.count >= 500 ? "+" : "")" } ?? "")
    .searchable(text: $query, placement: .sidebar, prompt: "Name, company, email, phone")
    .toolbar {
      ToolbarItemGroup {
        Picker("Filter", selection: $filter) {
          ForEach(ContactFilter.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.menu)
        .help("Filter")
        if !tags.isEmpty {
          Menu {
            Button("All tags") { tag = nil }
            Divider()
            ForEach(tags, id: \.name) { t in
              Button { tag = t.name } label: {
                if tag == t.name { Label("\(t.name) (\(t.count))", systemImage: "checkmark") } else { Text("\(t.name) (\(t.count))") }
              }
            }
          } label: {
            Label(tag ?? "Tags", systemImage: tag == nil ? "tag" : "tag.fill")
          }
          .help("Filter by tag")
        }
      }
    }
    .task(id: "\(query)|\(filter.rawValue)|\(tag ?? "")|\(app.revision)") {
      // Debounce typing.
      if !query.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
      guard !Task.isCancelled else { return }
      contacts = await app.run { try await $0.contacts(query: query, filter: filter, tag: tag) } ?? contacts
    }
    .task(id: app.revision) { tags = await app.run { try await $0.tags() } ?? tags }
  }

  private func setStar(_ c: ContactSummary) {
    Task {
      await app.run { try await $0.updateContact(c.id, ContactInput(starred: !c.starred)) }
      app.changed()
    }
  }

  private func setArchived(_ c: ContactSummary) {
    Task {
      await app.run { try await $0.updateContact(c.id, ContactInput(archived: !c.archived)) }
      app.changed()
    }
  }
}
