import SwiftUI

/// Calls & WhatsApp: built-in replacement for the Node connector.
struct SyncView: View {
  @Environment(AppModel.self) private var app
  @Environment(SyncModel.self) private var sync
  @Environment(\.openURL) private var openURL

  var body: some View {
    @Bindable var sync = sync
    Form {
      if !sync.fullDiskAccess {
        Section {
          VStack(alignment: .leading, spacing: 8) {
            Label("Full Disk Access needed", systemImage: "lock.shield").font(.headline)
            Text("Your call history and WhatsApp chats are protected by macOS. Turn on PRM under Full Disk Access, then come back.")
              .foregroundStyle(.secondary)
            HStack {
              Button("Open Privacy Settings") {
                openURL(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
              }
              .buttonStyle(.borderedProminent)
              Button("Check Again") { sync.fullDiskAccess = hasFullDiskAccess() }
            }
          }
          .padding(.vertical, 4)
        }
      }

      Section {
        ForEach(LocalSource.allCases) { source in
          VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(get: { sync.isEnabled(source) }, set: { sync.setEnabled(source, $0) })) {
              Label(source.label, systemImage: source.symbol).fontWeight(.medium)
            }
            Text(source.detail).font(.caption).foregroundStyle(.secondary)
            let status = sync.statuses[source]
            if let error = status?.error {
              Label(error, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
            } else if let lastRun = status?.lastRun {
              Text("\(status?.summary ?? "Synced") · \(lastRun.relative)").font(.caption).foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 2)
        }
      } header: {
        Text("Sources")
      } footer: {
        Text("Only who and when is sent. Callers in your contacts and people you message become contacts; others only link to people you already have.")
      }

      Section {
        Toggle("Sync automatically every 30 minutes", isOn: $sync.autoSync)
        HStack {
          Button {
            Task { await sync.syncNow(app: app) }
          } label: {
            if sync.isRunning { ProgressView().controlSize(.small) } else { Text("Sync Now") }
          }
          .disabled(sync.isRunning)
          Spacer()
          Button("Re-sync Last 180 Days") {
            sync.resetProgress()
            Task { await sync.syncNow(app: app) }
          }
          .help("Safe to repeat: entries are de-duplicated on the server.")
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Calls & WhatsApp")
    .onAppear { sync.fullDiskAccess = hasFullDiskAccess() }
  }
}

struct SettingsView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    Form {
      Section("Account") {
        LabeledContent("Server", value: app.serverURL?.absoluteString ?? "—")
        LabeledContent("Status", value: app.isSignedIn ? "Signed in with an API token" : "Signed out")
        if app.isSignedIn {
          Button("Sign Out", role: .destructive) { app.signOut() }
        }
      }
      Section {
        Text("The token this Mac uses appears under Settings → API tokens on the web, where you can revoke it.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 460, height: 220)
  }
}
