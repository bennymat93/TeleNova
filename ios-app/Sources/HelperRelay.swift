import Foundation

// The TeleNova "helper Worker" built into the app. The web page needs a relay for the few services that give no
// browser CORS (Real-Debrid, StremThru, Ktuvit, the epgshare01 EPG, YouTube innertube). On the web that relay is a
// Cloudflare Worker the viewer deploys (worker/index.js); here the app does the same job itself, so nothing has to
// be deployed or typed. bridge.js sends the page's helper requests here instead of to the network.
//
// The rules are the Worker's own (keep both in step): https only, allow-listed hosts (YouTube only under
// /youtubei/v1/), only the listed request / response headers, a secret header only to the hosts it belongs to, the
// cookie relay only for Ktuvit, redirects reported and never followed blindly. Nothing is stored or logged.

private let relayAllow: [String: [String]] = [          // host -> path prefixes ([] = any path)
    "api.real-debrid.com": [],
    "stremthru.13377001.xyz": [],
    "stremthru.elfhosted.com": [],
    "www.ktuvit.me": [],
    "epgshare01.online": [],
    "www.youtube.com": ["/youtubei/v1/"],
    "youtubei.googleapis.com": ["/youtubei/v1/"]
]
private let relayPassReq = ["authorization", "content-type", "accept", "accept-language", "range", "x-goog-api-key",
                            "x-youtube-client-name", "x-youtube-client-version", "x-stremthru-authorization"]
// content-encoding / content-length are not passed back: URLSession hands over the decoded body
private let relayPassRes = ["content-type", "content-range", "accept-ranges", "cache-control", "etag", "last-modified", "retry-after"]
private let relaySecretHosts: [String: [String]] = [
    "authorization": ["api.real-debrid.com", "stremthru.13377001.xyz", "stremthru.elfhosted.com"],
    "x-stremthru-authorization": ["stremthru.13377001.xyz", "stremthru.elfhosted.com"],
    "x-goog-api-key": ["www.youtube.com", "youtubei.googleapis.com"]
]
private let relayCookieHosts = ["www.ktuvit.me"]
private let relayMaxBody = 5 * 1024 * 1024
private let relayMaxAnswer = 48 * 1024 * 1024

final class HelperRelay: NSObject, URLSessionTaskDelegate {
    static let shared = HelperRelay()

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil                       // cookies travel only in the relayed headers
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 30
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    static func allowed(_ target: String) -> URL? {
        guard let c = URLComponents(string: target), c.scheme?.lowercased() == "https", c.user == nil, c.password == nil,
              c.port == nil || c.port == 443, let host = c.host?.lowercased(), let url = c.url,
              let paths = relayAllow[host] else { return nil }
        if !paths.isEmpty && !paths.contains(where: { url.path.hasPrefix($0) }) { return nil }
        return url
    }

    // a redirect is never followed here: it is reported to the page, which asks again if the new host is allowed
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    // msg: {method, headers (lower-case names), body (base64)} -> reply {status, headers, body (base64)}
    func handle(_ msg: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        func json(_ status: Int, _ obj: [String: Any], _ headers: [String: String] = [:]) {
            var h = headers
            h["content-type"] = "application/json"
            h["cache-control"] = "no-store"
            let d = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
            reply(["status": status, "headers": h, "body": d.base64EncodedString()])
        }
        var headers: [String: String] = [:]
        for (k, v) in (msg["headers"] as? [String: Any]) ?? [:] { if let s = v as? String { headers[k.lowercased()] = s } }
        guard let url = HelperRelay.allowed(headers["x-tn-target"] ?? "") else { json(403, ["error": "host"]); return }
        let host = (url.host ?? "").lowercased()
        let method = ((msg["method"] as? String) ?? "GET").uppercased()
        guard ["GET", "POST", "PUT", "DELETE", "HEAD"].contains(method) else { json(405, ["error": "method"]); return }

        var req = URLRequest(url: url)
        req.httpMethod = method
        for k in relayPassReq {
            guard let v = headers[k], !v.isEmpty else { continue }
            if let only = relaySecretHosts[k], !only.contains(host) { continue }     // a secret never leaves for another host
            req.setValue(v, forHTTPHeaderField: k)
        }
        if let ck = headers["x-tn-cookie"], !ck.isEmpty, relayCookieHosts.contains(host) { req.setValue(ck, forHTTPHeaderField: "Cookie") }
        req.setValue("Mozilla/5.0 (TeleNova helper)", forHTTPHeaderField: "User-Agent")
        if method != "GET" && method != "HEAD", let b = msg["body"] as? String, !b.isEmpty {
            guard let d = Data(base64Encoded: b), d.count <= relayMaxBody else { json(413, ["error": "too_large"]); return }
            req.httpBody = d
        }

        session.dataTask(with: req) { data, resp, error in
            DispatchQueue.main.async {
                guard error == nil, let http = resp as? HTTPURLResponse else { json(502, ["error": "upstream"]); return }
                var h: [String: String] = [:]
                for (k, v) in http.allHeaderFields {
                    if let ks = (k as? String)?.lowercased(), relayPassRes.contains(ks), let vs = v as? String { h[ks] = vs }
                }
                if relayCookieHosts.contains(host), let all = http.allHeaderFields as? [String: String] {
                    let cs = HTTPCookie.cookies(withResponseHeaderFields: all, for: url)
                    if !cs.isEmpty { h["x-tn-set-cookie"] = cs.map { $0.name + "=" + $0.value }.joined(separator: "; ") }
                }
                if (300..<400).contains(http.statusCode) {
                    let loc = http.value(forHTTPHeaderField: "Location") ?? ""
                    let next = URL(string: loc, relativeTo: url).flatMap { HelperRelay.allowed($0.absoluteString) }
                    let red: Any = next.map { $0.absoluteString as Any } ?? NSNull()
                    h["x-tn-status"] = String(http.statusCode)
                    json(200, ["redirect": red], h)
                    return
                }
                let body = data ?? Data()
                if body.count > relayMaxAnswer { json(502, ["error": "too_large"]); return }
                if h["cache-control"] == nil { h["cache-control"] = "no-store" }
                reply(["status": http.statusCode, "headers": h, "body": body.base64EncodedString()])
            }
        }.resume()
    }
}
