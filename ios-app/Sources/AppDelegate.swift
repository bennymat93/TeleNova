import UIKit
import AVFoundation

// TeleNova for iPhone / iPad: one WKWebView around the web version (see WebViewController.swift).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var web: WebViewController? { window?.rootViewController as? WebViewController }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FileStore.prepare()
        // sound keeps playing with the silent switch on and when the app is in the background (UIBackgroundModes: audio)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = WebViewController.background
        w.overrideUserInterfaceStyle = .dark
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    // telenova://... links, and files sent to the app from another app ("Open in TeleNova" / share sheet)
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.isFileURL {
            let saved = FileStore.importFiles([url])
            web?.filesImported(saved)
            return !saved.isEmpty
        }
        return web?.handleIncoming(url.absoluteString) ?? false
    }

    // long press on the app icon
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            completionHandler(self?.web?.quickAction(shortcutItem.type) ?? false)
        }
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        web?.cameToForeground()
    }
}
