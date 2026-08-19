import SwiftUI

// Settings: connect to the server, configure integrations (Reddit / Claude Haiku)
// live over the API — no .env edit or restart — and manage sources. Secrets are
// write-only: the server returns only "configured" booleans, never the values.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    @State private var baseURL = AppConfig.baseURL
    @State private var token = AppConfig.token
    @State private var settings: ServerSettingsDTO?
    @State private var status: String?
    @State private var busy = false

    // Integration edit fields (blank = leave unchanged).
    @State private var redditID = ""
    @State private var redditSecret = ""
    @State private var redditUA = ""
    @State private var anthropicKey = ""
    @State private var tagModel = "claude-haiku-4-5"
    @State private var tagEnabled = false

    private var connected: Bool { settings != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Base URL (https://your-server or http://ip:8787)", text: $baseURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Access token (READER_TOKEN)", text: $token)
                    Button(busy ? "Connecting…" : "Save & connect") { Task { await connect() } }
                        .disabled(busy)
                    if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
                } header: { Text("Server") } footer: {
                    Text(connected
                        ? "Connected. Configure integrations and sources below."
                        : "Enter your server URL + token and tap Save & connect. The sections below configure the server live — no restart.")
                }

                // Reddit
                Section {
                    if let s = settings {
                        Label(s.reddit_configured ? "Configured" : "Not configured",
                              systemImage: s.reddit_configured ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(s.reddit_configured ? .green : .secondary)
                            .font(.subheadline)
                    }
                    TextField("Client ID", text: $redditID)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Client secret", text: $redditSecret)
                    TextField("User agent (by /u/you)", text: $redditUA)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save Reddit") { Task { await saveReddit() } }.disabled(!connected)
                    if settings?.reddit_configured == true {
                        Button("Disconnect Reddit", role: .destructive) { Task { await clearReddit() } }
                    }
                } header: { Text("Reddit") } footer: {
                    Text("Anonymous Reddit is blocked. Create a \"script\" app at reddit.com/prefs/apps for free 100 req/min.")
                }

                // AI auto-tagging
                Section {
                    if let s = settings {
                        Label(s.anthropic_configured ? "Key set" : "No key",
                              systemImage: s.anthropic_configured ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(s.anthropic_configured ? .green : .secondary)
                            .font(.subheadline)
                    }
                    SecureField("Anthropic API key (sk-ant-…)", text: $anthropicKey)
                    TextField("Model", text: $tagModel)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Enable auto-tagging", isOn: $tagEnabled)
                    Button("Save") { Task { await saveAnthropic() } }.disabled(!connected)
                    if settings?.anthropic_configured == true {
                        Button("Remove key", role: .destructive) { Task { await clearAnthropic() } }
                    }
                } header: { Text("AI auto-tagging (Claude Haiku)") } footer: {
                    Text("Files items into extra labels using title + excerpt. Tiny cost. Get a key at console.anthropic.com.")
                }

                // Sources + actions
                Section("Sources") {
                    NavigationLink { SourcesView() } label: { Label("Manage sources", systemImage: "list.bullet") }
                        .disabled(!connected)
                }
                Section("Actions") {
                    Button { Task { await run { try await APIClient().triggerPoll() }; status = "Refresh started" } }
                        label: { Label("Refresh now", systemImage: "arrow.clockwise") }
                        .disabled(!connected)
                    Button { Task { await run { try await APIClient().triggerTag() }; status = "Tagging started" } }
                        label: { Label("Run tagging now", systemImage: "tag") }
                        .disabled(!(settings?.tag_llm_enabled ?? false))
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { if !baseURL.isEmpty { await loadSettings() } }
        }
    }

    private func connect() async {
        busy = true; defer { busy = false }
        AppConfig.baseURL = baseURL.trimmingCharacters(in: .whitespaces)
        AppConfig.token = token.trimmingCharacters(in: .whitespaces)
        do {
            let h = try await APIClient().health()
            status = "Connected — \(h.sources) sources, \(h.items) items"
            await loadSettings()
            await model.refreshLabels()
        } catch {
            status = "Failed: \(error.localizedDescription)"
        }
    }

    private func loadSettings() async {
        do {
            let s = try await APIClient().settings()
            settings = s
            redditUA = s.reddit_user_agent
            tagModel = s.tag_model
            tagEnabled = s.tag_llm_enabled
        } catch { /* not connected yet */ }
    }

    private func saveReddit() async {
        var patch: [String: Any] = ["reddit_user_agent": redditUA]
        if !redditID.isEmpty { patch["reddit_client_id"] = redditID }
        if !redditSecret.isEmpty { patch["reddit_client_secret"] = redditSecret }
        await run { settings = try await APIClient().saveSettings(patch) }
        redditSecret = ""
        status = "Reddit saved"
    }

    private func clearReddit() async {
        await run { settings = try await APIClient().saveSettings(["reddit_client_id": "", "reddit_client_secret": ""]) }
        redditID = ""; redditSecret = ""
    }

    private func saveAnthropic() async {
        var patch: [String: Any] = ["tag_llm_enabled": tagEnabled, "tag_model": tagModel]
        if !anthropicKey.isEmpty { patch["anthropic_api_key"] = anthropicKey }
        await run { settings = try await APIClient().saveSettings(patch) }
        anthropicKey = ""
        status = "AI settings saved"
    }

    private func clearAnthropic() async {
        await run { settings = try await APIClient().saveSettings(["anthropic_api_key": "", "tag_llm_enabled": false]) }
        anthropicKey = ""
    }

    private func run(_ op: () async throws -> Void) async {
        do { try await op() } catch { status = "Failed: \(error.localizedDescription)" }
    }
}

struct SourcesView: View {
    @Environment(AppModel.self) private var model
    @State private var sources: [SourceStatusDTO] = []
    @State private var showAdd = false

    var body: some View {
        List {
            ForEach(sources) { s in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title).font(.subheadline).foregroundStyle(s.enabled ? .primary : .secondary)
                        Text("\(s.kind) · \(s.item_count) items\(s.last_status != nil ? " · \(s.last_status!)" : "")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { s.enabled },
                        set: { newVal in Task { await toggle(s, newVal) } }
                    )).labelsHidden()
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { Task { await delete(s) } }
                }
            }
        }
        .navigationTitle("Sources (\(sources.count))")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showAdd = true } label: { Image(systemName: "plus") } } }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showAdd) { AddSourceView { Task { await load() } } }
    }

    private func load() async { sources = (try? await APIClient().sources()) ?? sources }
    private func toggle(_ s: SourceStatusDTO, _ enabled: Bool) async {
        try? await APIClient().toggleSource(id: s.id, enabled: enabled); await load()
    }
    private func delete(_ s: SourceStatusDTO) async {
        try? await APIClient().deleteSource(id: s.id); await load()
    }
}

struct AddSourceView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    var onAdded: () -> Void

    @State private var kind = "rss"
    @State private var title = ""
    @State private var value = ""
    @State private var fullText = "excerpt"
    @State private var selected: Set<String> = []
    @State private var error: String?

    private let kinds = ["rss", "reddit", "youtube", "arxiv", "github", "hackernews"]

    private var valueLabel: String {
        switch kind {
        case "reddit": return "Subreddit (e.g. SaaS)"
        case "youtube": return "Channel ID (UC…)"
        case "arxiv": return "Categories (cs.LG, cs.CL)"
        case "github": return "Atom URL (…/releases.atom)"
        case "hackernews": return "Search query (blank = front page)"
        default: return "Feed URL (https://…)"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $kind) { ForEach(kinds, id: \.self) { Text($0) } }
                    TextField("Title", text: $title)
                    TextField(valueLabel, text: $value)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if kind == "rss" {
                        Picker("Content", selection: $fullText) {
                            Text("Excerpt").tag("excerpt")
                            Text("Extract full text").tag("extract")
                        }
                    }
                }
                Section("Labels") {
                    ForEach(model.labels) { label in
                        Button {
                            if selected.contains(label.id) { selected.remove(label.id) } else { selected.insert(label.id) }
                        } label: {
                            HStack {
                                Text(label.name)
                                Spacer()
                                if selected.contains(label.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }.tint(.primary)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.caption) } }
            }
            .navigationTitle("Add source")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Add") { Task { await add() } } }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func config() -> [String: Any] {
        let v = value.trimmingCharacters(in: .whitespaces)
        switch kind {
        case "reddit": return ["subreddit": v, "listing": "top", "timeframe": "day", "limit": 40]
        case "youtube": return ["channel_id": v]
        case "arxiv": return ["categories": v.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }]
        case "github": return ["atom_url": v]
        case "hackernews":
            return v.isEmpty ? ["mode": "firebase-top", "limit": 30]
                             : ["mode": "algolia-search", "query": v, "min_points": 50, "limit": 40]
        default: return ["feed_url": v]
        }
    }

    private func add() async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { error = "Title is required"; return }
        do {
            try await APIClient().addSource(kind: kind, title: t, config: config(),
                                            fullText: kind == "rss" ? fullText : "excerpt",
                                            labelIds: Array(selected))
            onAdded()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
