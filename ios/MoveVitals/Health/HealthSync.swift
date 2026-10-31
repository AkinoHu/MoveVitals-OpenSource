import Foundation
import HealthKit
import Observation

// Reads Apple Health (HealthKit) and uploads it to MoveVitals as provider
// "apple_health". Uploads are idempotent on the server (externalId), so each
// sync simply re-sends a trailing window. With cloud sync off nothing is
// uploaded; `snapshot` still reads today's values for on-device display.
@MainActor
@Observable
final class HealthSync {
    enum Status: Equatable { case idle, syncing, done(Date), failed(String) }

    private(set) var status: Status = .idle
    private(set) var authorized = UserDefaults.standard.bool(forKey: "MVHealthAuthorized")
    private(set) var snapshot: [String: Double] = [:]
    private(set) var lastUpload: Date? = UserDefaults.standard.object(forKey: "MVHealthLastSync") as? Date
    private(set) var lastCounts = (observations: 0, workouts: 0)

    let available = HKHealthStore.isHealthDataAvailable()
    private let store = HKHealthStore()

    private static let quantityTypes: [HKQuantityTypeIdentifier] = [
        .stepCount, .activeEnergyBurned, .basalEnergyBurned, .restingHeartRate, .heartRateVariabilitySDNN, .heartRate,
        .vo2Max, .bodyMass, .bodyFatPercentage, .leanBodyMass, .oxygenSaturation, .respiratoryRate, .appleSleepingWristTemperature,
        .distanceWalkingRunning, .distanceCycling,
    ]

    private var readTypes: Set<HKObjectType> {
        var s = Set<HKObjectType>(Self.quantityTypes.compactMap { HKQuantityType.quantityType(forIdentifier: $0) })
        s.insert(HKCategoryType(.sleepAnalysis))
        s.insert(HKWorkoutType.workoutType())
        s.insert(HKCharacteristicType(.dateOfBirth))
        s.insert(HKCharacteristicType(.biologicalSex))
        if let h = HKQuantityType.quantityType(forIdentifier: .height) { s.insert(h) }
        return s
    }

    func requestAuthorization() async {
        guard available else { return }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            authorized = true
            UserDefaults.standard.set(true, forKey: "MVHealthAuthorized")
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    // MARK: - Sync

    /// Uploads the last `days` days (90 on first sync, then 7 to catch late edits).
    func sync(cloudSync: Bool) async {
        guard available, authorized else { return }
        await refreshSnapshot()
        guard cloudSync else { status = .idle; return }
        status = .syncing
        let days = lastUpload == nil ? 90 : 7
        do {
            let start = Calendar.current.date(byAdding: .day, value: -days, to: Calendar.current.startOfDay(for: .now))!
            var payload = IngestPayload(provider: "apple_health")
            payload.observations = try await dailyObservations(since: start)
            payload.observations += try await sleepObservations(since: start)
            payload.attributes = characteristics()
            let workouts = try await workouts(since: start)
            // Keep request bodies modest.
            for chunk in payload.observations.chunked(2000) {
                try await APIClient.shared.ingest(IngestPayload(provider: "apple_health", observations: chunk, attributes: payload.attributes))
            }
            for chunk in workouts.chunked(100) {
                try await APIClient.shared.ingest(IngestPayload(provider: "apple_health", activities: chunk))
            }
            lastCounts = (payload.observations.count, workouts.count)
            lastUpload = .now
            UserDefaults.standard.set(lastUpload, forKey: "MVHealthLastSync")
            status = .done(.now)
        } catch let e as APIError where e.code == "cloud_sync_disabled" {
            status = .idle
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    // MARK: - Daily quantities

    private struct DailySpec {
        let id: HKQuantityTypeIdentifier
        let metric: String
        let unit: HKUnit
        let options: HKStatisticsOptions
        var scale: Double = 1
    }

    private static let dailySpecs: [DailySpec] = [
        .init(id: .stepCount, metric: "steps", unit: .count(), options: .cumulativeSum),
        .init(id: .activeEnergyBurned, metric: "active_energy", unit: .kilocalorie(), options: .cumulativeSum),
        .init(id: .restingHeartRate, metric: "resting_hr", unit: .count().unitDivided(by: .minute()), options: .discreteAverage),
        .init(id: .heartRateVariabilitySDNN, metric: "hrv_sdnn", unit: .secondUnit(with: .milli), options: .discreteAverage),
        .init(id: .vo2Max, metric: "vo2max", unit: HKUnit(from: "ml/kg*min"), options: .mostRecent),
        .init(id: .bodyMass, metric: "weight", unit: .gramUnit(with: .kilo), options: .mostRecent),
        .init(id: .bodyFatPercentage, metric: "body_fat", unit: .percent(), options: .mostRecent, scale: 100),
        .init(id: .oxygenSaturation, metric: "spo2", unit: .percent(), options: .discreteAverage, scale: 100),
        .init(id: .respiratoryRate, metric: "respiratory_rate", unit: .count().unitDivided(by: .minute()), options: .discreteAverage),
    ]

    private func dailyObservations(since start: Date) async throws -> [IngestPayload.Observation] {
        var out: [IngestPayload.Observation] = []
        for spec in Self.dailySpecs {
            guard let type = HKQuantityType.quantityType(forIdentifier: spec.id) else { continue }
            let stats = try await dailyStatistics(type: type, options: spec.options, since: start)
            for s in stats {
                let q: HKQuantity? = switch spec.options {
                case .cumulativeSum: s.sumQuantity()
                case .mostRecent: s.mostRecentQuantity()
                default: s.averageQuantity()
                }
                guard let q else { continue }
                let day = Self.dayString(s.startDate)
                out.append(.init(metric: spec.metric, value: q.doubleValue(for: spec.unit) * spec.scale, day: day, externalId: "hk:\(spec.metric):\(day)", origin: "Apple Health"))
            }
        }
        // Total energy = active + basal, when both exist.
        if let basalType = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) {
            let basal = try await dailyStatistics(type: basalType, options: .cumulativeSum, since: start)
            let active = Dictionary(out.filter { $0.metric == "active_energy" }.map { ($0.day ?? "", $0.value) }, uniquingKeysWith: { a, _ in a })
            for s in basal {
                guard let b = s.sumQuantity()?.doubleValue(for: .kilocalorie()) else { continue }
                let day = Self.dayString(s.startDate)
                out.append(.init(metric: "total_energy", value: b + (active[day] ?? 0), day: day, externalId: "hk:total_energy:\(day)", origin: "Apple Health"))
            }
        }
        return out
    }

    private func dailyStatistics(type: HKQuantityType, options: HKStatisticsOptions, since start: Date) async throws -> [HKStatistics] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: .now)
        let query = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate),
            options: options,
            anchorDate: Calendar.current.startOfDay(for: start),
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await query.result(for: store)
        var out: [HKStatistics] = []
        collection.enumerateStatistics(from: start, to: .now) { s, _ in out.append(s) }
        return out
    }

    // MARK: - Sleep

    // Sleep is attributed to the day you wake up.
    private func sleepObservations(since start: Date) async throws -> [IngestPayload.Observation] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-86400), end: .now))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let samples = try await descriptor.result(for: store)
        var byDay: [String: [String: Double]] = [:]
        for s in samples {
            guard let value = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
            let key: String? = switch value {
            case .asleepDeep: "sleep_deep"
            case .asleepREM: "sleep_rem"
            case .asleepCore, .asleepUnspecified: "sleep_light"
            case .awake: "sleep_awake"
            default: nil
            }
            guard let key else { continue }
            let day = Self.dayString(s.endDate)
            let secs = s.endDate.timeIntervalSince(s.startDate)
            byDay[day, default: [:]][key, default: 0] += secs
            if key != "sleep_awake" { byDay[day, default: [:]]["sleep_duration", default: 0] += secs }
        }
        return byDay.flatMap { day, metrics in
            metrics.map { .init(metric: $0.key, value: $0.value, day: day, externalId: "hk:\($0.key):\(day)", origin: "Apple Health") }
        }
    }

    // MARK: - Workouts

    private func workouts(since start: Date) async throws -> [IngestPayload.Workout] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: .now))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
        )
        let list = try await descriptor.result(for: store)
        var out: [IngestPayload.Workout] = []
        for w in list {
            let hrType = HKQuantityType(.heartRate)
            let hr = w.statistics(for: hrType)
            let bpm = HKUnit.count().unitDivided(by: .minute())
            let energy = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
                .compactMap { w.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }.first
            let source = w.sourceRevision.source
            let deviceName = w.device?.model ?? w.device?.name
            out.append(.init(
                externalId: "hk:workout:\(w.uuid.uuidString)",
                name: nil,
                sport: Self.sport(w.workoutActivityType),
                sportRaw: "HKWorkoutActivityType(\(w.workoutActivityType.rawValue))",
                startTime: w.startDate,
                endTime: w.endDate,
                distanceM: distance,
                avgHr: hr?.averageQuantity()?.doubleValue(for: bpm),
                maxHr: hr?.maximumQuantity()?.doubleValue(for: bpm),
                calories: energy,
                // The app that recorded it (Apple Watch Workout, Strava, …) — lets
                // the server match it against the same session from other sources.
                origin: source.name,
                device: deviceName.map { .init(brand: w.device?.manufacturer, model: $0, kind: "watch") }
            ))
        }
        return out
    }

    private static func sport(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: "run"
        case .cycling: "ride"
        case .walking: "walk"
        case .hiking: "hike"
        case .swimming: "swim"
        case .rowing: "row"
        case .traditionalStrengthTraining, .functionalStrengthTraining: "strength"
        case .highIntensityIntervalTraining, .crossTraining: "hiit"
        case .yoga, .pilates: "yoga"
        case .flexibility, .cooldown: "stretching"
        case .downhillSkiing, .crossCountrySkiing: "ski"
        case .snowboarding: "snowboard"
        case .skatingSports: "skating"
        case .climbing: "climbing"
        case .tennis, .badminton, .tableTennis, .squash, .racquetball, .pickleball: "racket"
        case .soccer: "soccer"
        case .basketball: "basketball"
        case .volleyball: "volleyball"
        case .golf: "golf"
        case .martialArts, .boxing, .kickboxing: "martial_arts"
        default: "other"
        }
    }

    // MARK: - Characteristics & snapshot

    private func characteristics() -> [IngestPayload.Attribute] {
        var out: [IngestPayload.Attribute] = []
        if let dob = try? store.dateOfBirthComponents(), let date = Calendar(identifier: .gregorian).date(from: dob) {
            out.append(.init(key: "birth_date", value: Self.dayString(date)))
        }
        if let sex = try? store.biologicalSex().biologicalSex {
            switch sex {
            case .female: out.append(.init(key: "sex", value: "female"))
            case .male: out.append(.init(key: "sex", value: "male"))
            default: break
            }
        }
        return out
    }

    /// Today's key values read straight from HealthKit (works with cloud sync off).
    func refreshSnapshot() async {
        guard available, authorized else { return }
        let start = Calendar.current.startOfDay(for: .now)
        var snap: [String: Double] = [:]
        for spec in Self.dailySpecs where ["steps", "active_energy", "resting_hr", "hrv_sdnn"].contains(spec.metric) {
            guard let type = HKQuantityType.quantityType(forIdentifier: spec.id),
                  let s = try? await dailyStatistics(type: type, options: spec.options, since: Calendar.current.date(byAdding: .day, value: -1, to: start)!).last
            else { continue }
            let q = spec.options == .cumulativeSum ? s.sumQuantity() : s.averageQuantity()
            if let q { snap[spec.metric] = q.doubleValue(for: spec.unit) }
        }
        if let sleep = try? await sleepObservations(since: start) {
            for o in sleep where o.day == Self.dayString(.now) { snap[o.metric] = o.value }
        }
        snapshot = snap
    }

    static func dayString(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

extension Array {
    func chunked(_ size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
