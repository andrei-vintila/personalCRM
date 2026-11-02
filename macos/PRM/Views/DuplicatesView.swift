import SwiftUI

struct DuplicatesView: View {
  @Environment(AppModel.self) private var app
  @State private var data: DuplicatesResponse?
  @State private var requested = false
  @State private var merging: [MergeCandidate]?

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 12) {
        if let data {
          if data.groups.isEmpty {
            ContentUnavailableView(data.scan.finishedAt == nil ? "Waiting for the First Scan" : "No Duplicates", systemImage: "checkmark.seal")
              .padding(.top, 60)
          }
          ForEach(data.groups) { group in
            DuplicateGroupCard(group: group) { merging = $0 }
          }
          if data.total > data.groups.count {
            Text("Showing the top \(data.groups.count) of \(data.total)\(data.capped ? "+" : ""). Merge or dismiss these to see more.")
              .font(.caption).foregroundStyle(.secondary)
          }
        }
      }
      .padding()
    }
    .overlay { if data == nil { ProgressView() } }
    .navigationTitle("Duplicates")
    .navigationSubtitle(statusText)
    .toolbar {
      Button { scan() } label: { Label("Scan Now", systemImage: "arrow.clockwise") }
        .disabled(data?.scan.status == "running")
    }
    .sheet(item: Binding(get: { merging.map(MergeSelection.init) }, set: { merging = $0?.contacts })) { selection in
      MergeSheet(candidates: selection.contacts)
    }
    .task(id: app.revision) { await load() }
    // Poll while a background scan runs.
    .task(id: data?.scan.status) {
      while data?.scan.status == "running", !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1.5))
        await load()
      }
    }
  }

  private var statusText: String {
    guard let scan = data?.scan else { return "" }
    if scan.status == "running" { return "Scanning…" }
    if let error = scan.error, scan.status == "failed" { return "Last scan failed: \(error)" }
    guard let finished = scan.finishedAt else { return "Not scanned yet" }
    return "Scanned \(finished.relative)\(scan.stale ? " · contacts changed since" : "")"
  }

  private func load() async {
    guard let result = await app.run({ try await $0.duplicates() }) else { return }
    data = result
    // Opening this view requests a scan when results are missing or stale.
    if !requested, result.scan.status != "running", result.scan.stale || result.scan.finishedAt == nil {
      requested = true
      scan()
    }
  }

  private func scan() {
    Task {
      await app.run { try await $0.requestDuplicateScan() }
      await load()
    }
  }
}

private struct MergeSelection: Identifiable {
  let contacts: [MergeCandidate]
  var id: String { contacts.map(\.id).joined(separator: ":") }
}

struct DuplicateGroupCard: View {
  @Environment(AppModel.self) private var app
  let group: DuplicateGroup
  let onMerge: ([MergeCandidate]) -> Void
  @State private var selected: Set<String> = []
  @State private var showingReasons = false

  private var multi: Bool { group.contacts.count > 2 }

  var body: some View {
    GroupBox {
      VStack(spacing: 0) {
        ForEach(group.contacts) { c in
          HStack(spacing: 10) {
            if multi {
              Toggle("Include \(c.name)", isOn: Binding(get: { selected.contains(c.id) }, set: { on in if on { selected.insert(c.id) } else { selected.remove(c.id) } }))
                .labelsHidden()
                .toggleStyle(.checkbox)
            }
            ContactRow(name: c.name, avatarUrl: c.avatarUrl, sources: c.sources, subtitle: details(c))
            Spacer()
            if multi {
              Button { dismiss(group.contacts.filter { $0.id != c.id }.map { [c.id, $0.id] }) } label: {
                Image(systemName: "person.crop.circle.badge.xmark")
              }
              .buttonStyle(.borderless)
              .foregroundStyle(.secondary)
              .help("Not this person: remove \(c.name) from this group")
              .accessibilityLabel("Not this person")
            }
          }
          .padding(.vertical, 8)
          .contentShape(Rectangle())
          .onTapGesture(count: 2) { app.selectedContactID = c.id }
          if c.id != group.contacts.last?.id { Divider() }
        }
        Divider().padding(.bottom, 8)
        HStack {
          Button { showingReasons.toggle() } label: { Image(systemName: "info.circle") }
            .buttonStyle(.borderless)
            .help("Why these were matched")
            .popover(isPresented: $showingReasons, arrowEdge: .bottom) { reasons.padding().frame(width: 320) }
          Spacer()
          Button("Not Duplicates") { dismiss(allPairs) }
            .help(multi ? "None of these are the same person" : "These are different people")
          Button(multi ? "Merge \(selected.count)…" : "Merge…") {
            onMerge(group.contacts.filter { selected.contains($0.id) })
          }
          .buttonStyle(.borderedProminent)
          .disabled(selected.count < 2)
        }
      }
      .padding(4)
    }
    .onAppear { selected = Set(group.contacts.map(\.id)) }
  }

  private var reasons: some View {
    let names = Dictionary(uniqueKeysWithValues: group.contacts.map { ($0.id, $0.name) })
    return VStack(alignment: .leading, spacing: 6) {
      Text("\(group.confidence.capitalized) confidence").font(.headline)
      ForEach(group.pairs, id: \.ids) { pair in
        Text((multi ? "\(names[pair.ids[0]] ?? "") ↔ \(names[pair.ids[1]] ?? ""): " : "") + pair.reasons.joined(separator: ", "))
          .font(.callout)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var allPairs: [[String]] {
    let ids = group.contacts.map(\.id)
    return ids.indices.flatMap { i in ids[(i + 1)...].map { [ids[i], $0] } }.prefix(45).map { $0 }
  }

  private func details(_ c: MergeCandidate) -> String {
    ([c.title, c.company].compactMap { $0 } + c.identities.prefix(3).map(\.value)).joined(separator: " · ")
  }

  private func dismiss(_ pairs: [[String]]) {
    Task {
      await app.run { try await $0.dismissDuplicates(pairs: pairs) }
      app.changed()
    }
  }
}

/// Choose which record to keep and which value wins for each conflicting field.
struct MergeSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let candidates: [MergeCandidate]

  @State private var primaryID = ""
  @State private var picks: [String: String] = [:]
  @State private var merging = false
  @State private var error: String?

  private static let fields: [(key: String, label: String, value: (MergeCandidate) -> String?)] = [
    ("name", "Name", { $0.name }),
    ("company", "Company", { $0.company }),
    ("title", "Title", { $0.title }),
    ("location", "Location", { $0.location }),
    ("birthday", "Birthday", { $0.birthday }),
    ("avatarUrl", "Photo", { $0.avatarUrl }),
  ]

  private var conflicts: [(key: String, label: String, values: [String])] {
    Self.fields.compactMap { field in
      var seen: [String] = []
      for c in candidates { if let v = field.value(c), !v.isEmpty, !seen.contains(v) { seen.append(v) } }
      return seen.count > 1 ? (field.key, field.label, seen) : nil
    }
  }

  private func chosen(_ key: String) -> String? {
    if let pick = picks[key] { return pick }
    let primary = candidates.first { $0.id == primaryID }
    let field = Self.fields.first { $0.key == key }!
    return primary.flatMap(field.value) ?? candidates.lazy.compactMap(field.value).first
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Form {
        Section("Keep this record") {
          Picker("Keep", selection: $primaryID) {
            ForEach(candidates) { c in
              ContactRow(name: c.name, avatarUrl: c.avatarUrl, sources: c.sources, subtitle: [c.title, c.company].compactMap { $0 }.joined(separator: " · "))
                .tag(c.id)
            }
          }
          .pickerStyle(.radioGroup)
          .labelsHidden()
        }
        ForEach(conflicts, id: \.key) { field in
          Section(field.label) {
            Picker(field.label, selection: Binding(get: { chosen(field.key) ?? "" }, set: { picks[field.key] = $0 })) {
              ForEach(field.values, id: \.self) { value in
                Text(field.key == "birthday" ? birthdayText(value) : value).lineLimit(1).truncationMode(.middle).tag(value)
              }
            }
            .pickerStyle(.radioGroup)
            .labelsHidden()
          }
        }
        Section {
          let identities = Array(Set(candidates.flatMap { $0.identities.map(\.value) })).sorted()
          let tags = Array(Set(candidates.flatMap(\.tags))).sorted()
          FlowLayout {
            ForEach(identities, id: \.self) { Text($0).font(.caption).padding(.horizontal, 6).padding(.vertical, 2).background(.quaternary, in: Capsule()) }
            ForEach(tags, id: \.self) { TagChip(text: $0) }
          }
          Text("Timelines, reminders and tags are combined and notes are joined. The other \(candidates.count > 2 ? "records are" : "record is") deleted. This can't be undone.")
            .font(.caption).foregroundStyle(.secondary)
        } header: {
          Text("The merged contact keeps everything")
        }
      }
      .formStyle(.grouped)

      if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).padding(.horizontal) }
      HStack {
        Spacer()
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Merge \(candidates.count) Contacts", action: merge)
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(merging)
      }
      .padding()
    }
    .frame(width: 520, height: 560)
    .onAppear {
      // Keep the oldest record by default: it usually has the most history.
      primaryID = candidates.min { $0.createdAt < $1.createdAt }?.id ?? candidates[0].id
    }
  }

  private func merge() {
    merging = true
    let fields = Dictionary(uniqueKeysWithValues: conflicts.map { ($0.key, chosen($0.key)) })
    Task {
      do {
        let merged = try await app.api.merge(into: primaryID, sources: candidates.map(\.id).filter { $0 != primaryID }, fields: fields)
        app.selectedContactID = merged.id
        app.changed()
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
      merging = false
    }
  }
}

/// "Merge With…" on a contact: search for someone, then open the merge sheet.
struct MergePickerView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let contact: ContactDetail
  @State private var query = ""
  @State private var results: [ContactSummary] = []
  @State private var other: ContactDetail?

  var body: some View {
    if let other {
      MergeSheet(candidates: [MergeCandidate(contact), MergeCandidate(other)])
    } else {
      VStack(alignment: .leading, spacing: 10) {
        Text("Merge \(contact.name) with…").font(.headline)
        TextField("Search contacts", text: $query).textFieldStyle(.roundedBorder)
        List(results.filter { $0.id != contact.id }) { c in
          Button {
            Task { other = await app.run { try await $0.contact(c.id) } }
          } label: {
            ContactRow(name: c.name, avatarUrl: c.avatarUrl, sources: c.sources, subtitle: c.subtitle.isEmpty ? (c.email ?? c.phone ?? "") : c.subtitle)
          }
          .buttonStyle(.plain)
        }
        .frame(minHeight: 260)
        HStack {
          Spacer()
          Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        }
      }
      .padding()
      .frame(width: 440)
      .task(id: query) {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { results = []; return }
        try? await Task.sleep(for: .milliseconds(200))
        results = await app.run { try await $0.contacts(query: query) } ?? results
      }
    }
  }
}
