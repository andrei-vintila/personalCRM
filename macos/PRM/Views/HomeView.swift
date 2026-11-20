import SwiftUI

struct HomeView: View {
  @Environment(AppModel.self) private var app
  @State private var data: HomeData?

  var body: some View {
    @Bindable var app = app
    List(selection: $app.selectedContactID) {
      if let data {
        VStack(alignment: .leading, spacing: 4) {
          Text(greeting).font(.title2.bold())
          Text(summary(data.stats)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
        .selectionDisabled()

        Section("Time to reconnect") {
          if data.reconnect.isEmpty {
            Text("You're all caught up.").foregroundStyle(.secondary)
          }
          ForEach(data.reconnect) { c in
            HStack {
              ContactRow(name: c.name, avatarUrl: c.avatarUrl, sources: c.sources, subtitle: "Last talked \(c.lastInteractionAt?.relative ?? "never")")
              Spacer()
              if let due = c.dueAt { Text("due \(Date(timeIntervalSince1970: due / 1000).relative)").font(.caption).foregroundStyle(.orange) }
            }
            .tag(c.id)
          }
        }

        if !data.reminders.isEmpty {
          Section("Reminders this week") {
            ForEach(data.reminders) { r in
              ReminderRow(reminder: r).tag(r.contact?.id ?? "reminder-\(r.id)")
            }
          }
        }

        if !data.birthdays.isEmpty {
          Section("Upcoming birthdays") {
            ForEach(data.birthdays) { b in
              HStack {
                ContactRow(name: b.name, avatarUrl: b.avatarUrl, sources: b.sources, subtitle: birthdayText(b.birthday), avatarSize: 26)
                Spacer()
                Text(b.inDays == 0 ? "today" : "in \(b.inDays)d").font(.caption).foregroundStyle(.secondary)
              }
              .tag(b.id)
            }
          }
        }

        Section("Recent activity") {
          if data.timeline.isEmpty { Text("Nothing logged yet.").foregroundStyle(.secondary) }
          ForEach(data.timeline) { entry in
            switch entry {
            case .birthday(let b):
              BirthdayRow(birthday: b, showPerson: true).tag(b.contact?.id ?? entry.id)
            case .interaction(let i):
              InteractionRow(interaction: i, showPeople: true).tag(i.contacts.first?.id ?? "interaction-\(i.id)")
            }
          }
        }
      }
    }
    .overlay { if data == nil { ProgressView() } }
    .navigationTitle("Home")
    .task(id: app.revision) { data = await app.run { try await $0.home() } ?? data }
  }

  private var greeting: String {
    let hour = Calendar.current.component(.hour, from: Date())
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  }

  private func summary(_ s: HomeData.Stats) -> String {
    "\(s.contacts) \(s.contacts == 1 ? "person" : "people") · \(s.tracked ?? 0) with a keep-in-touch goal · \(s.interactionsLast30) interactions in 30 days"
  }
}
