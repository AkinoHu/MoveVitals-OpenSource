import SwiftUI

struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(HealthSync.self) private var health
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let user = session.user {
                    Section {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.name ?? user.email).font(.headline)
                            if user.name != nil { Text(user.email).font(.subheadline).foregroundStyle(.secondary) }
                        }
                        LabeledContent("Sign-in", value: user.signInMethods.map { $0 == "password" ? String(localized: "Email") : $0.capitalized }.joined(separator: ", "))
                    }

                    Section {
                        Toggle("Cloud sync across devices", isOn: Binding(
                            get: { user.cloudSync },
                            set: { on in Task { await session.setCloudSync(on); if on { await health.sync(cloudSync: true) } } }
                        ))
                    } footer: {
                        Text(user.cloudSync
                             ? "On: Apple Health and Bluetooth data upload to your account and appear on the web and your other devices."
                             : "Off: Apple Health and Bluetooth data stay on this iPhone. Data already in the cloud is kept until you delete it on the web.")
                    }

                    Section("Display") {
                        Picker("Units", selection: Binding(get: { user.units }, set: { u in Task { await session.setUnits(u) } })) {
                            Text("Metric").tag("metric")
                            Text("Imperial").tag("imperial")
                        }
                    }
                }

                Section("MoveVitals on the web") {
                    Link("Dashboard", destination: URL(string: "https://movevitals.com/dashboard")!)
                    Link("Export or delete your data", destination: URL(string: "https://movevitals.com/dashboard/settings")!)
                    Link("Guides", destination: URL(string: "https://movevitals.com/en/guides")!)
                    Link("Privacy Policy", destination: URL(string: "https://movevitals.com/en/privacy")!)
                    Link("Terms of Service", destination: URL(string: "https://movevitals.com/en/terms")!)
                }

                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("MoveVitals \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · \(APIClient.shared.baseURL.host() ?? "")")
                }
            }
            .navigationTitle("Settings")
            .refreshable { await session.refresh() }
            .confirmationDialog("Sign out of MoveVitals on this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
            }
        }
    }
}
