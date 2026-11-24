import Cocoa
import WebKit
import AuthenticationServices

// BN Stream for Mac: the live site https://bennymat93.github.io/TeleNova/web/ in a WKWebView (a new web version arrives
// with a reload), with the copy of web/ inside the app as the offline fallback (LocalServer on 127.0.0.1). The page
// lays itself out as the desktop shell (wide window, mouse). The helper Worker is built in (HelperRelay).
final class MacWebController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply,
                              WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    static let site = URL(string: "https://bennymat93.github.io/TeleNova/web/")!
    static let background = NSColor(red: 11 / 255, green: 13 / 255, blue: 18 / 255, alpha: 1)

    private enum Mode { case live, local }
    private var webView: WKWebView!
    private var mode = Mode.live
    private var authSession: ASWebAuthenticationSession?
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var pendingLink: String?

    let selftest = ProcessInfo.processInfo.arguments.contains("-selftest")
    private var selftestDone = false
    private var openPanelSeen = false
    private lazy var outDir: URL = {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-out"), i + 1 < a.count { return URL(fileURLWithPath: a[i + 1]) }
        return FileManager.default.temporaryDirectory.appendingPathComponent("bnstream-selftest")
    }()

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                    // persistent: storage stays between launches
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        if #available(macOS 12.3, *) { cfg.preferences.isElementFullscreenEnabled = true }
        let ver = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
        cfg.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 BNStreamMac/" + ver
        if let u = Bundle.main.url(forResource: "bridge", withExtension: "js"), let src = try? String(contentsOf: u, encoding: .utf8) {
            cfg.userContentController.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "telenova")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820), configuration: cfg)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true      // two-finger swipe = the page's own back
        webView.allowsMagnification = false
        webView.setValue(false, forKey: "drawsBackground")      // the page's dark colour, no white flash
        webView.autoresizingMask = [.width, .height]
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        let holder = NSView(frame: webView.frame)
        holder.wantsLayer = true
        holder.layer?.backgroundColor = MacWebController.background.cgColor
        holder.addSubview(webView)
        view = holder
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if ProcessInfo.processInfo.arguments.contains("-forceOffline") { goLocal() } else { loadSite() }
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        // the page starts under the title bar's traffic lights: keep it below them
        let top: CGFloat = (view.window?.styleMask.contains(.fullScreen) ?? false) ? 0 : 28
        webView.frame = NSRect(x: 0, y: 0, width: view.bounds.width, height: max(0, view.bounds.height - top))
    }

    // ------------------------------------------------------------------ loading
    private func loadSite(hash: String = "") {
        mode = .live
        let url = URL(string: MacWebController.site.absoluteString + hash) ?? MacWebController.site
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 25))
    }

    private func goLocal() {
        guard LocalServer.shared.hasFiles else { return }
        LocalServer.shared.start { [weak self] port in
            guard let self = self, let p = port, let url = URL(string: "http://127.0.0.1:\(p)/") else { return }
            self.mode = .local
            self.webView.load(URLRequest(url: url))
        }
    }

    private func isApp(_ url: URL?) -> Bool {
        guard let u = url, let host = u.host else { return false }
        if u.scheme == "https" && host == MacWebController.site.host && u.path.hasPrefix("/TeleNova/") { return true }
        if u.scheme == "http" && host == "127.0.0.1" && LocalServer.shared.port != 0 && u.port == Int(LocalServer.shared.port) { return true }
        return false
    }

    @discardableResult
    func handleIncoming(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count < 4000 else { return false }
        if t.hasPrefix("telenova://gdrive") { return true }        // answered by the sign-in sheet itself
        if let r = t.range(of: "^bnstream://setup/[A-Za-z0-9_-]+$", options: [.regularExpression, .caseInsensitive]) {
            go(hash: "#setup=" + (String(t[r]).components(separatedBy: "/").last ?? ""), reload: true); return true
        }
        if let r = t.range(of: "pair=\\d{3,12}\\.[0-9a-fA-F]{32}", options: .regularExpression) {
            go(hash: "#" + String(t[r]), reload: true); return true
        }
        if t.lowercased().hasPrefix("telenova:") || t.lowercased().hasPrefix("bnstream:") {
            let frag = URLComponents(string: t)?.fragment ?? ""
            go(hash: frag.isEmpty ? "#/" : "#" + frag, reload: false); return true
        }
        return false
    }

    private func go(hash: String, reload: Bool) {
        guard webView != nil else { pendingLink = hash; return }
        if isApp(webView.url), let d = try? JSONEncoder().encode(hash), let q = String(data: d, encoding: .utf8) {
            webView.evaluateJavaScript("location.hash = \(q);" + (reload ? " location.reload();" : ""), completionHandler: nil)
        } else { loadSite(hash: hash) }
    }

    // ------------------------------------------------------------------ menu actions
    @objc func reloadPage(_ s: Any?) { if mode == .local || webView.url == nil { loadSite() } else { webView.reload() } }
    @objc func goBack(_ s: Any?) { webView.evaluateJavaScript("history.back()", completionHandler: nil) }
    @objc func goForward(_ s: Any?) { webView.evaluateJavaScript("history.forward()", completionHandler: nil) }
    @objc func goHome(_ s: Any?) { webView.evaluateJavaScript("location.hash = '#/'", completionHandler: nil) }
    @objc func openSearch(_ s: Any?) {
        webView.evaluateJavaScript("""
        (function () { var i = document.querySelector('.top input[type=search], .top input, #q');
          if (i) { i.focus(); i.select && i.select(); } else { location.hash = '#/hub'; } })()
        """, completionHandler: nil)
    }
    @objc func zoomReset(_ s: Any?) { webView.pageZoom = 1 }
    @objc func zoomIn(_ s: Any?) { webView.pageZoom = min(2.0, webView.pageZoom + 0.1) }
    @objc func zoomOut(_ s: Any?) { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }

    // ------------------------------------------------------------------ navigation
    private func openOutside(_ url: URL) { if !selftest { NSWorkspace.shared.open(url) } }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = (url.scheme ?? "").lowercased()
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        if scheme == "about" || scheme == "blob" || scheme == "data" { decisionHandler(.allow); return }
        if scheme != "http" && scheme != "https" { openOutside(url); decisionHandler(.cancel); return }
        guard let frame = navigationAction.targetFrame else { openOutside(url); decisionHandler(.cancel); return }
        if frame.isMainFrame && !isApp(url) { openOutside(url); decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if mode == .live { goLocal() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let h = pendingLink { pendingLink = nil; go(hash: h, reload: true) }
        if selftest && !selftestDone { selftestDone = true; runSelftest() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // new windows (target=_blank, window.open): the default browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, u.scheme == "http" || u.scheme == "https" { openOutside(u) }
        return nil
    }

    // ------------------------------------------------------------------ files: <input type=file> and downloads
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        if selftest { openPanelSeen = true; completionHandler(nil); return }
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = false
        p.canChooseFiles = true
        p.beginSheetModal(for: view.window!) { r in completionHandler(r == .OK ? p.urls : nil) }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        if selftest {
            let u = outDir.appendingPathComponent(suggestedFilename)
            try? FileManager.default.removeItem(at: u)
            downloads[ObjectIdentifier(download)] = u
            completionHandler(u)
            return
        }
        let p = NSSavePanel()
        p.nameFieldStringValue = suggestedFilename
        p.directoryURL = downloadsDir
        p.canCreateDirectories = true
        p.beginSheetModal(for: view.window!) { [weak self] r in
            guard r == .OK, let u = p.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: u)          // the save panel already asked "replace?"
            self?.downloads[ObjectIdentifier(download)] = u
            completionHandler(u)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let u = downloads.removeValue(forKey: ObjectIdentifier(download)), !selftest {
            NSWorkspace.shared.activateFileViewerSelecting([u])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    // ------------------------------------------------------------------ page dialogs
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        if selftest { completionHandler(); return }
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: view.window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        if selftest { completionHandler(true); return }
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: view.window!) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if selftest { completionHandler(defaultText); return }
        let a = NSAlert(); a.messageText = prompt
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24)); f.stringValue = defaultText ?? ""
        a.accessoryView = f; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: view.window!) { r in completionHandler(r == .alertFirstButtonReturn ? f.stringValue : nil) }
    }

    // ------------------------------------------------------------------ bridge (bridge.js)
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let o = message.frameInfo.securityOrigin
        let trusted = message.frameInfo.isMainFrame &&
            ((o.protocol == "https" && o.host == MacWebController.site.host) || (o.protocol == "http" && o.host == "127.0.0.1"))
        guard trusted, let body = message.body as? [String: Any], let op = body["op"] as? String else { replyHandler(nil, "refused"); return }
        switch op {
        case "relay": HelperRelay.shared.handle(body) { replyHandler($0, nil) }
        case "gauth":
            guard let s = body["url"] as? String, let u = URL(string: s), u.host == "accounts.google.com" else { replyHandler(nil, "bad"); return }
            googleSignIn(u) { replyHandler(true, nil) }
        case "clipRead": replyHandler(NSPasteboard.general.string(forType: .string) ?? "", nil)
        case "clipWrite":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString((body["text"] as? String) ?? "", forType: .string)
            replyHandler(true, nil)
        case "update": checkAppUpdate(); replyHandler(true, nil)
        default: replyHandler(nil, "unknown op")
        }
    }

    // "Update everything": a newer Mac release (GitHub release "mac-<version>") is offered
    private func checkAppUpdate() {
        let mine = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
        guard let url = URL(string: "https://api.github.com/repos/bennymat93/TeleNova/releases?per_page=40") else { return }
        var req = URLRequest(url: url); req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data = data, let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return }
            let tags = list.compactMap { $0["tag_name"] as? String }.filter { $0.hasPrefix("mac-") }.map { String($0.dropFirst(4)) }
            func parts(_ v: String) -> [Int] { v.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 } }
            func newer(_ a: String, _ b: String) -> Bool {
                let x = parts(a), y = parts(b)
                for i in 0..<max(x.count, y.count) { let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0; if p != q { return p > q } }
                return false
            }
            guard let best = tags.max(by: { newer($1, $0) }), newer(best, mine) else { return }
            DispatchQueue.main.async {
                guard let self = self, !self.selftest, let w = self.view.window else { return }
                let a = NSAlert()
                a.messageText = "A newer BN Stream for Mac: \(best)"
                a.informativeText = "Installed: \(mine). Download the new version and replace the app in Applications (your data stays)."
                a.addButton(withTitle: "Download"); a.addButton(withTitle: "Later")
                a.beginSheetModal(for: w) { r in
                    if r == .alertFirstButtonReturn, let u = URL(string: "https://bennymat93.github.io/TeleNova/mac/") { NSWorkspace.shared.open(u) }
                }
            }
        }.resume()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { view.window ?? NSWindow() }

    // Google's page in the system sign-in sheet; the answer (telenova://gdrive#...) goes to the page as the pop-up's message
    private func googleSignIn(_ url: URL, done: @escaping () -> Void) {
        authSession?.cancel()
        let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "telenova") { [weak self] cb, _ in
            DispatchQueue.main.async {
                defer { done() }
                guard let self = self else { return }
                var msg: [String: Any] = ["type": "tn_gdrive", "state": "", "token": "", "expires": 0, "error": "access_denied"]
                if let cb = cb, let frag = URLComponents(url: cb, resolvingAgainstBaseURL: false)?.fragment {
                    var q = URLComponents(); q.percentEncodedQuery = frag
                    var v: [String: String] = [:]
                    for i in q.queryItems ?? [] { v[i.name] = i.value ?? "" }
                    var state = v["state"] ?? ""
                    if state.hasPrefix("tnapp-") { state = String(state.dropFirst(6)) }
                    msg = ["type": "tn_gdrive", "state": state, "token": v["access_token"] ?? "",
                           "expires": Int(v["expires_in"] ?? "") ?? 0, "error": v["error"] ?? ""]
                }
                guard let d = try? JSONSerialization.data(withJSONObject: msg), let js = String(data: d, encoding: .utf8) else { return }
                self.webView.evaluateJavaScript("window.postMessage(\(js), location.origin);", completionHandler: nil)
            }
        }
        s.presentationContextProvider = self
        s.prefersEphemeralWebBrowserSession = false
        authSession = s
        if !s.start() { done() }
    }

    // ------------------------------------------------------------------ self-test (CI: "-selftest -out <dir>")
    private static let pages = ["#/", "#/srcedit", "#/aio", "#/services", "#/backup"]
    private static let measureJS = """
    const W = innerWidth, H = innerHeight, out = {hash: location.hash, w: W, h: H};
    const sc = document.scrollingElement || document.documentElement;
    out.pageScrollW = sc.scrollWidth;
    const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    const inX = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return true; } return false; };
    const sticks = [], clipped = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e);
      if ((r.right > W + 1 || r.left < -1) && !inX(e) && sticks.length < 8) sticks.push(name(e));
      const meant = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || e.matches('.sr,.sprite,img,video,canvas,svg,iframe');
      const hid = (v) => v === 'hidden' || v === 'clip';
      if (!meant && ((hid(cs.overflowY) && e.scrollHeight > e.clientHeight + 2) || (hid(cs.overflowX) && e.scrollWidth > e.clientWidth + 2)) && clipped.length < 8 && !e.closest('details:not([open])')) clipped.push(name(e) + ' ' + e.scrollWidth + '/' + e.clientWidth);
    }
    out.sticksOut = sticks; out.clipped = clipped;
    out.shell = document.documentElement.dataset.shell || '';
    out.rail = !!(document.getElementById('rail') && getComputedStyle(document.getElementById('rail')).display !== 'none');
    out.tabs = !!(document.getElementById('tabs') && getComputedStyle(document.getElementById('tabs')).display !== 'none');
    out.text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200);
    return JSON.stringify(out);
    """

    private func snap(_ name: String, _ done: @escaping () -> Void) {
        webView.takeSnapshot(with: nil) { [weak self] img, _ in
            if let self = self, let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: self.outDir.appendingPathComponent(name + ".png"))
            }
            done()
        }
    }

    private func measure(_ tag: String, _ sizes: [NSSize], _ i: Int, _ acc: [[String: Any]], _ done: @escaping ([[String: Any]]) -> Void) {
        let pages = MacWebController.pages
        let total = sizes.count * pages.count
        guard i < total else { done(acc); return }
        let size = sizes[i / pages.count], page = pages[i % pages.count]
        if i % pages.count == 0, let w = view.window {
            var f = w.frame; f.size = size; w.setFrame(f, display: true)
        }
        webView.evaluateJavaScript("scrollTo(0,0); location.hash = '\(page)';", completionHandler: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self else { return }
            let name = "\(tag)-\(Int(size.width))-" + (page == "#/" ? "home" : page.replacingOccurrences(of: "#/", with: ""))
            self.snap(name) {
                self.webView.callAsyncJavaScript(MacWebController.measureJS, arguments: [:], in: nil, in: .page) { r in
                    var o: [String: Any] = ["page": page, "window": "\(Int(size.width))x\(Int(size.height))"]
                    if case .success(let v) = r, let s = v as? String, let d = s.data(using: .utf8),
                       let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { o.merge(j) { a, _ in a } }
                    self.measure(tag, sizes, i + 1, acc + [o], done)
                }
            }
        }
    }

    private func runSelftest() {
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let js = """
        const out = {};
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 40 && !self.TN; i++) await wait(250);
        await wait(2500);
        out.tn = !!self.TN; out.ver = self.WEB_VERSION || ''; out.shell = document.documentElement.dataset.shell || '';
        out.native = !!window.TeleNovaNative; out.ua = navigator.userAgent;
        out.swApi = 'serviceWorker' in navigator;
        try { const reg = await Promise.race([navigator.serviceWorker.ready, wait(15000).then(() => null)]); out.swReady = !!reg;
              for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await wait(250); out.swControls = !!navigator.serviceWorker.controller; } catch (e) { out.swError = String(e); }
        try { const H = 'https://helper.telenova.invalid';
              out.helperPing = await (await fetch(H + '/ping')).json();
              const rd = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://api.real-debrid.com/oauth/v2/device/code?client_id=X245A4XAIBGVM&new_credentials=yes'}});
              const rj = await rd.json().catch(() => ({})); out.rdDeviceCode = {status: rd.status, ok: !!rj.device_code};
              const rf = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://example.com/'}}); out.helperRefused = rf.status;
        } catch (e) { out.helperError = String(e); }
        try { const v = document.createElement('video'); v.muted = true; v.playsInline = true;
              v.src = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';
              document.body.appendChild(v); await v.play().catch((e) => { out.playError = String(e); });
              for (let i = 0; i < 40 && v.currentTime < 2; i++) await wait(250);
              out.playback = {time: Math.round(v.currentTime * 10) / 10, w: v.videoWidth, h: v.videoHeight, err: v.error ? v.error.code : 0};
              v.pause(); v.remove(); } catch (e) { out.playError = String(e); }
        try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['selftest'], {type: 'application/octet-stream'}));
              a.download = 'BN_Stream_backup.tncfg'; document.body.appendChild(a); a.click(); a.remove(); await wait(2000); } catch (e) { out.downloadError = String(e); }
        try {
          out.bnNative = !!(window.BNNative && BNNative.fullUpdate && BNNative.clipRead && BNNative.clipWrite);
          await BNNative.clipWrite('bn-clip-test-61');
          out.clipRoundTrip = (await navigator.clipboard.readText()) === 'bn-clip-test-61';
          location.hash = '#/hub'; await wait(2500);
          const inp = document.querySelector('#view input[type=search], #view input[type=text], .top input');
          if (inp) { inp.focus(); inp.click(); }
          await wait(1200);
          const bar = document.querySelector('.osk_bar');
          out.oskBar = !!(bar && bar.getBoundingClientRect().height > 0);
          if (bar) {
            const bs = bar.querySelectorAll('button');
            bs[0] && bs[0].click(); await wait(600);
            const keys = Array.from(document.querySelectorAll('.osk_kbd .osk_k'));
            const letter = keys.find((k) => k.textContent.trim().length === 1 && !/[0-9 ⇧⌫⏎✕]/.test(k.textContent));
            const before = inp ? inp.value : '';
            if (letter) letter.click();
            await wait(300);
            out.oskTyped = inp ? inp.value !== before : false;
            const langKey = keys.find((k) => /🌐/.test(k.textContent));
            const l1 = langKey ? langKey.textContent : '';
            if (langKey) langKey.click();
            await wait(300);
            const k2 = Array.from(document.querySelectorAll('.osk_kbd .osk_k')).find((k) => /🌐/.test(k.textContent));
            out.oskLangCycle = !!(k2 && k2.textContent !== l1);
            if (inp) inp.value = '';
            bs[1] && bs[1].click(); await wait(800);
            out.oskPasted = inp ? inp.value.indexOf('bn-clip-test-61') >= 0 : false;
          }
        } catch (e) { out.oskError = String(e); }
        try { location.hash = '#/backup'; await wait(2500);
              const f = document.querySelector('input[type=file]'); out.fileInputs = document.querySelectorAll('input[type=file]').length;
              if (f) { f.click(); await wait(1500); } } catch (e) { out.fileError = String(e); }
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { [weak self] r in
            guard let self = self else { return }
            var out: [String: Any] = ["mode": self.mode == .live ? "live" : "local",
                                      "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""]
            if case .success(let v) = r, let s = v as? String, let d = s.data(using: .utf8),
               let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { out.merge(j) { a, _ in a } }
            else if case .failure(let e) = r { out["jsError"] = "\(e)" }
            out["openPanelShown"] = self.openPanelSeen
            out["downloadSaved"] = FileManager.default.fileExists(atPath: self.outDir.appendingPathComponent("BN_Stream_backup.tncfg").path)
            self.measure("win", [NSSize(width: 760, height: 560), NSSize(width: 1600, height: 1000)], 0, []) { pages in
                out["pages"] = pages
                if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
                    try? d.write(to: self.outDir.appendingPathComponent("selftest.json"))
                }
                try? Data("done".utf8).write(to: self.outDir.appendingPathComponent("done.txt"))
            }
        }
    }
}
