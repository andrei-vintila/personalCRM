import SwiftUI

/// Three columns, like Mail: sections | list | selected contact.
struct MainView: View {
  @Environment(AppModel.self) private var app
  @State private var duplicateCount = 0
  @State private var creating = false

  var body: some View {
    @Bindable var app = app
    NavigationSplitView {
      List(selection: $app.sidebar) {
        ForEach(SidebarItem.allCases) { item in
          Label(item.label, systemImage: item.symbol)
            .badge(item == .duplicates ? duplicateCount : 0)
            .tag(item)
        }
      }
      .navigationSplitViewColumnWidth(min: 180, ideal: 200)
    } content: {
      Group {
        switch app.sidebar ?? .home {
        case .home: HomeView()
        case .contacts: ContactsListView()
        case .reminders: RemindersView()
        case .duplicates: DuplicatesView()
        case .sync: SyncView()
        }
      }
      .navigationSplitViewColumnWidth(min: 300, ideal: 360)
    } detail: {
      if let id = app.selectedContactID {
        ContactDetailView(contactID: id).id(id)
      } else {
        ContentUnavailableView("No Contact Selected", systemImage: "person.crop.circle", description: Text("Pick someone from the list."))
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New Contact", systemImage: "plus") }
          .help("New contact (⌘N)")
      }
    }
    .sheet(isPresented: $creating) {
      ContactEditorView(contact: nil) { created in app.selectedContactID = created.id }
    }
    .onReceive(NotificationCenter.default.publisher(for: .newContact)) { _ in creating = true }
    .task(id: app.revision) {
      duplicateCount = await app.run { try await $0.duplicates().total } ?? duplicateCount
    }
  }
}
