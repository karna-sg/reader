// Renders the Reader app icon (1024×1024 PNG) with CoreGraphics — an indigo
// gradient with a white "reading-list card" motif that echoes the app UI.
// Run: swift tools/make-icon.swift <output.png>
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_1024.png"
let S = 1024
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0,
                          space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("no context")
}

func color(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> CGColor {
    CGColor(colorSpace: cs, components: [r, g, b, a])!
}
func rounded(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

// Background: indigo gradient (top → bottom), matching the wireframe accent.
let grad = CGGradient(colorsSpace: cs,
                      colors: [color(0.35, 0.29, 0.74), color(0.18, 0.15, 0.44)] as CFArray,
                      locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: S), end: CGPoint(x: 0, y: 0), options: [])

// White card (the "article list").
let inset: CGFloat = 208
let card = CGRect(x: inset, y: inset, width: CGFloat(S) - 2 * inset, height: CGFloat(S) - 2 * inset)
ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 42, color: color(0, 0, 0, 0.28))
ctx.addPath(rounded(card, 104))
ctx.setFillColor(color(1, 1, 1))
ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)

// Indigo "text rows" of decreasing width.
let bar = color(0.24, 0.20, 0.54)
let barH: CGFloat = 48
let x = card.minX + 74
let widths: [CGFloat] = [card.width - 148, card.width - 148, (card.width - 148) * 0.6, card.width - 148]
var y = card.maxY - 168
for w in widths {
    ctx.addPath(rounded(CGRect(x: x, y: y, width: w, height: barH), barH / 2))
    ctx.setFillColor(bar)
    ctx.fillPath()
    y -= 96
}

// Gold "unread" badge dot (top-right of the card).
ctx.setFillColor(color(0.93, 0.66, 0.26))
ctx.fillEllipse(in: CGRect(x: card.maxX - 150, y: card.maxY - 150, width: 76, height: 76))

// Write PNG.
guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                 UTType.png.identifier as CFString, 1, nil) else {
    fatalError("no image/dest")
}
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(outPath)")
