import Foundation
import Network

// A tiny read-only HTTP server on 127.0.0.1 for the copy of web/ inside the app bundle. Used only as the offline
// fallback (first start without a connection, before the page's service worker cached the site). GET / HEAD, Range.
final class LocalServer {
    static let shared = LocalServer()
    static let fixedPort: UInt16 = 47615          // fixed, so the page's storage (origin) stays the same between starts

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "telenova.localserver")
    private(set) var port: UInt16 = 0
    let root: URL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("web", isDirectory: true)

    var hasFiles: Bool { FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) }

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
    }

    func start(_ done: @escaping (UInt16?) -> Void) {
        queue.async { self.open(fixed: true, done) }
    }

    private func open(fixed: Bool, _ done: @escaping (UInt16?) -> Void) {
        listener?.cancel()
        listener = nil
        let p = NWParameters.tcp
        p.allowLocalEndpointReuse = true
        let wanted: NWEndpoint.Port = fixed ? (NWEndpoint.Port(rawValue: LocalServer.fixedPort) ?? .any) : .any
        p.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host.ipv4(IPv4Address.loopback), port: wanted)
        guard let l = try? NWListener(using: p) else {
            if fixed { open(fixed: false, done) } else { DispatchQueue.main.async { done(nil) } }
            return
        }
        var answered = false
        l.stateUpdateHandler = { [weak self, weak l] st in
            guard let self = self else { return }
            switch st {
            case .ready:
                if answered { return }
                answered = true
                self.port = l?.port?.rawValue ?? 0
                let got = self.port
                DispatchQueue.main.async { done(got == 0 ? nil : got) }
            case .failed, .cancelled:
                if answered { return }
                answered = true
                l?.cancel()
                if fixed { self.open(fixed: false, done) } else { DispatchQueue.main.async { done(nil) } }
            default:
                break
            }
        }
        l.newConnectionHandler = { [weak self] c in
            guard let self = self else { c.cancel(); return }
            c.start(queue: self.queue)
            self.read(c, Data())
        }
        listener = l
        l.start(queue: queue)
    }

    private func read(_ c: NWConnection, _ soFar: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { c.cancel(); return }
            var buf = soFar
            if let d = data { buf.append(d) }
            if let end = buf.range(of: Data([13, 10, 13, 10])) {
                self.answer(c, String(decoding: buf.subdata(in: 0..<end.lowerBound), as: UTF8.self))
            } else if error != nil || isComplete || buf.count > 65536 {
                c.cancel()
            } else {
                self.read(c, buf)
            }
        }
    }

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml", "ico": "image/x-icon",
        "wasm": "application/wasm", "mp3": "audio/mpeg", "mp4": "video/mp4", "webm": "video/webm",
        "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8", "xml": "text/xml; charset=utf-8",
        "woff2": "font/woff2", "woff": "font/woff", "vtt": "text/vtt; charset=utf-8", "srt": "text/plain; charset=utf-8"]

    private func send(_ c: NWConnection, _ status: String, _ headers: [String: String], _ body: Data?) {
        var head = "HTTP/1.1 \(status)\r\n"
        var h = headers
        h["Connection"] = "close"
        h["Cache-Control"] = "no-cache"
        h["X-Content-Type-Options"] = "nosniff"
        if h["Content-Length"] == nil { h["Content-Length"] = String(body?.count ?? 0) }
        for (k, v) in h { head += "\(k): \(v)\r\n" }
        head += "\r\n"
        var out = Data(head.utf8)
        if let b = body { out.append(b) }
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }

    private func answer(_ c: NWConnection, _ head: String) {
        let lines = head.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").components(separatedBy: " ")
        guard first.count >= 2, first[0] == "GET" || first[0] == "HEAD" else {
            send(c, "405 Method Not Allowed", [:], nil)
            return
        }
        let isHead = first[0] == "HEAD"
        var path = first[1]
        if let q = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let parts = path.split(separator: "/").map(String.init)
        if parts.contains("..") || parts.contains(where: { $0.hasPrefix(".") }) {
            send(c, "403 Forbidden", [:], nil)
            return
        }
        let file = root.appendingPathComponent(parts.joined(separator: "/")).standardizedFileURL
        var isDir: ObjCBool = false
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue,
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            send(c, "404 Not Found", ["Content-Type": "text/plain; charset=utf-8"], isHead ? nil : Data("not found".utf8))
            return
        }
        let type = LocalServer.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        var range: String?
        for l in lines.dropFirst() where l.lowercased().hasPrefix("range:") {
            range = l.dropFirst(6).trimmingCharacters(in: .whitespaces)
        }
        if let r = range, r.hasPrefix("bytes="), data.count > 0 {
            let ab = r.dropFirst(6).components(separatedBy: "-")
            if ab.count == 2 {
                var start = 0, end = data.count - 1
                if ab[0].isEmpty, let n = Int(ab[1]) { start = max(0, data.count - n) }
                else if let a = Int(ab[0]) { start = a; if let b = Int(ab[1]) { end = min(b, data.count - 1) } }
                else { start = -1 }
                if start < 0 || start >= data.count || end < start {
                    send(c, "416 Range Not Satisfiable", ["Content-Range": "bytes */\(data.count)"], nil)
                    return
                }
                let slice = data.subdata(in: start..<(end + 1))
                send(c, "206 Partial Content", ["Content-Type": type, "Accept-Ranges": "bytes",
                                                "Content-Range": "bytes \(start)-\(end)/\(data.count)",
                                                "Content-Length": String(slice.count)], isHead ? nil : slice)
                return
            }
        }
        send(c, "200 OK", ["Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(data.count)],
             isHead ? nil : data)
    }
}
