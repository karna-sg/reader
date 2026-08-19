import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Labels", systemImage: "tag") {
                LabelsListView()
            }
            Tab("Bookmarks", systemImage: "bookmark") {
                BookmarksView()
            }
            Tab("Search", systemImage: "magnifyingglass") {
                SearchView()
            }
        }
    }
}

struct LabelsListView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var showAddLabel = false
    @State private var newLabelName = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.labels) { label in
                        NavigationLink(value: label) {
                            LabelRow(label: label)
                        }
                    }
                }
                Button {
                    showAddLabel = true
                } label: {
                    Label("Add label", systemImage: "plus")
                        .font(.subheadline)
                }
            }
            .navigationTitle("Reader")
            .navigationDestination(for: LabelDTO.self) { label in
                LabelFeedView(label: label)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .refreshable { await model.refreshLabels() }
            .overlay {
                if model.labels.isEmpty {
                    ContentUnavailableView(
                        "No labels yet",
                        systemImage: "tray",
                        description: Text(model.loadError.map { "Can't reach the server: \($0)" }
                            ?? "Pull to refresh once the server is running.")
                    )
                    .allowsHitTesting(false)
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .alert("Add label", isPresented: $showAddLabel) {
                TextField("Name", text: $newLabelName)
                Button("Cancel", role: .cancel) { newLabelName = "" }
                Button("Add") {
                    let name = newLabelName.trimmingCharacters(in: .whitespaces)
                    newLabelName = ""
                    guard !name.isEmpty else { return }
                    Task { await model.addLabel(name: name) }
                }
            }
        }
    }
}

struct LabelRow: View {
    let label: LabelDTO

    private var subtitle: String {
        let sources = "\(label.source_count) source\(label.source_count == 1 ? "" : "s")"
        return label.source_summary.isEmpty ? sources
            : "\(sources) · \(label.source_summary.joined(separator: ", "))"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label.name).font(.subheadline).fontWeight(.medium)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(label.unread)")
                .font(.caption2)
                .monospacedDigit()
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(label.unread > 0 ? Color.accentColor.opacity(0.16) : Color.clear)
                .foregroundStyle(label.unread > 0 ? Color.accentColor : Color.secondary)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(Color.secondary.opacity(label.unread > 0 ? 0 : 0.3), lineWidth: 0.5)
                )
        }
        .padding(.vertical, 2)
    }
}
