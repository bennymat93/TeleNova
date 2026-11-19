import Cocoa

// BN Stream for Mac: one window with a WKWebView around the web version (see MacWebController.swift).
// Shares HelperRelay.swift and LocalServer.swift with the iOS app (ios-app/Sources).
@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: MacWebController!

    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        web = MacWebController()
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                         backing: .buffered, defer: false)
        w.title = "BN Stream"
        w.titlebarAppearsTransparent = true
        w.backgroundColor = MacWebController.background
        w.appearance = NSAppearance(named: .darkAqua)
        w.minSize = NSSize(width: 720, height: 520)
        w.collectionBehavior.insert(.fullScreenPrimary)
        w.contentViewController = web
        w.delegate = self
        w.center()
        w.setFrameAutosaveName("BNStreamMain")                 // the size and place are remembered between launches
        if web.selftest { w.setFrame(NSRect(x: 40, y: 40, width: 1280, height: 820), display: true) }
        w.makeKeyAndOrderFront(nil)
        window = w
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // telenova:// and bnstream:// links (pairing, "move the setup to this device", the Google sign-in answer)
    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { web?.handleIncoming(u.absoluteString) }
    }

    // ------------------------------------------------------------------ menu
    private func item(_ title: String, _ sel: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        i.keyEquivalentModifierMask = mods
        if let t = target { i.target = t }
        return i
    }

    private func buildMenu() {
        let main = NSMenu()
        func top(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            let holder = NSMenuItem()
            holder.submenu = m
            main.addItem(holder)
        }
        top("BN Stream", [
            item("About BN Stream", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("Hide BN Stream", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:)), ""),
            .separator(),
            item("Quit BN Stream", #selector(NSApplication.terminate(_:)), "q")
        ])
        top("File", [
            item("Close Window", #selector(NSWindow.performClose(_:)), "w")
        ])
        top("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a")
        ])
        top("View", [
            item("Reload", #selector(MacWebController.reloadPage(_:)), "r"),
            item("Back", #selector(MacWebController.goBack(_:)), "["),
            item("Forward", #selector(MacWebController.goForward(_:)), "]"),
            item("Home", #selector(MacWebController.goHome(_:)), "h", [.command, .shift]),
            item("Search", #selector(MacWebController.openSearch(_:)), "f"),
            .separator(),
            item("Actual Size", #selector(MacWebController.zoomReset(_:)), "0"),
            item("Zoom In", #selector(MacWebController.zoomIn(_:)), "="),
            item("Zoom Out", #selector(MacWebController.zoomOut(_:)), "-"),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        ])
        let win = [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
                   item("Zoom", #selector(NSWindow.performZoom(_:)), "")]
        top("Window", win)
        NSApp.mainMenu = main
        NSApp.windowsMenu = main.items.last?.submenu
    }
}
