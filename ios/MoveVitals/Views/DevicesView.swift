import SwiftUI

struct DevicesView: View {
    @Environment(Session.self) private var session
    @Environment(HealthSync.self) private var health

    var body: some View {
        NavigationStack {
            List {
                Section {
                    AppleHealthRow()
                } header: {
                    Text("On this iPhone")
                } footer: {
                    Text(session.user?.cloudSync ?? true
                         ? "Apple Health data is uploaded to your MoveVitals account so you can see it on the web and other devices."
                         : "Cloud sync is off: Apple Health data stays on this iPhone.")
                }

                Section("Bluetooth sensors") {
                    NavigationLink {
                        HeartRateSensorView()
                    } label: {
                        Label("Polar H10 / heart-rate strap", systemImage: "heart.circle")
                    }
                }

                Section {
                    ForEach(session.user?.connections ?? []) { c in
                        HStack {
                            Text(MetricFormat.source(c.provider))
                            Spacer()
                            if let at = c.lastSyncAt {
                                Text(at, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
                            }
                            Circle().fill(c.status == "active" ? Color.green : Theme.accent).frame(width: 7, height: 7)
                        }
                    }
                    Link(destination: URL(string: "https://movevitals.com/dashboard/connections")!) {
                        Label("Connect more on movevitals.com", systemImage: "arrow.up.right.square")
                    }
                } header: {
                    Text("Cloud platforms")
                } footer: {
                    Text("WHOOP, Oura, Garmin, Strava, Polar, Withings and others sync in the cloud — even when your phone is off.")
                }
            }
            .navigationTitle("Devices")
            .refreshable { await session.refresh() }
        }
    }
}

struct AppleHealthRow: View {
    @Environment(Session.self) private var session
    @Environment(HealthSync.self) private var health

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "heart.fill").foregroundStyle(.pink)
                Text("Apple Health").font(.headline)
                Spacer()
                statusText.font(.caption).foregroundStyle(.secondary)
            }
            if !health.available {
                Text("Apple Health isn't available on this device.").font(.footnote).foregroundStyle(.secondary)
            } else if !health.authorized {
                Button("Connect Apple Health") { Task { await health.requestAuthorization(); await health.sync(cloudSync: session.user?.cloudSync ?? true) } }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                Button {
                    Task { await health.sync(cloudSync: session.user?.cloudSync ?? true) }
                } label: {
                    if health.status == .syncing { ProgressView().frame(maxWidth: .infinity) } else { Text("Sync now").frame(maxWidth: .infinity) }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(health.status == .syncing || !(session.user?.cloudSync ?? true))
                Text("To choose which data MoveVitals can read, open Settings › Health › Data Access & Devices › MoveVitals.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusText: Text {
        switch health.status {
        case .syncing: Text("Syncing…")
        case .failed(let m): Text(m)
        case .done(let at): Text("Synced \(at, format: .relative(presentation: .named))")
        case .idle:
            if let at = health.lastUpload { Text("Synced \(at, format: .relative(presentation: .named))") } else { Text(health.authorized ? "Ready" : "Not connected") }
        }
    }
}

struct HeartRateSensorView: View {
    @Environment(HeartRateSensor.self) private var sensor
    @Environment(Session.self) private var session
    @State private var uploadMessage: String?

    var body: some View {
        List {
            Section {
                VStack(spacing: 6) {
                    Text(sensor.heartRate.map(String.init) ?? "—")
                        .font(.system(size: 64, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Text("bpm").foregroundStyle(.secondary)
                    if let name = sensor.deviceName, sensor.state == .connected {
                        Text(name).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            switch sensor.state {
            case .off:
                Text("Turn on Bluetooth to connect a sensor.").foregroundStyle(.secondary)
            case .unauthorized:
                Text("Allow Bluetooth access for MoveVitals in Settings.").foregroundStyle(.secondary)
            case .connected:
                HRVReadingSection(uploadMessage: $uploadMessage)
                Button("Disconnect", role: .destructive) { sensor.disconnect() }
            default:
                Section {
                    if sensor.found.isEmpty {
                        HStack { ProgressView(); Text("Searching… wet the strap's electrodes and put it on.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    ForEach(sensor.found) { d in
                        Button { sensor.connect(d.id) } label: {
                            HStack { Text(d.name); Spacer(); if sensor.state == .connecting { ProgressView() } }
                        }
                    }
                } header: { Text("Nearby sensors") }
            }
        }
        .navigationTitle("Heart-rate sensor")
        .onAppear { if sensor.state != .connected { sensor.startScan() } }
        .onDisappear { sensor.stopScan() }
    }
}

struct HRVReadingSection: View {
    @Environment(HeartRateSensor.self) private var sensor
    @Environment(Session.self) private var session
    @Binding var uploadMessage: String?

    var body: some View {
        Section {
            if let r = sensor.reading {
                if r.finished {
                    if let rmssd = r.rmssd {
                        LabeledContent("HRV (RMSSD)", value: "\(Int(rmssd.rounded())) ms")
                        if let hr = r.avgHr { LabeledContent("Average heart rate", value: "\(Int(hr)) bpm") }
                        if r.uploaded {
                            Label("Saved to MoveVitals", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        } else if session.user?.cloudSync ?? true {
                            Button("Save reading") { Task { uploadMessage = await sensor.uploadReading(cloudSync: true) ? nil : String(localized: "Couldn't save — try again") } }
                        } else {
                            Text("Cloud sync is off, so the reading stays on this iPhone.").font(.footnote).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("Not enough clean beats. Sit still and try again.").foregroundStyle(.secondary)
                    }
                    Button("New reading") { sensor.startReading() }
                } else {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let left = max(0, Int(r.duration - ctx.date.timeIntervalSince(r.startedAt)))
                        VStack(alignment: .leading, spacing: 6) {
                            ProgressView(value: min(1, ctx.date.timeIntervalSince(r.startedAt) / r.duration))
                            Text("Sit still and breathe normally · \(left) s left · \(r.intervals.count) beats").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Button("Cancel", role: .cancel) { sensor.cancelReading() }
                }
            } else {
                Button("Take a 2-minute HRV reading") { sensor.startReading() }
                Text("Best done in the morning, sitting or lying still. The reading is saved as HRV (RMSSD) from your strap.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let uploadMessage { Text(uploadMessage).font(.footnote).foregroundStyle(.red) }
        } header: { Text("HRV reading") }
    }
}
