import SwiftUI

// Deterministic entry points for screenshots/UI testing. Launch with:
//   -screen feed:<labelId>   → open a label's feed
//   -screen reader:<itemId>  → open the reader for an item
// With no such argument it returns the normal RootView.
enum ScreenshotHarness {
    @ViewBuilder
    static func rootView() -> some View {
        if let target = parse() {
            switch target {
            case .feed(let labelId, let name):
                NavigationStack {
                    LabelFeedView(label: LabelDTO(id: labelId, name: name, unread: 0, total: 0,
                                                  source_count: 0, source_summary: []))
                }
            case .reader(let itemId):
                NavigationStack {
                    ReaderHarnessView(itemId: itemId)
                }
            }
        } else {
            RootView()
        }
    }

    private enum Target {
        case feed(String, String)
        case reader(String)
    }

    private static func parse() -> Target? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: "-screen"), idx + 1 < args.count else { return nil }
        let spec = args[idx + 1]
        if spec.hasPrefix("feed:") {
            let id = String(spec.dropFirst("feed:".count))
            return .feed(id, prettyName(id))
        }
        if spec.hasPrefix("reader:") {
            return .reader(String(spec.dropFirst("reader:".count)))
        }
        return nil
    }

    private static func prettyName(_ id: String) -> String {
        switch id {
        case "ai-ml": return "AI / ML"
        default: return id.prefix(1).uppercased() + id.dropFirst()
        }
    }
}

// Loads an item detail then shows the ReaderView with a preview built from it.
private struct ReaderHarnessView: View {
    let itemId: String
    @Environment(AppModel.self) private var model
    @State private var preview: FeedItemDTO?

    var body: some View {
        Group {
            if let preview {
                ReaderView(itemId: itemId, preview: preview)
            } else {
                ProgressView().task { await load() }
            }
        }
    }

    private func load() async {
        if let d = await model.item(id: itemId) {
            preview = FeedItemDTO(id: d.id, title: d.title, url: d.url, source_id: d.source_id,
                                  source_kind: d.source_kind, source_title: d.source_title, author: d.author,
                                  published_at: d.published_at, fetched_at: nil, body_tier: d.body_tier,
                                  points: d.points, comments: d.comments, read: d.read,
                                  bookmarked: d.bookmarked, score: nil)
        }
    }
}
