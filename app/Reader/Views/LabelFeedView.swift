import SwiftUI

struct LabelFeedView: View {
    let label: LabelDTO
    @Environment(AppModel.self) private var model
    @State private var items: [FeedItemDTO] = []
    @State private var kind = "all"
    @State private var loading = false
    @State private var loadedOnce = false

    private let kinds = [("all", "All"), ("hn", "HN"), ("reddit", "Reddit"), ("blogs", "Blogs")]
    private var unreadCount: Int { items.filter { !$0.read }.count }

    var body: some View {
        VStack(spacing: 0) {
            // Fixed filter chips (do not scroll with the feed).
            Picker("Filter", selection: $kind) {
                ForEach(kinds, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 4)
            .padding(.bottom, 8)

            List(items) { item in
                NavigationLink(value: item) { FeedRow(item: item) }
                    .swipeActions(edge: .leading) {
                        Button(item.read ? "Unread" : "Read") {
                            Task { await model.setRead(id: item.id, !item.read); await load() }
                        }.tint(.blue)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(item.bookmarked ? "Unsave" : "Save") {
                            Task { await model.setBookmark(id: item.id, !item.bookmarked); await load() }
                        }.tint(.orange)
                    }
            }
            .listStyle(.plain)
            .refreshable { await load() }
            .overlay {
                if loading && items.isEmpty {
                    ProgressView().allowsHitTesting(false)
                } else if items.isEmpty {
                    ContentUnavailableView("No items", systemImage: "tray").allowsHitTesting(false)
                }
            }
        }
        .navigationTitle(label.name)
        .navigationSubtitle("\(unreadCount) unread")
        .navigationDestination(for: FeedItemDTO.self) { item in
            ReaderView(itemId: item.id, preview: item)
        }
        .onAppear {
            guard !loadedOnce else { return } // don't reset scroll when returning from the reader
            loadedOnce = true
            Task { await load() }
        }
        .onChange(of: kind) { Task { await load() } }
        .safeAreaInset(edge: .bottom) {
            HStack {
                Label(Format.syncedAgo(model.lastSynced), systemImage: "arrow.clockwise")
                Spacer()
                Text("Sort: score ↓")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.bar)
        }
    }

    private func load() async {
        loading = true
        items = await model.feed(labelId: label.id, kind: kind)
        loading = false
    }
}

struct FeedRow: View {
    let item: FeedItemDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.title)
                .font(.callout)
                .fontWeight(.medium)
                .foregroundStyle(item.read ? .secondary : .primary)
                .lineLimit(3)
            Text(Format.meta(sourceTitle: item.source_title, kind: item.source_kind,
                             points: item.points, comments: item.comments, publishedMs: item.published_at)
                 + (item.read ? " · read" : ""))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
