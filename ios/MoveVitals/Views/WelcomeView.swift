import AuthenticationServices
import SwiftUI

struct WelcomeView: View {
    @Environment(Session.self) private var session
    @Environment(\.colorScheme) private var colorScheme
    @State private var mode: AuthMode?

    enum AuthMode: String, Identifiable { case login, signup; var id: String { rawValue } }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image("Wordmark")
                .resizable()
                .scaledToFit()
                .frame(height: 30)
            Text("Your health data hub")
                .font(.title2.weight(.semibold))
                .padding(.top, 28)
            Text("WHOOP, Apple Health, Strava, Garmin, Polar and more — every value with its source, in one place.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)
            Spacer()
            VStack(spacing: 12) {
                SignInWithAppleButton(.continue) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    Task { await session.signInWithApple(result) }
                }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                Button {
                    Task { await session.signInWithGoogle() }
                } label: {
                    Label("Continue with Google", systemImage: "g.circle.fill")
                }
                .buttonStyle(SecondaryButtonStyle())

                Button("Create account") { mode = .signup }
                    .buttonStyle(PrimaryButtonStyle())

                Button("I already have an account") { mode = .login }
                    .font(.subheadline.weight(.medium))
                    .padding(.top, 4)

                if let error = session.errorMessage, mode == nil {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
                Text("Free · Open source · Your data is never sold")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .sheet(item: $mode) { m in
            AuthForm(mode: m)
                .presentationDetents([.large])
        }
    }
}

struct AuthForm: View {
    let mode: WelcomeView.AuthMode
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var agree = false
    @State private var busy = false

    private var valid: Bool {
        email.contains("@") && password.count >= 8 && (mode == .login || agree)
    }

    var body: some View {
        NavigationStack {
            Form {
                if mode == .signup {
                    TextField("Name", text: $name).textContentType(.name)
                }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(mode == .signup ? "Password (at least 8 characters)" : "Password", text: $password)
                    .textContentType(mode == .signup ? .newPassword : .password)
                if mode == .signup {
                    Toggle(isOn: $agree) {
                        Text("I agree to the [Privacy Policy](https://movevitals.com/en/privacy) and [Terms](https://movevitals.com/en/terms), and consent to MoveVitals processing the health data I connect.")
                            .font(.footnote)
                    }
                }
                if let error = session.errorMessage {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
                Section {
                    Button {
                        busy = true
                        Task {
                            if mode == .login { await session.login(email: email, password: password) } else { await session.signup(email: email, password: password, name: name) }
                            busy = false
                            if session.state == .signedIn { dismiss() }
                        }
                    } label: {
                        if busy { ProgressView().frame(maxWidth: .infinity) } else { Text(mode == .login ? "Log in" : "Create account").frame(maxWidth: .infinity) }
                    }
                    .disabled(!valid || busy)
                }
            }
            .navigationTitle(mode == .login ? "Log in" : "Create account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { session.errorMessage = nil }
        }
    }
}
