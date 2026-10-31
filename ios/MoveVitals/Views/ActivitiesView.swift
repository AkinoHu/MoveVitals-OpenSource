import SwiftUI

struct ActivitiesView: View {
    @Environment(Session.self) private var session
    @State private var items: [Activity] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if items.isEmpty && !loading {
                    ContentUnavailableView("No activities yet", systemImage: "figure.run", description: Text("Workouts from Apple Watch, Strava, Garmin, Zwift and other sources appear here — duplicates merged into one."))
                }
                ForEach(items) { a in
                    ActivityRow(activity: a, imperial: session.user?.imperial ?? false)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Activities")
            .refreshable { await load() }
            .task { if items.isEmpty { await load() } }
            .overlay { if loading && items.isEmpty { ProgressView() } }
        }
    }

    private func load() async {
        guard session.user?.cloudSync ?? true else { error = String(localized: "Cloud sync is off"); return }
        loading = true
        defer { loading = false }
        do {
            items = try await APIClient.shared.activities(limit: 100)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ActivityRow: View {
    let activity: Activity
    let imperial: Bool

    private var subtitle: String {
        var parts: [String] = []
        let minutes = Int(activity.endTime.timeIntervalSince(activity.startTime) / 60)
        parts.append(minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes) min")
        if let d = activity.distanceM, d > 0 {
            parts.append(imperial ? String(format: "%.2f mi", d / 1609.344) : String(format: "%.2f km", d / 1000))
        }
        if let hr = activity.avgHr { parts.append("\(Int(hr)) bpm") }
        if let p = activity.avgPower { parts.append("\(Int(p)) W") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: MetricFormat.sportIcon(activity.sport))
                .font(.title3)
                .frame(width: 36, height: 36)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.name ?? activity.sport.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                HStack(spacing: 4) {
                    Text(activity.startTime, format: .dateTime.month().day().hour().minute())
                    Text("·")
                    Text(activity.origin.map { "\($0) via \(MetricFormat.source(activity.provider))" } ?? MetricFormat.source(activity.provider))
                    if let n = activity.sources, n > 1 { Text("· \(n) sources merged") }
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}
