import UIKit
import AVFoundation

// Reads one QR code with the camera (the pairing code the Kodi build shows: <site>/web/#pair=...).
final class QRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var done = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        title = "סריקת קוד צימוד"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(close))
        guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam),
              session.canAddInput(input) else {
            let l = UILabel()
            l.text = "אין מצלמה זמינה, או שלא ניתנה הרשאת מצלמה (הגדרות > TeleNova)."
            l.textColor = .white
            l.numberOfLines = 0
            l.textAlignment = .center
            l.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(l)
            NSLayoutConstraint.activate([
                l.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                l.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
                l.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)])
            return
        }
        session.addInput(input)
        let out = AVCaptureMetadataOutput()
        guard session.canAddOutput(out) else { return }
        session.addOutput(out)
        out.setMetadataObjectsDelegate(self, queue: .main)
        if out.availableMetadataObjectTypes.contains(.qr) { out.metadataObjectTypes = [.qr] }
        let p = AVCaptureVideoPreviewLayer(session: session)
        p.videoGravity = .resizeAspectFill
        p.frame = view.bounds
        view.layer.addSublayer(p)
        preview = p
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !session.inputs.isEmpty && !session.isRunning {
            let s = session
            DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    @objc private func close() { dismiss(animated: true) }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !done, let o = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let s = o.stringValue, !s.isEmpty else { return }
        done = true
        session.stopRunning()
        dismiss(animated: true) { [onCode] in onCode?(s) }
    }
}
