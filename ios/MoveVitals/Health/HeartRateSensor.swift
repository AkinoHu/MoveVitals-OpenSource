import CoreBluetooth
import Foundation
import Observation

// Standard Bluetooth Heart Rate Service (0x180D) client — works with the
// Polar H10 and any compliant chest strap. Parses heart rate and R-R
// intervals, and can take a short resting HRV (RMSSD) reading.
@MainActor
@Observable
final class HeartRateSensor: NSObject {
    enum State: Equatable { case off, unauthorized, idle, scanning, connecting, connected }

    struct Found: Identifiable, Equatable { let id: UUID; let name: String; let rssi: Int }

    private(set) var state: State = .idle
    private(set) var found: [Found] = []
    private(set) var deviceName: String?
    private(set) var heartRate: Int?
    private(set) var rrIntervals: [Double] = [] // ms, rolling window
    private(set) var reading: Reading?

    struct Reading: Equatable {
        var startedAt: Date
        var duration: TimeInterval
        var intervals: [Double] = []
        var rmssd: Double?
        var avgHr: Double?
        var finished = false
        var uploaded = false
    }

    nonisolated private static let hrService = CBUUID(string: "180D")
    nonisolated private static let hrMeasurement = CBUUID(string: "2A37")

    private var central: CBCentralManager?
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var connected: CBPeripheral?

    func startScan() {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
        found = []
        if central?.state == .poweredOn {
            state = .scanning
            central?.scanForPeripherals(withServices: [Self.hrService])
        }
    }

    func stopScan() {
        central?.stopScan()
        if state == .scanning { state = .idle }
    }

    func connect(_ id: UUID) {
        guard let p = peripherals[id] else { return }
        central?.stopScan()
        state = .connecting
        deviceName = p.name
        central?.connect(p)
    }

    func disconnect() {
        if let connected { central?.cancelPeripheralConnection(connected) }
    }

    /// Starts a resting HRV reading (default 2 minutes, sitting still).
    func startReading(seconds: TimeInterval = 120) {
        reading = Reading(startedAt: .now, duration: seconds)
    }

    func cancelReading() { reading = nil }

    /// Uploads a finished reading as provider "polar_ble" (respecting cloud sync).
    func uploadReading(cloudSync: Bool) async -> Bool {
        guard var r = reading, r.finished, let rmssd = r.rmssd else { return false }
        guard cloudSync else { return false }
        let device = IngestPayload.Device(brand: deviceName?.lowercased().contains("polar") == true ? "Polar" : nil, model: deviceName ?? "Heart rate sensor", kind: "chest_strap")
        let id = "ble:hrv:\(Int(r.startedAt.timeIntervalSince1970))"
        var obs = [IngestPayload.Observation(metric: "hrv_rmssd", value: rmssd, granularity: "session", day: HealthSync.dayString(r.startedAt), startTime: r.startedAt, endTime: r.startedAt.addingTimeInterval(r.duration), externalId: id, device: device)]
        if let hr = r.avgHr {
            obs.append(.init(metric: "heart_rate", value: hr, granularity: "session", day: HealthSync.dayString(r.startedAt), startTime: r.startedAt, endTime: r.startedAt.addingTimeInterval(r.duration), externalId: "\(id):hr", device: device))
        }
        do {
            try await APIClient.shared.ingest(IngestPayload(provider: "polar_ble", observations: obs))
            r.uploaded = true
            reading = r
            return true
        } catch {
            return false
        }
    }

    static func rmssd(_ rr: [Double]) -> Double? {
        // Drop ectopic beats / artefacts: >20 % change from the previous interval.
        var clean: [Double] = []
        for v in rr where v > 300 && v < 2000 {
            if let last = clean.last, abs(v - last) / last > 0.2 { continue }
            clean.append(v)
        }
        guard clean.count > 10 else { return nil }
        let diffs = zip(clean.dropFirst(), clean).map { pow($0 - $1, 2) }
        return (diffs.reduce(0, +) / Double(diffs.count)).squareRoot()
    }

    fileprivate func handle(_ data: Data) {
        let bytes = [UInt8](data)
        guard let flags = bytes.first else { return }
        var i = 1
        let hr: Int
        if flags & 0x01 == 0 { hr = Int(bytes[i]); i += 1 } else { hr = Int(UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8); i += 2 }
        if flags & 0x08 != 0 { i += 2 } // energy expended
        var rr: [Double] = []
        if flags & 0x10 != 0 {
            while i + 1 < bytes.count {
                let raw = UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8
                rr.append(Double(raw) / 1024 * 1000)
                i += 2
            }
        }
        heartRate = hr
        rrIntervals = Array((rrIntervals + rr).suffix(120))
        if var r = reading, !r.finished {
            r.intervals += rr
            if Date.now.timeIntervalSince(r.startedAt) >= r.duration {
                r.finished = true
                r.rmssd = Self.rmssd(r.intervals)
                r.avgHr = r.intervals.isEmpty ? nil : 60000 / (r.intervals.reduce(0, +) / Double(r.intervals.count))
            }
            reading = r
        }
    }
}

extension HeartRateSensor: CBCentralManagerDelegate, CBPeripheralDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        MainActor.assumeIsolated {
            switch central.state {
            case .poweredOn:
                if state == .off || state == .unauthorized || state == .idle {
                    state = .scanning
                    central.scanForPeripherals(withServices: [Self.hrService])
                }
            case .unauthorized: state = .unauthorized
            default: state = .off
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        MainActor.assumeIsolated {
            peripherals[peripheral.identifier] = peripheral
            let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? "Heart rate sensor"
            if !found.contains(where: { $0.id == peripheral.identifier }) {
                found.append(.init(id: peripheral.identifier, name: name, rssi: RSSI.intValue))
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        MainActor.assumeIsolated {
            connected = peripheral
            state = .connected
            peripheral.delegate = self
            peripheral.discoverServices([Self.hrService])
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated {
            connected = nil
            heartRate = nil
            state = .idle
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated { state = .idle }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for s in peripheral.services ?? [] where s.uuid == Self.hrService {
            peripheral.discoverCharacteristics([Self.hrMeasurement], for: s)
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for c in service.characteristics ?? [] where c.uuid == Self.hrMeasurement {
            peripheral.setNotifyValue(true, for: c)
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        MainActor.assumeIsolated { handle(data) }
    }
}
