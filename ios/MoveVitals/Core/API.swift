import Foundation

// MoveVitals web API (see src/app/api/mobile/* and /api/ingest on the server).

struct User: Codable, Equatable {
    var id: String
    var email: String
    var name: String?
    var timezone: String
    var units: String
    var cloudSync: Bool
    var hasPassword: Bool
    var signInMethods: [String]
    var connections: [Connection]

    struct Connection: Codable, Equatable, Identifiable {
        var provider: String
        var status: String
        var lastSyncAt: Date?
        var id: String { provider }
    }

    var imperial: Bool { units == "imperial" }
}

struct DailyMetric: Codable, Identifiable {
    var day: String
    var metric: String
    var value: Double
    var unit: String
    var source: String
    var conflict: Bool
    var id: String { "\(day)-\(metric)" }
}

struct Activity: Codable, Identifiable {
    var id: String
    var name: String?
    var sport: String
    var provider: String
    var origin: String?
    var startTime: Date
    var endTime: Date
    var distanceM: Double?
    var avgHr: Double?
    var avgPower: Double?
    var calories: Double?
    var sources: Int?
}

struct APIError: LocalizedError {
    var code: String
    var status: Int
    var errorDescription: String? {
        switch code {
        case "invalid_credentials": String(localized: "Incorrect email or password")
        case "email_taken": String(localized: "This email is already registered")
        case "invalid_email": String(localized: "Please enter a valid email")
        case "signup_closed": String(localized: "Sign-ups are closed")
        case "cloud_sync_disabled": String(localized: "Cloud sync is off")
        case "network": String(localized: "Can't reach MoveVitals. Check your connection.")
        case "google_unavailable": String(localized: "Google sign-in isn't available yet")
        case "no_email": String(localized: "Your Google account has no verified email")
        case "expired", "google_failed": String(localized: "Google sign-in failed, please try again")
        case "apple_failed": String(localized: "Sign in with Apple failed, please try again")
        default: String(localized: "Something went wrong (\(code))")
        }
    }
}

final class APIClient {
    static let shared = APIClient()

    /// Production by default; a DEBUG build can point at a local server with
    /// the launch argument `-MVBaseURL http://localhost:3000`.
    var baseURL: URL {
        #if DEBUG
        if let custom = UserDefaults.standard.string(forKey: "MVBaseURL"), let url = URL(string: custom) { return url }
        #endif
        return URL(string: "https://movevitals.com")!
    }

    var token: String? {
        get { Keychain.get("token") }
        set { Keychain.set(newValue, for: "token") }
    }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = f.date(from: s) { return date }
            f.formatOptions = [.withInternetDateTime]
            if let date = f.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    func request<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil, as: T.Type = T.self) async throws -> T {
        // `appending(path:)` would percent-encode "?", so split off the query.
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let parts = path.split(separator: "?", maxSplits: 1)
        comps.path = String(parts[0])
        if parts.count > 1 { comps.percentEncodedQuery = String(parts[1]) }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.timeoutInterval = 60
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError(code: "network", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let code = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "http_\(status)"
            throw APIError(code: code, status: status)
        }
        if T.self == Empty.self { return Empty() as! T }
        return try decoder.decode(T.self, from: data)
    }

    struct Empty: Decodable {}
    struct AuthResponse: Decodable { var token: String; var user: User }
    struct UserResponse: Decodable { var user: User }
    struct SummaryResponse: Decodable { var days: Int; var metrics: [DailyMetric] }
    struct ActivitiesResponse: Decodable { var activities: [Activity] }

    func login(email: String, password: String) async throws -> AuthResponse {
        try await request("POST", "/api/mobile/login", body: ["email": email, "password": password, "device": DeviceInfo.name])
    }

    func signup(email: String, password: String, name: String) async throws -> AuthResponse {
        struct Body: Encodable { var email, password, name, device: String; var agree = true }
        return try await request("POST", "/api/mobile/signup", body: Body(email: email, password: password, name: name, device: DeviceInfo.name))
    }

    func apple(identityToken: String, name: String?) async throws -> AuthResponse {
        struct Body: Encodable { var identityToken: String; var name: String?; var device: String }
        return try await request("POST", "/api/mobile/apple", body: Body(identityToken: identityToken, name: name, device: DeviceInfo.name))
    }

    func me() async throws -> User { try await request("GET", "/api/mobile/me", as: UserResponse.self).user }

    func update(cloudSync: Bool? = nil, units: String? = nil) async throws -> User {
        struct Body: Encodable { var cloudSync: Bool?; var units: String? }
        return try await request("PATCH", "/api/mobile/me", body: Body(cloudSync: cloudSync, units: units), as: UserResponse.self).user
    }

    func summary(days: Int = 14) async throws -> [DailyMetric] {
        try await request("GET", "/api/mobile/summary?days=\(days)", as: SummaryResponse.self).metrics
    }

    func activities(limit: Int = 50) async throws -> [Activity] {
        try await request("GET", "/api/mobile/activities?limit=\(limit)", as: ActivitiesResponse.self).activities
    }

    func logout() async {
        _ = try? await request("POST", "/api/mobile/logout", as: Empty.self)
    }

    func ingest(_ payload: IngestPayload) async throws {
        _ = try await request("POST", "/api/ingest", body: payload, as: Empty.self)
    }
}

// Request body for POST /api/ingest.
struct IngestPayload: Encodable {
    var provider: String
    var observations: [Observation] = []
    var activities: [Workout] = []
    var attributes: [Attribute] = []

    struct Device: Encodable { var brand: String?; var model: String; var kind: String? }

    struct Observation: Encodable {
        var metric: String
        var value: Double
        var granularity: String = "daily"
        var day: String?
        var startTime: Date?
        var endTime: Date?
        var externalId: String
        var origin: String?
        var device: Device?
    }

    struct Workout: Encodable {
        var externalId: String
        var name: String?
        var sport: String?
        var sportRaw: String?
        var startTime: Date
        var endTime: Date
        var distanceM: Double?
        var elevationGainM: Double?
        var avgHr: Double?
        var maxHr: Double?
        var calories: Double?
        var origin: String?
        var device: Device?
    }

    struct Attribute: Encodable { var key: String; var value: String }
}

enum DeviceInfo {
    static var name: String {
        #if targetEnvironment(simulator)
        "iPhone Simulator"
        #else
        "iPhone"
        #endif
    }
}
