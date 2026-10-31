import SwiftUI

@main
struct MoveVitalsApp: App {
    @State private var session = Session()
    @State private var health = HealthSync()
    @State private var polar = HeartRateSensor()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(health)
                .environment(polar)
                .tint(Theme.accent)
                .task { await session.restore() }
        }
    }
}

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            switch session.state {
            case .loading:
                ProgressView().controlSize(.large)
            case .signedOut:
                WelcomeView()
            case .signedIn:
                MainTabs()
            }
        }
        .animation(.default, value: session.state)
    }
}

struct MainTabs: View {
    // DEBUG builds accept `-MVTab n` to open a given tab (screenshots).
    @State private var tab = UserDefaults.standard.integer(forKey: "MVTab")

    var body: some View {
        TabView(selection: $tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "heart.text.square") }.tag(0)
            ActivitiesView()
                .tabItem { Label("Activities", systemImage: "figure.run") }.tag(1)
            DevicesView()
                .tabItem { Label("Devices", systemImage: "applewatch.radiowaves.left.and.right") }.tag(2)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }.tag(3)
        }
    }
}
