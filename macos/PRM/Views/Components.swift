import SwiftUI

/// Circle with a photo, or initials on a color derived from the name.
struct AvatarView: View {
  let name: String
  var url: String?
  var size: CGFloat = 32

  private static let palette: [Color] = [.pink, .orange, .green, .teal, .indigo, .purple]

  var body: some View {
    let color = Self.palette[abs(name.unicodeScalars.reduce(7) { $0 &* 31 &+ Int($1.value) }) % Self.palette.count]
    ZStack {
      Circle().fill(color.opacity(0.18))
      Text(initials).font(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(color)
      if let url, let parsed = URL(string: url) {
        AsyncImage(url: parsed) { image in image.resizable().scaledToFill() } placeholder: { Color.clear }
          .clipShape(Circle())
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var initials: String {
    let parts = name.split(separator: " ")
    let first = parts.first?.first.map(String.init) ?? ""
    let last = parts.count > 1 ? parts.last!.first.map(String.init) ?? "" : ""
    return (first + last).uppercased()
  }
}

/// Small glyphs for where someone is known from (Gmail, Calendar, LinkedIn, calls, ...).
struct SourceIcons: View {
  let sources: [String]

  static func label(_ source: String) -> String {
    switch source {
    case "manual": "Added manually"
    case "google": "Google Contacts"
    case "gmail": "Gmail"
    case "gcal": "Google Calendar"
    case "linkedin": "LinkedIn"
    case "calls": "Calls"
    case "whatsapp": "WhatsApp"
    case "generic": "CSV import"
    default: source
    }
  }

  var body: some View {
    HStack(spacing: 3) {
      ForEach(sources, id: \.self) { source in
        icon(source)
          .help(Self.label(source))
          .accessibilityLabel(Self.label(source))
      }
    }
    .foregroundStyle(.secondary)
  }

  @ViewBuilder private func icon(_ source: String) -> some View {
    switch source {
    case "linkedin":
      // No LinkedIn glyph in SF Symbols; a tiny "in" badge reads clearly.
      Text("in").font(.system(size: 7.5, weight: .heavy)).foregroundStyle(.background)
        .frame(width: 11, height: 11).background(.secondary, in: RoundedRectangle(cornerRadius: 2.5))
    default:
      Image(systemName: Self.symbol(source)).font(.system(size: 10.5))
    }
  }

  static func symbol(_ source: String) -> String {
    switch source {
    case "manual": "pencil"
    case "google": "person.crop.square"
    case "gmail": "envelope"
    case "gcal": "calendar"
    case "calls": "phone"
    case "whatsapp": "bubble.left"
    case "generic": "tablecells"
    default: "tray"
    }
  }
}

struct TagChip: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.caption.weight(.medium))
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background(.tint.opacity(0.14), in: Capsule())
      .foregroundStyle(.tint)
  }
}

/// Wraps children onto multiple lines, for tags and chips.
struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
    return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

  private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
    var rows = [Row()]
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > width { rows.append(Row()) }
      var row = rows[rows.count - 1]
      row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
      rows[rows.count - 1] = row
    }
    return rows
  }
}

/// A contact line used across lists: avatar, name, source icons, subtitle.
struct ContactRow: View {
  let name: String
  let avatarUrl: String?
  let sources: [String]
  var subtitle: String = ""
  var starred = false
  var avatarSize: CGFloat = 30

  var body: some View {
    HStack(spacing: 10) {
      AvatarView(name: name, url: avatarUrl, size: avatarSize)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 5) {
          Text(name).fontWeight(.medium).lineLimit(1)
          if starred { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
          SourceIcons(sources: sources)
        }
        if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
      }
    }
  }
}

extension Date {
  /// "3 days ago", "in 2 weeks"
  var relative: String { formatted(.relative(presentation: .named)) }
}

func birthdayText(_ birthday: String) -> String {
  let parts = birthday.split(separator: "-", omittingEmptySubsequences: false)
  guard parts.count >= 3, let month = Int(parts[parts.count - 2]), let day = Int(parts[parts.count - 1]) else { return birthday }
  let year = Int(parts[0])
  var components = DateComponents(year: year ?? 2000, month: month, day: day)
  components.calendar = Calendar(identifier: .gregorian)
  guard let date = components.date else { return birthday }
  return year != nil ? date.formatted(date: .long, time: .omitted) : date.formatted(.dateTime.month(.wide).day())
}
