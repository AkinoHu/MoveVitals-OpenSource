# MoveVitals iOS app

SwiftUI app (iOS 17+) that signs in to movevitals.com, reads Apple Health,
connects to Bluetooth heart-rate straps (Polar H10) and shows the resolved
data from every source.

## Build

Open `MoveVitals.xcodeproj` in Xcode, or:

```
xcodebuild -project MoveVitals.xcodeproj -scheme MoveVitals -destination 'generic/platform=iOS Simulator' build
```

Debug launch arguments (simulator testing):

| Argument | Effect |
| --- | --- |
| `-MVBaseURL http://localhost:3000` | Use a local server instead of movevitals.com |
| `-MVDebugToken mv_…` | Sign in with an existing API token |
| `-MVTab 0…3` | Open a given tab |

## Before running on a device / App Store

1. Set your Apple Developer **Team** in Signing & Capabilities (bundle id `com.movevitals.app`).
2. Enable the **HealthKit** capability for the App ID (entitlements already in `MoveVitals.entitlements`).
3. Google sign-in: the server needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; redirect URI
   `https://movevitals.com/api/auth/google/callback`. The app opens it in
   `ASWebAuthenticationSession` and receives the token via `movevitals://auth`.
4. App Store guideline 4.8: apps offering Google sign-in must also offer
   **Sign in with Apple** — to be added once the Apple Developer account is set up.

## Structure

- `App/` entry point, tabs, theme
- `Core/` API client (`/api/mobile/*`, `/api/ingest`), session, Keychain
- `Health/` HealthKit sync (`HealthSync`) and Bluetooth heart-rate sensor (`HeartRateSensor`)
- `Views/` screens
- `Localizable.xcstrings`, `InfoPlist.xcstrings` English + Simplified Chinese
