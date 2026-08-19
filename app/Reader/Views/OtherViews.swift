import SwiftUI

// Shared row used by search + bookmarks results.
private struct ResultRow: View {
    let item: FeedItemDTO
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.title).font(.callout).fontWeight(.medium).lineLimit(3)
            Text(Format.meta(sourceTitle: item.source_title, kind: item.source_kind,
                             points: item.points, comments: item.comments, publishedMs: item.published_at))
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results: [FeedItemDTO] = []
    @State private var searched = false

    var body: some View {
        NavigationStack {
            List(results) { item in
                NavigationLink(value: item) { ResultRow(item: item) }
            }
            .listStyle(.plain)
            .navigationTitle("Search")
            .navigationDestination(for: FeedItemDTO.self) { item in
                ReaderView(itemId: item.id, preview: item)
            }
            .searchable(text: $query, prompt: "Search knowledge base")
            .onSubmit(of: .search) { Task { await run() } }
            .overlay {
                if searched && results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else if !searched {
                    ContentUnavailableView("Search the knowledge base", systemImage: "magnifyingglass")
                }
            }
        }
    }

    private func run() async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        results = await model.search(query)
        searched = true
    }
}

struct BookmarksView: View {
    @Environment(AppModel.self) private var model
    @State private var items: [FeedItemDTO] = []

    var body: some View {
        NavigationStack {
            List(items) { item in
                NavigationLink(value: item) { ResultRow(item: item) }
            }
            .listStyle(.plain)
            .navigationTitle("Bookmarks")
            .navigationDestination(for: FeedItemDTO.self) { item in
                ReaderView(itemId: item.id, preview: item)
            }
            .task { items = await model.bookmarks() }
            .refreshable { items = await model.bookmarks() }
            .overlay {
                if items.isEmpty {
                    ContentUnavailableView("No bookmarks", systemImage: "bookmark")
                }
            }
        }
    }
}

// SettingsView, SourcesView and AddSourceView live in AdminViews.swift.
