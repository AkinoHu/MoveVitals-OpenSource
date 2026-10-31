import AuthenticationServices
import Foundation
import Observation

@MainActor
@Observable
final class Session {
    enum State: Equatable { case loading, signedOut, signedIn }

    private(set) var state: State = .loading
    private(set) var user: User?
    var errorMessage: String?
    private let api = APIClient.shared

    func restore() async {
        #if DEBUG
        // Simulator testing: `-MVDebugToken mv_…` signs in with an existing token.
        if let t = UserDefaults.standard.string(forKey: "MVDebugToken") { api.token = t }
        #endif
        guard api.token != nil else { state = .signedOut; return }
        // Show the cached profile immediately; refresh in the background.
        if let data = UserDefaults.standard.data(forKey: "MVUser"), let cached = try? JSONDecoder().decode(User.self, from: data) {
            user = cached
            state = .signedIn
        }
        do {
            setUser(try await api.me())
            state = .signedIn
        } catch let e as APIError where e.status == 401 {
            signOutLocally()
        } catch {
            if user == nil { state = .signedOut }
        }
    }

    func login(email: String, password: String) async {
        await authenticate { try await self.api.login(email: email, password: password) }
    }

    func signup(email: String, password: String, name: String) async {
        await authenticate { try await self.api.signup(email: email, password: password, name: name) }
    }

    private func authenticate(_ call: () async throws -> APIClient.AuthResponse) async {
        errorMessage = nil
        do {
            let res = try await call()
            api.token = res.token
            setUser(res.user)
            state = .signedIn
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Sign in with Apple: the identity token is verified by the server.
    func signInWithApple(_ result: Result<ASAuthorization, Error>) async {
        errorMessage = nil
        switch result {
        case .success(let auth):
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                  let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
                errorMessage = APIError(code: "apple_failed", status: 0).localizedDescription
                return
            }
            let name = cred.fullName.flatMap { PersonNameComponentsFormatter().string(from: $0) }.flatMap { $0.isEmpty ? nil : $0 }
            await authenticate { try await self.api.apple(identityToken: token, name: name) }
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled { errorMessage = error.localizedDescription }
        }
    }

    /// Google sign-in runs on movevitals.com in an in-app browser session and
    /// returns a device token through the movevitals:// callback.
    func signInWithGoogle() async {
        errorMessage = nil
        let start = api.baseURL.appending(path: "/api/auth/google/start").appending(queryItems: [.init(name: "client", value: "app")])
        do {
            let callback = try await WebAuth.start(url: start, scheme: "movevitals")
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if let token = items.first(where: { $0.name == "token" })?.value {
                api.token = token
                setUser(try await api.me())
                state = .signedIn
            } else if let code = items.first(where: { $0.name == "error" })?.value, code != "cancelled" {
                errorMessage = APIError(code: code, status: 0).localizedDescription
            }
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            // User closed the sheet.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        if let u = try? await api.me() { setUser(u) }
    }

    func setCloudSync(_ on: Bool) async {
        guard var u = user else { return }
        u.cloudSync = on
        setUser(u)
        if let updated = try? await api.update(cloudSync: on) { setUser(updated) }
    }

    func setUnits(_ units: String) async {
        if let updated = try? await api.update(units: units) { setUser(updated) }
    }

    func signOut() async {
        await api.logout()
        signOutLocally()
    }

    private func signOutLocally() {
        api.token = nil
        user = nil
        UserDefaults.standard.removeObject(forKey: "MVUser")
        state = .signedOut
    }

    private func setUser(_ u: User) {
        user = u
        if let data = try? JSONEncoder().encode(u) { UserDefaults.standard.set(data, forKey: "MVUser") }
    }
}

// Async wrapper around ASWebAuthenticationSession.
@MainActor
enum WebAuth {
    private static var current: ASWebAuthenticationSession?
    private static let anchor = PresentationAnchor()

    static func start(url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { url, error in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: error ?? URLError(.cancelled)) }
                current = nil
            }
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            current = session
            session.start()
        }
    }

    final class PresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
