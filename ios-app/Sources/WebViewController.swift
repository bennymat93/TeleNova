import UIKit
import WebKit
import SafariServices
import Network
import UniformTypeIdentifiers

// One WKWebView around the TeleNova web version.
//
// Where the page comes from (see ios/README-app.md):
//  * live:  https://bennymat93.github.io/TeleNova/web/ - an App-Bound Domain (Info.plist WKAppBoundDomains +
//           limitsNavigationsToAppBoundDomains), the only way a WKWebView gets a service worker. The page's own
//           service worker then gives the offline shell and the Telegram playback proxy (/tgstream/), exactly as in
//           Safari, and a new web version arrives without a new IPA.
//  * local: the copy of web/ inside the app, served by LocalServer on 127.0.0.1 - only when the live site cannot be
//           reached and the service worker has nothing cached yet. Separate storage, no service worker.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply,
                               WKDownloadDelegate, UIDocumentPickerDelegate, UIScrollViewDelegate {
    static let site = URL(string: "https://bennymat93.github.io/TeleNova/web/")!
    static let background = UIColor(red: 11 / 255, green: 13 / 255, blue: 18 / 255, alpha: 1)   // #0b0d12, the page's own

    private enum Mode { case live, local }
    private enum Pick { case browse, importing }
    private struct Save { let handle: FileHandle; let tmp: URL; let name: String }

    private var webView: WKWebView!
    private var mode = Mode.live
    private var pick = Pick.browse
    private var saves: [String: Save] = [:]
    private var downloads: [ObjectIdentifier: URL] = [:]
    private let menuButton = UIButton(type: .system)
    private let offlineBar = UIButton(type: .system)
    private let tgButton = UIButton(type: .system)          // "confirm the sign-in in the Telegram app"
    private var tgLogin: URL?
    private var keyboardUp = false
    private let monitor = NWPathMonitor()
    private var online = true
    private var pendingLink: String?

    private let selftest = ProcessInfo.processInfo.arguments.contains("-selftest")
    private let forceOffline = ProcessInfo.processInfo.arguments.contains("-forceOffline")
    private var selftestDone = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    // iPad: the page's wide layout puts its logo in the top corner, under the clock - so no status bar there
    override var prefersStatusBarHidden: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    // ------------------------------------------------------------------ view
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = WebViewController.background

        let cfg = WKWebViewConfiguration()
        cfg.limitsNavigationsToAppBoundDomains = true
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsPictureInPictureMediaPlayback = true
        cfg.allowsAirPlayForMediaPlayback = true
        if #available(iOS 15.4, *) { cfg.preferences.isElementFullscreenEnabled = true }
        let ver = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
        // the default is "Mobile/15E148"; the page's checks expect a Safari-like string
        cfg.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1 TeleNovaApp/" + ver
        if let u = Bundle.main.url(forResource: "bridge", withExtension: "js"), let src = try? String(contentsOf: u, encoding: .utf8) {
            cfg.userContentController.addUserScript(
                WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "telenova")

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = WebViewController.background
        webView.scrollView.backgroundColor = WebViewController.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never     // the page handles the notch (viewport-fit=cover)
        // pull down at the top of the page = reload (a new web version shows after a reload, no new IPA needed)
        let pull = UIRefreshControl()
        pull.tintColor = .white
        pull.addTarget(self, action: #selector(pulled(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = pull
        webView.scrollView.alwaysBounceVertical = true
        webView.allowsBackForwardNavigationGestures = true            // edge swipe = the page's own back (hash history)
        webView.allowsLinkPreview = false
        webView.scrollView.delegate = self                            // no pinch zoom: the page has its own size control
        view.addSubview(webView)

        setUpOfflineBar()
        setUpMenuButton()
        setUpTgButton()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)

        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let was = self.online
                self.online = path.status == .satisfied
                if self.online && !was && self.mode == .local && !self.forceOffline { self.loadSite() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "telenova.net"))

        if forceOffline { goLocal() } else { loadSite() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        placeMenuButton()
        let tgWidth = min(view.bounds.width - 32, 360)
        tgButton.frame = CGRect(x: (view.bounds.width - tgWidth) / 2, y: view.bounds.height - view.safeAreaInsets.bottom - 132,
                                width: tgWidth, height: 50)
        let top = view.safeAreaInsets.top
        offlineBar.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: top + 34)
        // the offline bar sits above the page, not over its top bar
        let barHeight: CGFloat = offlineBar.isHidden ? 0 : top + 34
        let frame = CGRect(x: 0, y: barHeight, width: view.bounds.width, height: view.bounds.height - barHeight)
        if webView.frame != frame { webView.frame = frame }
        offlineBar.contentEdgeInsets = UIEdgeInsets(top: top, left: 12, bottom: 0, right: 12)
    }

    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
        if scrollView.zoomScale != scrollView.minimumZoomScale { scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false) }
    }

    // ------------------------------------------------------------------ loading
    private func loadSite(hash: String = "") {
        mode = .live
        let url = URL(string: WebViewController.site.absoluteString + hash) ?? WebViewController.site
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 25))
    }

    @objc private func pulled(_ sender: UIRefreshControl) {
        if mode == .local || webView.url == nil { if !forceOffline { loadSite() } } else { webView.reload() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { sender.endRefreshing() }
    }

    private func goLocal() {
        guard LocalServer.shared.hasFiles else { showLoadError(); return }
        LocalServer.shared.start { [weak self] port in
            guard let self = self else { return }
            guard let p = port, let url = URL(string: "http://127.0.0.1:\(p)/") else { self.showLoadError(); return }
            self.mode = .local
            self.offlineBar.isHidden = false
            self.view.setNeedsLayout()
            self.webView.load(URLRequest(url: url))
        }
    }

    private func showLoadError() {
        if selftest { writeSelftest(["error": "load failed, no local copy"]); return }
        let a = UIAlertController(title: "אין חיבור", message: "לא ניתן לטעון את BN Stream. בדקו את החיבור לאינטרנט.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "ניסיון חוזר", style: .default) { [weak self] _ in self?.loadSite() })
        a.addAction(UIAlertAction(title: "סגירה", style: .cancel))
        show(a)
    }

    private var baseURL: URL {
        if mode == .local, LocalServer.shared.port != 0, let u = URL(string: "http://127.0.0.1:\(LocalServer.shared.port)/") { return u }
        return WebViewController.site
    }

    private func isApp(_ url: URL?) -> Bool {
        guard let u = url, let host = u.host else { return false }
        if u.scheme == "https" && host == WebViewController.site.host && u.path.hasPrefix("/TeleNova/") { return true }
        if u.scheme == "http" && host == "127.0.0.1" && LocalServer.shared.port != 0 && u.port == Int(LocalServer.shared.port) { return true }
        return false
    }

    func cameToForeground() {
        guard isViewLoaded else { return }
        if mode == .local {                              // the listening socket does not survive a suspended app
            LocalServer.shared.start { [weak self] port in
                guard let self = self, self.mode == .local else { return }
                if self.online && !self.forceOffline { self.loadSite() }
                else if let p = port, self.webView.url?.port != Int(p) { self.goLocal() }
            }
        } else if webView.url == nil && !webView.isLoading {
            loadSite()
        }
    }

    // ------------------------------------------------------------------ links from outside (QR, clipboard, telenova://)
    @discardableResult
    func handleIncoming(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count < 4000 else { return false }
        if let r = t.range(of: "pair=\\d{3,12}\\.[0-9a-fA-F]{32}", options: .regularExpression) {
            go(hash: "#" + String(t[r]), reload: true)           // the page reads #pair= when it starts
            return true
        }
        if t.range(of: "^\\d{3,12}[.\\s:]+[0-9a-fA-F]{32}$", options: .regularExpression) != nil {
            let p = t.components(separatedBy: CharacterSet(charactersIn: ". :\t")).filter { !$0.isEmpty }
            if p.count == 2 { go(hash: "#pair=" + p[0] + "." + p[1], reload: true); return true }
        }
        if let r = t.range(of: "^(https?://)?(t|telegram)\\.me/\\S+$", options: [.regularExpression, .caseInsensitive]) {
            var link = String(t[r])
            if !link.lowercased().hasPrefix("http") { link = "https://" + link }
            if link.lowercased().hasPrefix("http://") { link = "https://" + String(link.dropFirst(7)) }
            go(hash: "#/telegram/link=" + link, reload: false)
            return true
        }
        if t.range(of: "^tg://login\\?token=[A-Za-z0-9_-]+$", options: .regularExpression) != nil, let u = URL(string: t) {
            UIApplication.shared.open(u, options: [:], completionHandler: nil)   // a Telegram sign-in code: Telegram confirms it
            return true
        }
        // "move the whole setup to another device" (web 5.2.1): bnstream://setup/<payload> from the page's
        // "Open in the BN Stream app" button, or the https link itself (scanned / pasted): .../web/#setup=<payload>
        if let r = t.range(of: "^bnstream://setup/[A-Za-z0-9_-]+$", options: [.regularExpression, .caseInsensitive]) {
            let payload = String(t[r]).components(separatedBy: "/").last ?? ""
            go(hash: "#setup=" + payload, reload: true)
            return true
        }
        if let r = t.range(of: "#setup=[A-Za-z0-9_-]+$", options: .regularExpression) {
            go(hash: String(t[r]), reload: true)
            return true
        }
        if t.lowercased().hasPrefix("telenova:") || t.lowercased().hasPrefix("bnstream:") {
            let frag = URLComponents(string: t)?.fragment ?? ""
            go(hash: frag.isEmpty ? "#/" : "#" + frag, reload: false)
            return true
        }
        if let u = URL(string: t), isApp(u), u.scheme == "https" {
            mode = .live
            webView.load(URLRequest(url: u))
            return true
        }
        return false
    }

    private func go(hash: String, reload: Bool) {
        guard isViewLoaded else { pendingLink = hash; return }
        if isApp(webView.url), let d = try? JSONEncoder().encode(hash), let q = String(data: d, encoding: .utf8) {
            webView.evaluateJavaScript("location.hash = \(q);" + (reload ? " location.reload();" : ""), completionHandler: nil)
        } else if mode == .local, let u = URL(string: baseURL.absoluteString + hash) {
            webView.load(URLRequest(url: u))
        } else {
            loadSite(hash: hash)
        }
    }

    func quickAction(_ type: String) -> Bool {
        switch type {
        case "files": showFiles()
        case "import": importFiles()
        case "scan": scanPair()
        default: return false
        }
        return true
    }

    // ------------------------------------------------------------------ navigation
    // A link that leaves the page. An app that owns the address gets it (t.me -> Telegram, YouTube -> its app);
    // any other web page opens in a Safari sheet INSIDE the app, so the page underneath keeps running - a sign-in
    // that waits for an approval on another site (Real-Debrid's device page) is not cut off by leaving the app.
    private func openOutside(_ url: URL) {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https" else {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }
        if selftest { return }
        UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { [weak self] opened in
            guard let self = self, !opened else { return }
            let sheet = SFSafariViewController(url: url)
            sheet.preferredBarTintColor = WebViewController.background
            sheet.preferredControlTintColor = .white
            sheet.dismissButtonStyle = .done
            self.show(sheet)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = (url.scheme ?? "").lowercased()
        if navigationAction.shouldPerformDownload && (scheme == "blob" || scheme == "data" || isApp(url)) {
            decisionHandler(.download)
            return
        }
        if scheme == "about" || scheme == "blob" || scheme == "data" { decisionHandler(.allow); return }
        if scheme != "http" && scheme != "https" {                   // tg:, mailto:, itms-apps: ...
            openOutside(url)
            decisionHandler(.cancel)
            return
        }
        guard let frame = navigationAction.targetFrame else {        // target=_blank / window.open: the system browser
            openOutside(url)                                         // (t.me links open the Telegram app)
            decisionHandler(.cancel)
            return
        }
        if frame.isMainFrame && !isApp(url) {
            openOutside(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, mode == .live, !forceOffline,
           let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 500 {
            decisionHandler(.cancel)
            goLocal()
            return
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    private func ignorable(_ error: Error) -> Bool {
        let e = error as NSError
        return (e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled) || (e.domain == "WebKitErrorDomain" && e.code == 102)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if ignorable(error) { return }
        if mode == .live { goLocal() } else { showLoadError() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if mode == .live && webView.url?.scheme == "https" { offlineBar.isHidden = true; view.setNeedsLayout() }
        if let h = pendingLink { pendingLink = nil; go(hash: h, reload: h.hasPrefix("#pair=") || h.hasPrefix("#setup=")) }
        if selftest && !selftestDone { selftestDone = true; runSelftest() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // ------------------------------------------------------------------ page dialogs and new windows
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, u.scheme == "http" || u.scheme == "https" { openOutside(u) }
        return nil
    }

    private var top: UIViewController {
        var t: UIViewController = self
        while let p = t.presentedViewController, !p.isBeingDismissed { t = p }
        return t
    }

    // a page dialog whose answer is never given crashes the web view, so it is shown only when it really can be
    private var canPresentNow: Bool {
        let t = top
        return t.viewIfLoaded?.window != nil && t.presentedViewController == nil && !t.isBeingPresented && !t.isBeingDismissed
    }

    private func show(_ c: UIViewController) {
        if let pop = c.popoverPresentationController, pop.sourceView == nil {
            pop.sourceView = menuButton.isHidden ? view : menuButton
            pop.sourceRect = menuButton.isHidden ? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1) : menuButton.bounds
        }
        top.present(c, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        if selftest || !canPresentNow { completionHandler(); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "אישור", style: .default) { _ in completionHandler() })
        show(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        if selftest { completionHandler(true); return }
        if !canPresentNow { completionHandler(false); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "ביטול", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "אישור", style: .default) { _ in completionHandler(true) })
        show(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if selftest { completionHandler(defaultText); return }
        if !canPresentNow { completionHandler(nil); return }
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "ביטול", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "אישור", style: .default) { [weak a] _ in completionHandler(a?.textFields?.first?.text ?? "") })
        show(a)
    }

    // ------------------------------------------------------------------ files: exports from the page
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        let trusted = message.frameInfo.isMainFrame &&
            ((origin.protocol == "https" && origin.host == WebViewController.site.host) ||
             (origin.protocol == "http" && origin.host == "127.0.0.1"))
        guard trusted, let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "refused")
            return
        }
        switch op {
        case "begin":
            let id = UUID().uuidString
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("save-" + id)
            FileManager.default.createFile(atPath: tmp.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: tmp) else { replyHandler(nil, "cannot write"); return }
            saves[id] = Save(handle: h, tmp: tmp, name: (body["name"] as? String) ?? "file")
            replyHandler(["id": id], nil)
        case "chunk":
            guard let id = body["id"] as? String, let s = saves[id], let b64 = body["data"] as? String,
                  let data = Data(base64Encoded: b64) else { replyHandler(nil, "bad chunk"); return }
            s.handle.write(data)
            replyHandler(true, nil)
        case "end", "abort":
            guard let id = body["id"] as? String, let s = saves.removeValue(forKey: id) else { replyHandler(nil, "unknown"); return }
            try? s.handle.close()
            if op == "abort" { try? FileManager.default.removeItem(at: s.tmp); replyHandler(true, nil); return }
            let dst = FileStore.destination(for: s.name)
            do {
                try FileManager.default.moveItem(at: s.tmp, to: dst)
                replyHandler(["ok": true, "path": FileStore.shortPath(dst)] as [String: Any], nil)
                saved(dst)
            } catch {
                try? FileManager.default.removeItem(at: s.tmp)
                replyHandler(nil, "cannot save")
            }
        case "dataurl":
            guard let url = body["url"] as? String, let comma = url.firstIndex(of: ",") else { replyHandler(nil, "bad"); return }
            let head = url[..<comma].lowercased(), payload = String(url[url.index(after: comma)...])
            let data = head.hasSuffix(";base64") ? Data(base64Encoded: payload) : (payload.removingPercentEncoding ?? payload).data(using: .utf8)
            let dst = FileStore.destination(for: (body["name"] as? String) ?? "file")
            guard let d = data, (try? d.write(to: dst)) != nil else { replyHandler(nil, "cannot save"); return }
            replyHandler(["ok": true, "path": FileStore.shortPath(dst)] as [String: Any], nil)
            saved(dst)
        case "relay": HelperRelay.shared.handle(body) { replyHandler($0, nil) }
        case "tgqr":
            let text = (body["url"] as? String) ?? ""
            let ok = text.range(of: "^tg://login\\?token=[A-Za-z0-9_-]+$", options: .regularExpression) != nil
            tgLogin = ok ? URL(string: text) : nil
            updateTgButton()
            replyHandler(true, nil)
        case "files": showFiles(); replyHandler(true, nil)
        case "import": importFiles(); replyHandler(true, nil)
        case "scan": scanPair(); replyHandler(true, nil)
        default: replyHandler(nil, "unknown op")
        }
    }

    private func saved(_ url: URL) {
        if selftest { return }
        let a = UIAlertController(title: "הקובץ נשמר",
                                  message: "קבצים › BN Stream › " + FileStore.shortPath(url).replacingOccurrences(of: "/", with: " › "),
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "שיתוף / שמירה במקום אחר", style: .default) { [weak self] _ in self?.share([url]) })
        a.addAction(UIAlertAction(title: "אישור", style: .cancel))
        show(a)
    }

    private func share(_ urls: [URL]) {
        show(UIActivityViewController(activityItems: urls, applicationActivities: nil))
    }

    // downloads the browser engine starts by itself (a file the page links to on its own site)
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dst = FileStore.destination(for: suggestedFilename)
        downloads[ObjectIdentifier(download)] = dst
        completionHandler(dst)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let u = downloads.removeValue(forKey: ObjectIdentifier(download)) { saved(u) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let u = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: u) }
        if selftest { return }
        let a = UIAlertController(title: "ההורדה נכשלה", message: error.localizedDescription, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "אישור", style: .cancel))
        show(a)
    }

    // ------------------------------------------------------------------ files: the app's own browser
    func showFiles() {
        pick = .browse
        let p = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: false)
        p.directoryURL = FileStore.docs
        p.allowsMultipleSelection = true
        p.delegate = self
        show(p)
    }

    func importFiles() {
        pick = .importing
        let p = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: true)
        p.allowsMultipleSelection = true
        p.delegate = self
        show(p)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if urls.isEmpty { return }
        if pick == .importing { filesImported(FileStore.importFiles(urls)) } else { share(urls) }
    }

    func filesImported(_ urls: [URL]) {
        guard isViewLoaded, !selftest else { return }
        let a = UIAlertController(
            title: urls.isEmpty ? "הייבוא נכשל" : "יובאו \(urls.count) קבצים",
            message: urls.isEmpty ? "לא ניתן היה להעתיק את הקובץ." :
                "הקבצים נמצאים ב: קבצים › BN Stream › Imports.\nכדי להשתמש בהם (שחזור גיבוי, כתוביות, רשימת ערוצים) בחרו אותם מתוך המסך המתאים באפליקציה.",
            preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "אישור", style: .cancel))
        show(a)
    }

    func scanPair() {
        let s = QRScannerController()
        s.onCode = { [weak self] code in
            guard let self = self else { return }
            if !self.handleIncoming(code) { self.note("הקוד שנסרק אינו קישור של BN Stream או של טלגרם.") }
        }
        let nav = UINavigationController(rootViewController: s)
        nav.overrideUserInterfaceStyle = .dark
        show(nav)
    }

    private func pasteLink() {
        if let s = UIPasteboard.general.string, handleIncoming(s) { return }
        note("בלוח אין קישור צימוד של BN Stream או קישור t.me.")
    }

    private func note(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "אישור", style: .cancel))
        show(a)
    }

    // ------------------------------------------------------------------ the small floating menu button
    private func setUpMenuButton() {
        let b = menuButton
        b.setImage(UIImage(systemName: "ellipsis"), for: .normal)
        b.tintColor = .white
        b.backgroundColor = UIColor(white: 0.1, alpha: 0.62)
        b.layer.cornerRadius = 19
        b.layer.borderWidth = 1
        b.layer.borderColor = UIColor(white: 1, alpha: 0.18).cgColor
        b.alpha = 0.7
        b.accessibilityLabel = "תפריט האפליקציה"
        b.showsMenuAsPrimaryAction = true
        func item(_ title: String, _ icon: String, _ run: @escaping () -> Void) -> UIAction {
            UIAction(title: title, image: UIImage(systemName: icon)) { _ in run() }
        }
        b.menu = UIMenu(title: "BN Stream", children: [
            item("קבצי האפליקציה", "folder") { [weak self] in self?.showFiles() },
            item("ייבוא קבצים לאפליקציה", "square.and.arrow.down") { [weak self] in self?.importFiles() },
            item("סריקת קוד צימוד (QR)", "qrcode.viewfinder") { [weak self] in self?.scanPair() },
            item("הדבקת קישור (צימוד / t.me)", "doc.on.clipboard") { [weak self] in self?.pasteLink() },
            item("רענון", "arrow.clockwise") { [weak self] in
                guard let self = self else { return }
                if self.mode == .local || self.webView.url == nil { self.loadSite() } else { self.webView.reload() }
            },
            item("החזרת הכפתור לפינה התחתונה", "arrow.down.left") { [weak self] in
                UserDefaults.standard.removeObject(forKey: "menuPosX")
                UserDefaults.standard.removeObject(forKey: "menuPosY")
                self?.view.setNeedsLayout()
            },
            item("הסתרת הכפתור עד ההפעלה הבאה", "eye.slash") { [weak self] in self?.menuButton.isHidden = true }
        ])
        b.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragMenu(_:))))
        b.isHidden = selftest && ProcessInfo.processInfo.arguments.contains("-noMenuButton")
        view.addSubview(b)
    }

    // Where the button may sit. Its home is the bottom corner, inside the strip under the page's tab bar (beside the
    // home indicator), where the page draws nothing - so it never covers content. It can be dragged anywhere.
    private let menuSize: CGFloat = 32
    private func menuBounds() -> (minX: CGFloat, maxX: CGFloat, minY: CGFloat, maxY: CGFloat) {
        let safe = view.safeAreaInsets, size = menuSize
        let minX = safe.left + 8, maxX = max(minX + 1, view.bounds.width - safe.right - size - 8)
        let minY = safe.top + 6
        // with a home indicator (bottom inset of 20 or more) the button goes into that strip; else just above the edge
        let bottomGap: CGFloat = safe.bottom >= 20 ? max(1, (safe.bottom - size) / 2) : 6
        let maxY = max(minY + 1, view.bounds.height - size - bottomGap)
        return (minX, maxX, minY, maxY)
    }

    private func placeMenuButton() {
        let d = UserDefaults.standard, r = menuBounds()
        // "menuPosX/Y" (not the keys of builds 1-5, whose default was the middle of the side edge)
        let fx = d.object(forKey: "menuPosX") as? Double ?? 0.0, fy = d.object(forKey: "menuPosY") as? Double ?? 1.0
        menuButton.frame = CGRect(x: r.minX + CGFloat(fx) * (r.maxX - r.minX), y: r.minY + CGFloat(fy) * (r.maxY - r.minY),
                                  width: menuSize, height: menuSize)
        menuButton.layer.cornerRadius = menuSize / 2
    }

    @objc private func dragMenu(_ g: UIPanGestureRecognizer) {
        let r = menuBounds()
        let t = g.translation(in: view)
        g.setTranslation(.zero, in: view)
        var f = menuButton.frame
        f.origin.x = min(max(f.origin.x + t.x, r.minX), r.maxX)
        f.origin.y = min(max(f.origin.y + t.y, r.minY), r.maxY)
        menuButton.frame = f
        if g.state == .ended || g.state == .cancelled {
            let fx = f.midX < view.bounds.midX ? 0.0 : 1.0               // rests on the nearer side edge
            UserDefaults.standard.set(fx, forKey: "menuPosX")
            UserDefaults.standard.set(Double((f.origin.y - r.minY) / (r.maxY - r.minY)), forKey: "menuPosY")
            UIView.animate(withDuration: 0.2) { self.placeMenuButton() }
        }
    }

    // ------------------------------------------------------------------ Telegram sign-in on this device, keyboard
    private func setUpTgButton() {
        let b = tgButton
        b.setTitle("אישור ההתחברות באפליקציית טלגרם", for: .normal)
        b.setImage(UIImage(systemName: "paperplane.fill"), for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.7
        b.tintColor = .white
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = UIColor(red: 0.16, green: 0.58, blue: 0.87, alpha: 1)
        b.layer.cornerRadius = 14
        b.imageEdgeInsets = UIEdgeInsets(top: 0, left: -6, bottom: 0, right: 6)
        b.isHidden = true
        b.addTarget(self, action: #selector(confirmInTelegram), for: .touchUpInside)
        view.addSubview(b)
    }

    // shown only while the page shows a sign-in QR and the Telegram app is installed
    private func updateTgButton() {
        let installed = URL(string: "tg://").map { UIApplication.shared.canOpenURL($0) } ?? false
        tgButton.isHidden = !(tgLogin != nil && !keyboardUp && installed)
    }

    @objc private func confirmInTelegram() {
        guard let u = tgLogin else { return }
        UIApplication.shared.open(u, options: [:], completionHandler: nil)
    }

    // while typing: no floating button over a field, and no accidental pull-to-refresh that would wipe a half-typed code
    @objc private func keyboardChanged(_ n: Notification) {
        keyboardUp = n.name == UIResponder.keyboardWillShowNotification
        menuButton.alpha = keyboardUp ? 0 : 0.7
        menuButton.isUserInteractionEnabled = !keyboardUp
        webView.scrollView.refreshControl?.isEnabled = !keyboardUp
        webView.scrollView.alwaysBounceVertical = !keyboardUp
        updateTgButton()
    }

    private func setUpOfflineBar() {
        let b = offlineBar
        b.setTitle("אין חיבור: מוצג העותק המובנה באפליקציה. הקישו לניסיון חוזר", for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 13, weight: .medium)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.6
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = UIColor(red: 0.55, green: 0.25, blue: 0.05, alpha: 0.96)
        b.isHidden = true
        b.addTarget(self, action: #selector(retryLive), for: .touchUpInside)
        view.addSubview(b)
    }

    @objc private func retryLive() {
        if !forceOffline { loadSite() }
    }

    // ------------------------------------------------------------------ self-test (simulator run in the workflow)
    // Launched with "-selftest": waits for the page, asks it what works, tries one export, and writes the answers to
    // Documents/selftest-<mode>.json, which the workflow reads from the simulator's app container.
    private func runSelftest() {
        let js = """
        const out = {href: location.href, ua: navigator.userAgent, w: innerWidth, h: innerHeight, title: document.title};
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 40 && !self.TN; i++) await wait(250);
        await wait(3000);
        out.tn = !!self.TN; out.ver = self.WEB_VERSION || ''; out.shell = document.documentElement.dataset.shell || '';
        out.input = document.documentElement.dataset.input || '';
        out.standalone = navigator.standalone === true; out.native = !!window.TeleNovaNative;
        out.secure = self.isSecureContext === true; out.swApi = 'serviceWorker' in navigator;
        out.fullscreenApi = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
        out.mse = !!(self.MediaSource || self.ManagedMediaSource); out.hls = !!self.Hls;
        out.oldBrowserPanel = !!(document.getElementById('oldbrowser') && !document.getElementById('oldbrowser').hidden);
        out.text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160);
        if (out.swApi) {
          try {
            const reg = await Promise.race([navigator.serviceWorker.ready, wait(20000).then(() => null)]);
            out.swReady = !!reg; out.swState = reg && reg.active ? reg.active.state : '';
            for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await wait(250);
            out.swControls = !!navigator.serviceWorker.controller;
            const r = await fetch('tgstream/selftest_key_0001', {headers: {Range: 'bytes=0-1'}});
            out.tgstreamStatus = r.status;
            out.cacheNames = await caches.keys();
          } catch (e) { out.swError = String(e); }
        }
        try {
          out.idb = await new Promise((res, rej) => {
            const q = indexedDB.open('tn_selftest', 1);
            q.onupgradeneeded = () => q.result.createObjectStore('s');
            q.onsuccess = () => { q.result.close(); res(true); };
            q.onerror = () => rej(q.error);
          });
        } catch (e) { out.idbError = String(e); }
        try { localStorage.setItem('tn_selftest', '1'); out.ls = localStorage.getItem('tn_selftest') === '1'; } catch (e) { out.lsError = String(e); }
        try {
          const H = 'https://helper.telenova.invalid';
          out.helperSetting = self.TN && self.TN.settings ? self.TN.settings.helper() : '';
          out.helperPing = await (await fetch(H + '/ping')).json();
          const rt = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://api.real-debrid.com/rest/1.0/time'}});
          out.helperRelay = {status: rt.status, text: (await rt.text()).slice(0, 40)};
          const rf = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://example.com/'}});
          out.helperRefused = {status: rf.status, body: await rf.json()};
          const ry = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://www.youtube.com/watch'}});
          out.helperPathRule = ry.status;
          if (self.TN && self.TN.loadScript) {
            await self.TN.loadScript('helper.js');
            out.tnHelperHas = self.TNHelper.has();
            const rh = await self.TNHelper.fetch('https://api.real-debrid.com/rest/1.0/time');
            out.tnHelperFetch = rh.status;
          }
          const rd = await fetch(H + '/p', {headers: {'X-TN-Target': 'https://api.real-debrid.com/oauth/v2/device/code?client_id=X245A4XAIBGVM&new_credentials=yes'}});
          const rj = await rd.json().catch(() => ({}));
          out.rdDeviceCode = {status: rd.status, hasDeviceCode: !!rj.device_code, hasUserCode: !!rj.user_code};
        } catch (e) { out.helperError = String(e); }
        out.tgShims = typeof self.dropPending === 'function' && typeof self.setFlood === 'function';
        try { self.dropPending(); self.setFlood(0); out.tgShimsRun = true; } catch (e) { out.tgShimsRun = String(e); }
        try {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob(['selftest export ok'], {type: 'application/zip'}));
          a.download = 'selftest-backup.zip';
          a.click();
          const big = new Uint8Array(2 * 1024 * 1024 + 5); big[big.length - 1] = 7;
          const r = await window.TeleNovaNative.save(new Blob([big]), 'selftest-big.srt');
          out.bigSave = r;
          await window.TeleNovaNative.save(new Blob(['first full backup, longer text']), 'BN_Stream_backup.tncfg');
          out.oneBackup = await window.TeleNovaNative.save(new Blob(['second']), 'BN_Stream_backup.tncfg');
          await wait(1500);
        } catch (e) { out.exportError = String(e); }
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { [weak self] result in
            var out: [String: Any] = [:]
            switch result {
            case .success(let v):
                if let s = v as? String, let d = s.data(using: .utf8),
                   let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { out = o } else { out["raw"] = "\(v)" }
            case .failure(let e):
                out["jsError"] = "\(e)"
            }
            self?.writeSelftest(out)
        }
    }

    private func writeSelftest(_ page: [String: Any]) {
        var out = page
        out["mode"] = mode == .live ? "live" : "local"
        out["files"] = FileStore.listing()
        let big = FileStore.docs.appendingPathComponent("Subtitles/selftest-big.srt")
        out["bigSize"] = ((try? FileManager.default.attributesOfItem(atPath: big.path))?[.size] as? NSNumber)?.intValue ?? -1
        let backups = FileStore.listing().filter { $0.hasPrefix("Backups/BN_Stream_backup") }
        let one = FileStore.docs.appendingPathComponent("Backups/BN_Stream_backup.tncfg")
        out["oneBackupFiles"] = backups
        out["oneBackupSize"] = ((try? FileManager.default.attributesOfItem(atPath: one.path))?[.size] as? NSNumber)?.intValue ?? -1
        out["safeArea"] = ["top": view.safeAreaInsets.top, "bottom": view.safeAreaInsets.bottom]
        out["bundleWebIndex"] = LocalServer.shared.hasFiles
        out["appVersion"] = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let name = "selftest-" + (forceOffline ? "local" : "live") + ".json"
        if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: FileStore.docs.appendingPathComponent(name))
        }
    }
}
