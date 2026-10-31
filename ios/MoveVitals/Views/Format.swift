import SwiftUI

// Display names and formatting for metric codes (mirrors src/lib/metrics.ts).
enum MetricFormat {
    static func title(_ code: String) -> LocalizedStringKey {
        switch code {
        case "recovery_score": "Recovery"
        case "readiness_score": "Readiness"
        case "strain": "Strain"
        case "hrv_rmssd": "HRV (RMSSD)"
        case "hrv_sdnn": "HRV (SDNN)"
        case "resting_hr": "Resting heart rate"
        case "sleep_duration": "Sleep"
        case "sleep_score": "Sleep score"
        case "steps": "Steps"
        case "active_energy": "Active energy"
        case "total_energy": "Total energy"
        case "weight": "Weight"
        case "body_fat": "Body fat"
        case "vo2max": "VO2 max"
        case "spo2": "Blood oxygen"
        case "respiratory_rate": "Respiratory rate"
        case "body_battery": "Body Battery"
        case "blood_glucose": "Glucose"
        default: LocalizedStringKey(code)
        }
    }

    static func value(_ code: String, _ v: Double, imperial: Bool) -> String {
        switch code {
        case "sleep_duration", "sleep_deep", "sleep_rem", "sleep_light", "sleep_awake":
            let m = Int(v / 60)
            return "\(m / 60)h \(m % 60)m"
        case "steps": return v.formatted(.number.precision(.fractionLength(0)))
        case "active_energy", "total_energy": return "\(Int(v.rounded())) kcal"
        case "resting_hr", "heart_rate": return "\(Int(v.rounded())) bpm"
        case "hrv_rmssd", "hrv_sdnn": return "\(Int(v.rounded())) ms"
        case "recovery_score", "body_fat", "spo2", "sleep_efficiency": return "\(Int(v.rounded()))%"
        case "weight": return imperial ? String(format: "%.1f lb", v * 2.20462) : String(format: "%.1f kg", v)
        case "vo2max": return String(format: "%.1f", v)
        case "respiratory_rate": return String(format: "%.1f /min", v)
        case "strain": return String(format: "%.1f", v)
        default: return v.formatted(.number.precision(.fractionLength(0...1)))
        }
    }

    static func source(_ provider: String) -> String {
        switch provider {
        case "apple_health": "Apple Health"
        case "polar_ble": "Polar H10"
        case "whoop": "WHOOP"
        case "oura": "Oura"
        case "garmin": "Garmin"
        case "polar": "Polar"
        case "withings": "Withings"
        case "strava": "Strava"
        case "suunto": "Suunto"
        case "wahoo": "Wahoo"
        case "concept2": "Concept2"
        case "dexcom": "Dexcom"
        default: provider.capitalized
        }
    }

    static func sportIcon(_ sport: String) -> String {
        switch sport {
        case "run", "virtual_run": "figure.run"
        case "ride", "virtual_ride": "figure.outdoor.cycle"
        case "walk": "figure.walk"
        case "hike": "figure.hiking"
        case "swim": "figure.pool.swim"
        case "row": "figure.rower"
        case "strength": "dumbbell"
        case "hiit": "flame"
        case "yoga", "stretching": "figure.yoga"
        case "ski", "snowboard": "figure.skiing.downhill"
        case "climbing": "figure.climbing"
        case "racket": "figure.tennis"
        case "soccer": "figure.soccer"
        case "basketball": "figure.basketball"
        default: "figure.mixed.cardio"
        }
    }
}
