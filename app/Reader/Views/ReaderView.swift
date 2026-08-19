import SwiftUI

struct ReaderView: View {
    let itemId: String
    let preview: FeedItemDTO
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var detail: ItemDetailDTO?
    @State private var bookmarked: Bool
    @State private var read: Bool

    init(itemId: String, preview: FeedItemDTO) {
        self.itemId = itemId
        self.preview = preview
        _bookmarked = State(initialValue: preview.bookmarked)
        _read = State(initialValue: preview.read)
    }

    private var url: URL? { URL(string: preview.url) }

    private var byline: String {
        var parts: [String] = []
        if let a = preview.author { parts.append(a) }
        if let p = preview.points {
            parts.append(preview.source_kind == "reddit" ? "\(Format.compact(p)) upvotes" : "\(Format.compact(p)) pts")
        }
        if let labelName = firstLabelName { parts.append("label: \(labelName)") }
        return parts.joined(separator: " · ")
    }

    private var firstLabelName: String? {
        guard let id = detail?.label_ids.first else { return nil }
        return model.labels.first(where: { $0.id == id })?.name ?? id
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(preview.title).font(.title3).fontWeight(.semibold)
                Text(byline).font(.caption).foregroundStyle(.secondary)

                if let body = detail?.body_text, !body.isEmpty {
                    Text(body).font(.callout).lineSpacing(4).textSelection(.enabled)
                } else {
                    Text(detail == nil ? "Loading…" : "No extracted text — open the original to read.")
                        .font(.callout).foregroundStyle(.secondary)
                }

                if let url {
                    Button {
                        openURL(url)
                    } label: {
                        HStack {
                            Spacer()
                            Text("Open original")
                            Image(systemName: "arrow.up.right.square")
                            Spacer()
                        }
                        .padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.4)))
                    }
                    .padding(.top, 6)
                }
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("\(preview.source_title) · \(Format.age(fromMs: preview.published_at)) ago")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button { toggleBookmark() } label: {
                    Image(systemName: bookmarked ? "bookmark.fill" : "bookmark")
                }
                Spacer()
                Button { toggleRead() } label: {
                    Image(systemName: read ? "checkmark.circle.fill" : "checkmark.circle")
                }
                Spacer()
                if let url {
                    ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                }
            }
        }
        .task {
            detail = await model.item(id: itemId)
            if !read { await model.setRead(id: itemId, true); read = true }
        }
    }

    private func toggleBookmark() {
        bookmarked.toggle()
        Task { await model.setBookmark(id: itemId, bookmarked) }
    }

    private func toggleRead() {
        read.toggle()
        Task { await model.setRead(id: itemId, read) }
    }
}
