import Charts
import SwiftUI

struct TodayView: View {
    @Environment(Session.self) private var session
    @Environment(HealthSync.self) private var health
    @State private var metrics: [DailyMetric] = []
    @State private var loading = false
    @State private var error: String?

    private static let headline = ["recovery_score", "readiness_score", "hrv_rmssd", "hrv_sdnn", "resting_hr", "sleep_duration", "steps", "active_energy", "weight", "vo2max", "spo2", "respiratory_rate", "body_battery"]

    private var cloudSync: Bool { session.user?.cloudSync ?? true }
    private var imperial: Bool { session.user?.imperial ?? false }

    /// Latest resolved value per metric, plus its 14-day series.
    private var cards: [(code: String, latest: DailyMetric, series: [DailyMetric])] {
        let grouped = Dictionary(grouping: metrics, by: \.metric)
        return Self.headline.compactMap { code in
            guard let series = grouped[code]?.sorted(by: { $0.day < $1.day }), let latest = series.last else { return nil }
            return (code, latest, series)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !cloudSync {
                        LocalModeBanner()
                        LocalSnapshot()
                    } else if cards.isEmpty && !loading {
                        EmptyToday()
                    }
                    if cloudSync {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(cards, id: \.code) { card in
                                MetricCard(code: card.code, latest: card.latest, series: card.series, imperial: imperial)
                            }
                        }
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Today")
            .refreshable { await load(force: true) }
            .task { await load() }
            .overlay { if loading && metrics.isEmpty { ProgressView() } }
        }
    }

    private func load(force: Bool = false) async {
        loading = true
        defer { loading = false }
        if health.authorized, force || health.lastUpload.map({ Date.now.timeIntervalSince($0) > 900 }) ?? true {
            await health.sync(cloudSync: cloudSync)
        }
        guard cloudSync else { return }
        do {
            metrics = try await APIClient.shared.summary(days: 14)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct MetricCard: View {
    let code: String
    let latest: DailyMetric
    let series: [DailyMetric]
    let imperial: Bool

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Text(MetricFormat.title(code)).font(.caption).foregroundStyle(.secondary)
                Text(MetricFormat.value(code, latest.value, imperial: imperial))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if series.count > 1 {
                    Chart(series) { m in
                        LineMark(x: .value("Day", m.day), y: .value("Value", m.value))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(Color.primary.opacity(0.7))
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .chartYScale(domain: .automatic(includesZero: false))
                    .frame(height: 32)
                }
                HStack(spacing: 4) {
                    Text(MetricFormat.source(latest.source))
                    if latest.conflict { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.accent) }
                    Spacer()
                    Text(String(latest.day.suffix(5)))
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)
            }
        }
    }
}

struct LocalModeBanner: View {
    var body: some View {
        Card {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Cloud sync is off").font(.subheadline.weight(.semibold))
                    Text("Apple Health and Bluetooth data stay on this iPhone. Turn sync on in Settings to see everything from all your devices.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "icloud.slash").foregroundStyle(Theme.accent)
            }
        }
    }
}

struct LocalSnapshot: View {
    @Environment(HealthSync.self) private var health
    @Environment(Session.self) private var session

    var body: some View {
        let order = ["steps", "active_energy", "resting_hr", "hrv_sdnn", "sleep_duration"]
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(order.filter { health.snapshot[$0] != nil }, id: \.self) { code in
                Card {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(MetricFormat.title(code)).font(.caption).foregroundStyle(.secondary)
                        Text(MetricFormat.value(code, health.snapshot[code]!, imperial: session.user?.imperial ?? false))
                            .font(.title3.weight(.semibold)).monospacedDigit()
                        Text("Apple Health · on this iPhone").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

struct EmptyToday: View {
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("No data yet").font(.headline)
                Text("Connect Apple Health in the Devices tab, or link WHOOP, Oura, Garmin, Strava and more on movevitals.com.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Link("Open connections", destination: URL(string: "https://movevitals.com/dashboard/connections")!)
                    .font(.subheadline.weight(.medium))
            }
        }
    }
}
