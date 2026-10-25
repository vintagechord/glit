import AppKit
let destination = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let scale = CGFloat(size) / 1024
    let transform = NSAffineTransform(); transform.scale(by: scale); transform.concat()
    NSColor(red: 0.10, green: 0.20, blue: 0.17, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 62, y: 62, width: 900, height: 900), xRadius: 210, yRadius: 210).fill()
    NSColor(red: 0.85, green: 0.97, blue: 0.52, alpha: 1).setStroke()
    let border = NSBezierPath(roundedRect: NSRect(x: 235, y: 215, width: 555, height: 595), xRadius: 150, yRadius: 150)
    border.lineWidth = 22; border.stroke()
    let text = "O" as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 440, weight: .black), .foregroundColor: NSColor(red: 0.85, green: 0.97, blue: 0.52, alpha: 1)]
    let bounds = text.size(withAttributes: attributes)
    text.draw(at: NSPoint(x: (1024-bounds.width)/2, y: (1024-bounds.height)/2+10), withAttributes: attributes)
    image.unlockFocus()
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    let data = bitmap.representation(using: .png, properties: [:])!
    let names: [String]
    switch size { case 16: names = ["icon_16x16.png"]; case 32: names = ["icon_16x16@2x.png", "icon_32x32.png"]; case 64: names = ["icon_32x32@2x.png"]; case 128: names = ["icon_128x128.png"]; case 256: names = ["icon_128x128@2x.png", "icon_256x256.png"]; case 512: names = ["icon_256x256@2x.png", "icon_512x512.png"]; default: names = ["icon_512x512@2x.png"] }
    for name in names { try data.write(to: URL(fileURLWithPath: destination).appendingPathComponent(name)) }
}
