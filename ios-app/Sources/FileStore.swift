import Foundation

// The app's Documents folder. It is visible in the Files app ("On My iPhone > TeleNova") because Info.plist sets
// UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace, and in Finder / iTunes file sharing.
enum FileStore {
    static let folders = ["Backups", "Subtitles", "Playlists", "Downloads", "Imports"]

    static var docs: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static func prepare() {
        for f in folders {
            try? FileManager.default.createDirectory(at: docs.appendingPathComponent(f), withIntermediateDirectories: true)
        }
    }

    // which folder a file exported by the page goes to
    static func folder(for name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "zip", "tncfg", "json", "nvp": return "Backups"
        case "srt", "vtt", "ass", "ssa", "sub": return "Subtitles"
        case "m3u", "m3u8", "xml", "xmltv", "gz": return "Playlists"
        default: return "Downloads"
        }
    }

    static func sanitize(_ name: String) -> String {
        var s = name.components(separatedBy: CharacterSet(charactersIn: "/\\:?%*|\"<>\0")).joined(separator: "_")
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasPrefix(".") { s.removeFirst() }
        if s.isEmpty { s = "file" }
        if s.count > 120 {
            let ext = (s as NSString).pathExtension
            s = String(s.prefix(100)) + (ext.isEmpty || ext.count > 10 ? "" : "." + ext)
        }
        return s
    }

    // name.ext, name (2).ext, ... - an existing file is never overwritten
    static func unique(in dir: URL, name: String) -> URL {
        let clean = sanitize(name)
        var url = dir.appendingPathComponent(clean)
        let base = (clean as NSString).deletingPathExtension, ext = (clean as NSString).pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
            n += 1
        }
        return url
    }

    static func destination(for name: String) -> URL {
        let dir = docs.appendingPathComponent(folder(for: name))
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return unique(in: dir, name: name)
    }

    // copies files picked by the viewer (or sent from another app) into Documents/Imports
    static func importFiles(_ urls: [URL]) -> [URL] {
        let dir = docs.appendingPathComponent("Imports")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var out: [URL] = []
        for u in urls {
            if u.standardizedFileURL.path.hasPrefix(docs.standardizedFileURL.path + "/Imports/") { out.append(u); continue }
            let scoped = u.startAccessingSecurityScopedResource()
            defer { if scoped { u.stopAccessingSecurityScopedResource() } }
            let dst = unique(in: dir, name: u.lastPathComponent)
            if (try? FileManager.default.copyItem(at: u, to: dst)) != nil { out.append(dst) }
        }
        return out
    }

    // "Backups/x.zip" style path for messages
    static func shortPath(_ url: URL) -> String {
        let p = url.standardizedFileURL.path, d = docs.standardizedFileURL.path
        return p.hasPrefix(d + "/") ? String(p.dropFirst(d.count + 1)) : url.lastPathComponent
    }

    static func listing() -> [String] {
        guard let e = FileManager.default.enumerator(at: docs, includingPropertiesForKeys: nil) else { return [] }
        var out: [String] = []
        for case let u as URL in e { out.append(shortPath(u)) }
        return out.sorted()
    }
}
