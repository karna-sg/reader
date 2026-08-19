import Foundation

enum APIError: Error, LocalizedError {
    case badURL
    case http(Int)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid server URL"
        case .http(let code): return "Server error (\(code))"
        case .decoding(let m): return "Decoding error: \(m)"
        }
    }
}

// Async URLSession client hitting the Reader backend. Bearer token from Keychain.
struct APIClient {
    var baseURL: String
    var token: String

    init(baseURL: String = AppConfig.baseURL, token: String = AppConfig.token) {
        self.baseURL = baseURL
        self.token = token
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: baseURL + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func run<T: Decodable>(_ req: URLRequest, as _: T.Type) async throws -> T {
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.http(http.statusCode)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding(error.localizedDescription) }
    }

    // ── reads ─────────────────────────────────────────────────────────────
    func health() async throws -> HealthResponse {
        try await run(request("/health"), as: HealthResponse.self)
    }

    func labels() async throws -> [LabelDTO] {
        try await run(request("/labels"), as: LabelsResponse.self).labels
    }

    func feed(labelId: String, kind: String, sort: String = "score", page: Int = 1) async throws -> FeedResponse {
        let p = "/labels/\(labelId)/items?kind=\(kind)&sort=\(sort)&page=\(page)&pageSize=100"
        return try await run(request(p), as: FeedResponse.self)
    }

    func item(id: String) async throws -> ItemDetailDTO {
        try await run(request("/items/\(id)"), as: ItemDetailDTO.self)
    }

    func bookmarks() async throws -> [FeedItemDTO] {
        try await run(request("/bookmarks"), as: ItemsResponse.self).items
    }

    func search(_ q: String) async throws -> [FeedItemDTO] {
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return try await run(request("/search?q=\(encoded)"), as: SearchResponse.self).items
    }

    // ── writes ────────────────────────────────────────────────────────────
    @discardableResult
    func setState(id: String, read: Bool? = nil, bookmarked: Bool? = nil) async throws -> Bool {
        var payload: [String: Bool] = [:]
        if let read { payload["read"] = read }
        if let bookmarked { payload["bookmarked"] = bookmarked }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let req = try request("/items/\(id)/state", method: "POST", body: body)
        _ = try await URLSession.shared.data(for: req)
        return true
    }

    func addLabel(name: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["name": name])
        _ = try await URLSession.shared.data(for: try request("/labels", method: "POST", body: body))
    }

    // ── settings ──────────────────────────────────────────────────────────
    func settings() async throws -> ServerSettingsDTO {
        try await run(request("/settings"), as: ServerSettingsDTO.self)
    }

    @discardableResult
    func saveSettings(_ patch: [String: Any]) async throws -> ServerSettingsDTO {
        let body = try JSONSerialization.data(withJSONObject: patch)
        return try await run(request("/settings", method: "POST", body: body), as: ServerSettingsDTO.self)
    }

    // ── source management ─────────────────────────────────────────────────
    func sources() async throws -> [SourceStatusDTO] {
        try await run(request("/sources"), as: SourcesResponse.self).sources
    }

    func toggleSource(id: String, enabled: Bool) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["enabled": enabled])
        _ = try await URLSession.shared.data(for: try request("/sources/\(id)/toggle", method: "POST", body: body))
    }

    func deleteSource(id: String) async throws {
        _ = try await URLSession.shared.data(for: try request("/sources/\(id)", method: "DELETE"))
    }

    func addSource(kind: String, title: String, config: [String: Any],
                   fullText: String, labelIds: [String]) async throws {
        let payload: [String: Any] = [
            "kind": kind, "title": title, "config": config,
            "full_text": fullText, "label_ids": labelIds,
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await URLSession.shared.data(for: try request("/sources", method: "POST", body: body))
    }

    // ── admin triggers ────────────────────────────────────────────────────
    func triggerPoll() async throws {
        _ = try await URLSession.shared.data(for: try request("/admin/poll", method: "POST", body: Data("{}".utf8)))
    }

    func triggerTag() async throws {
        _ = try await URLSession.shared.data(for: try request("/admin/tag", method: "POST", body: Data("{}".utf8)))
    }
}
