import SwiftUI

@main
struct PRMApp: App {
  @State private var app = AppModel()
  @State private var sync = SyncModel()

  var body: some Scene {
    WindowGroup("PRM", id: "main") {
      RootView()
        .environment(app)
        .environment(sync)
        .frame(minWidth: 960, minHeight: 600)
        .task { sync.start(app: app) }
    }
    .defaultSize(width: 1240, height: 780)
    .commands {
      CommandGroup(after: .newItem) {
        Button("New Contact") { NotificationCenter.default.post(name: .newContact, object: nil) }
          .keyboardShortcut("n")
          .disabled(!app.isSignedIn)
      }
      CommandMenu("Contacts") {
        Button("Refresh") { app.changed() }.keyboardShortcut("r")
        Divider()
        ForEach(SidebarItem.allCases) { item in
          Button(item.label) { app.sidebar = item }
            .keyboardShortcut(KeyEquivalent(Character(String(SidebarItem.allCases.firstIndex(of: item)! + 1))), modifiers: .command)
        }
      }
    }

    Settings {
      SettingsView()
        .environment(app)
        .environment(sync)
    }
  }
}

extension Notification.Name {
  static let newContact = Notification.Name("PRM.newContact")
}
