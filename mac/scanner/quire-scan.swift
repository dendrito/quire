// Talks to scanners through Image Capture (ImageCaptureCore), the same framework the Mac's Image Capture app uses.
// The Mac app's main.js runs this helper. As on Windows (windows/scanner/wia.ps1), settings arrive in environment variables:
//   QUIRE_SCAN_ACTION  list | scan
//   QUIRE_SCAN_DEVICE  device id from list (empty = first scanner)
//   QUIRE_SCAN_SOURCE  flatbed | feeder | duplex
//   QUIRE_SCAN_DPI     e.g. 300 (the nearest resolution the scanner offers is used)
//   QUIRE_SCAN_COLOR   color | grey | bw (bw is scanned in grey; Quire makes it black and white)
//   QUIRE_SCAN_PAPER   auto | a4 | letter | legal | a5
//   QUIRE_SCAN_MAX     feeder: stop after this many pages (0 = until empty)
//   QUIRE_SCAN_OUT     folder for the scanned files
// Output: one line of JSON on stdout, the same shape as the Windows helper's:
//   list: { ok, devices: [{ id, name, caps: { feeder, flatbed, duplex } | null }] }
//   scan: { ok, files, warning, simplex, error }
import Foundation
import ImageCaptureCore

let env = ProcessInfo.processInfo.environment
func arg(_ k: String) -> String { env[k] ?? "" }

func finish(_ o: [String: Any]) -> Never {
  if let d = try? JSONSerialization.data(withJSONObject: o) { FileHandle.standardOutput.write(d) }
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)
}

let FEEDER = ICScannerFunctionalUnitType.documentFeeder.rawValue
let FLATBED = ICScannerFunctionalUnitType.flatbed.rawValue
// Paper in millimetres and the feeder's document type for it.
let PAPER: [String: (Double, Double, ICScannerDocumentType)] = [
  "a4": (210, 297, .typeA4), "letter": (215.9, 279.4, .typeUSLetter), "legal": (215.9, 355.6, .typeUSLegal), "a5": (148, 210, .typeA5)
]

final class Helper: NSObject, ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
  let browser = ICDeviceBrowser()
  let action = arg("QUIRE_SCAN_ACTION")
  var scanners: [ICScannerDevice] = []
  var started = false
  // list: one scanner at a time, its session opened to read what it can do
  var toList: [ICScannerDevice] = []
  var listed: [[String: Any]] = []
  var listing: ICScannerDevice?
  var listCaps: [String: Bool]?
  var listGen = 0
  // scan
  var device: ICScannerDevice?
  var files: [String] = []
  var maxPages = Int(arg("QUIRE_SCAN_MAX")) ?? 0
  var simplex = false
  var warning = ""
  var failure = ""
  var closing = false

  func start() {
    browser.delegate = self
    let mask = ICDeviceTypeMask.scanner.rawValue | ICDeviceLocationTypeMask.local.rawValue | ICDeviceLocationTypeMask.shared.rawValue | ICDeviceLocationTypeMask.bonjour.rawValue
    browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue: mask)!
    browser.start()
    // Scanners on the network take a few seconds to answer.
    DispatchQueue.main.asyncAfter(deadline: .now() + (action == "list" ? 4 : 8)) { self.go() }
  }

  func go() {
    if started { return }
    started = true
    if action == "list" { toList = scanners; nextList(); return }
    let want = arg("QUIRE_SCAN_DEVICE")
    guard let s = scanners.first(where: { id($0) == want }) ?? scanners.first else {
      finish(["ok": false, "error": "No scanner found. Check that it is switched on and connected, and that it shows up in the Mac's Image Capture app."])
    }
    device = s
    s.delegate = self
    s.requestOpenSession()
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { if !s.hasOpenSession { finish(["ok": false, "error": "The scanner did not answer. It may be busy in another app."]) } }
  }

  func id(_ d: ICDevice) -> String { d.persistentIDString ?? d.name ?? "scanner" }

  // MARK: device browser
  func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
    guard let s = device as? ICScannerDevice else { return }
    scanners.append(s)
    // The scanner asked for has arrived: no need to wait for the others.
    if action == "scan" && !started && !arg("QUIRE_SCAN_DEVICE").isEmpty && id(s) == arg("QUIRE_SCAN_DEVICE") { go() }
  }
  func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
    scanners.removeAll { $0 === device }
  }

  // MARK: list
  func nextList() {
    guard !toList.isEmpty else { finish(["ok": true, "devices": listed]) }
    let s = toList.removeFirst()
    listing = s; listCaps = nil; listGen += 1
    let gen = listGen
    s.delegate = self
    s.requestOpenSession()
    // A scanner that does not answer in time is listed without what it can do.
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { if self.listGen == gen { self.doneListing(s) } }
  }
  func doneListing(_ s: ICScannerDevice) {
    guard listing === s else { return }
    listing = nil; listGen += 1
    var row: [String: Any] = ["id": id(s), "name": s.name ?? "Scanner"]
    row["caps"] = listCaps ?? NSNull()
    listed.append(row)
    if s.hasOpenSession { s.requestCloseSession() }
    nextList()
  }
  func listOpened(_ s: ICScannerDevice) {
    let types = s.availableFunctionalUnitTypes.map { $0.uintValue }
    var caps: [String: Bool] = ["feeder": types.contains(FEEDER), "flatbed": types.contains(FLATBED), "duplex": false]
    if types.isEmpty { caps = ["feeder": true, "flatbed": true, "duplex": false] }
    listCaps = caps
    // Two-sided scanning is a property of the feeder, so the feeder is selected to read it.
    if let f = s.selectedFunctionalUnit as? ICScannerFunctionalUnitDocumentFeeder { listCaps?["duplex"] = f.supportsDuplexScanning; doneListing(s) }
    else if types.contains(FEEDER), let t = ICScannerFunctionalUnitType(rawValue: FEEDER) { s.requestSelect(t) }
    else { doneListing(s) }
  }

  // MARK: session
  func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
    guard let s = device as? ICScannerDevice else { return }
    if action == "list" {
      if error != nil { doneListing(s) } else { listOpened(s) }
      return
    }
    if let error = error { finish(["ok": false, "error": "Could not open the scanner: \(error.localizedDescription)"]) }
    let src = arg("QUIRE_SCAN_SOURCE")
    let want = (src == "feeder" || src == "duplex") ? FEEDER : FLATBED
    let types = s.availableFunctionalUnitTypes.map { $0.uintValue }
    if !types.isEmpty && !types.contains(want) {
      finish(["ok": false, "error": want == FEEDER ? "This scanner has no document feeder. Choose Flatbed instead." : "This scanner has no flatbed. Choose Feeder instead."])
    }
    if s.selectedFunctionalUnit.type.rawValue == want { configure(s) }
    else if let t = ICScannerFunctionalUnitType(rawValue: want) { s.requestSelect(t) }
  }
  func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
    if action == "scan" && closing { report() }
  }
  func didRemove(_ device: ICDevice) {
    if action == "scan" && device === self.device { failure = "The scanner was disconnected."; report() }
  }

  func scannerDevice(_ scanner: ICScannerDevice, didSelect functionalUnit: ICScannerFunctionalUnit, error: Error?) {
    if action == "list" {
      if let f = functionalUnit as? ICScannerFunctionalUnitDocumentFeeder { listCaps?["duplex"] = f.supportsDuplexScanning }
      doneListing(scanner)
      return
    }
    if let error = error { finish(["ok": false, "error": "The scanner could not switch to that paper source: \(error.localizedDescription)"]) }
    configure(scanner)
  }

  // MARK: scan
  func configure(_ s: ICScannerDevice) {
    let fu = s.selectedFunctionalUnit
    let dpi = Int(arg("QUIRE_SCAN_DPI")) ?? 300
    let res = fu.supportedResolutions
    if let best = res.min(by: { abs($0 - dpi) < abs($1 - dpi) }) { fu.resolution = best } else { fu.resolution = dpi }
    fu.pixelDataType = arg("QUIRE_SCAN_COLOR") == "color" || arg("QUIRE_SCAN_COLOR").isEmpty ? .RGB : .gray
    fu.bitDepth = .depth8Bits
    fu.measurementUnit = .inches
    let paper = PAPER[arg("QUIRE_SCAN_PAPER")]
    if let f = fu as? ICScannerFunctionalUnitDocumentFeeder {
      if arg("QUIRE_SCAN_SOURCE") == "duplex" {
        if f.supportsDuplexScanning { f.duplexScanningEnabled = true }
        else { simplex = true; warning = "This scanner has no two-sided mode, so only the front of each page was scanned." }
      } else if f.supportsDuplexScanning { f.duplexScanningEnabled = false }
      if let p = paper, f.supportedDocumentTypes.contains(Int(p.2.rawValue)) { f.documentType = p.2 }
    } else {
      // The whole glass, or the paper size from its top-left corner.
      let size = fu.physicalSize
      var w = Double(size.width), h = Double(size.height)
      if let p = paper { w = min(w, p.0 / 25.4); h = min(h, p.1 / 25.4) }
      if w > 0 && h > 0 { fu.scanArea = NSRect(x: 0, y: 0, width: w, height: h) }
    }
    s.transferMode = .fileBased
    s.downloadsDirectory = URL(fileURLWithPath: arg("QUIRE_SCAN_OUT"), isDirectory: true)
    s.documentName = "page"
    s.documentUTI = "public.jpeg"
    s.requestScan()
  }
  func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
    files.append(url.path)
    if maxPages > 0 && files.count >= maxPages { scanner.cancelScan() }
  }
  func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: Error?) {
    if let error = error, files.isEmpty {
      let feeder = arg("QUIRE_SCAN_SOURCE") != "flatbed"
      failure = feeder ? "The feeder is empty or the scan stopped: \(error.localizedDescription). Put the pages in and try again." : "The scan did not work: \(error.localizedDescription)"
    }
    // Give the last file a moment to be written, then close the session and answer.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      self.closing = true
      scanner.requestCloseSession()
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.report() }
    }
  }
  var reported = false
  func report() {
    if reported { return }
    reported = true
    let ok = failure.isEmpty
    var o: [String: Any] = ["ok": ok, "files": files.filter { FileManager.default.fileExists(atPath: $0) }, "simplex": simplex]
    if !warning.isEmpty { o["warning"] = warning }
    if !ok { o["error"] = failure }
    finish(o)
  }
  func scannerDeviceDidBecomeAvailable(_ scanner: ICScannerDevice) {}
}

let helper = Helper()
helper.start()
RunLoop.main.run()
