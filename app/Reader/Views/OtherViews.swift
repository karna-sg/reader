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

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var baseURL = AppConfig.baseURL
    @State private var token = AppConfig.token
    @State private var health: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Bearer token (optional)", text: $token)
                }
                Section {
                    Button("Test connection") { Task { await testHealth() } }
                    if let health { Text(health).font(.caption).foregroundStyle(.secondary) }
                }
                Section {
                    Text("The server owns fetching and freshness. This app is a reader that talks to it over your local network or a small VPS.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        AppConfig.baseURL = baseURL.trimmingCharacters(in: .whitespaces)
                        AppConfig.token = token.trimmingCharacters(in: .whitespaces)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func testHealth() async {
        let client = APIClient(baseURL: baseURL.trimmingCharacters(in: .whitespaces),
                               token: token.trimmingCharacters(in: .whitespaces))
        do {
            let h = try await client.health()
            health = "OK — \(h.sources) sources, \(h.items) items"
        } catch {
            health = "Failed: \(error.localizedDescription)"
        }
    }
}
