import Foundation
import SwiftData
import Observation

// Central app state: talks to the backend, caches into SwiftData for offline,
// and applies optimistic user-state changes with server reconciliation.
@MainActor
@Observable
final class AppModel {
    var labels: [LabelDTO] = []
    var online = true
    var lastSynced: Date?
    var loadError: String?

    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
        loadLabelsFromCache()
    }

    private var api: APIClient { APIClient() }

    // ── labels ────────────────────────────────────────────────────────────
    func refreshLabels() async {
        do {
            let fetched = try await api.labels()
            labels = fetched
            online = true
            loadError = nil
            lastSynced = Date()
            persistLabels(fetched)
            await flushPending()
        } catch {
            online = false
            loadError = error.localizedDescription
            loadLabelsFromCache()
        }
    }

    private func loadLabelsFromCache() {
        let cached = (try? context.fetch(FetchDescriptor<SDLabel>(sortBy: [SortDescriptor(\.position)]))) ?? []
        if !cached.isEmpty {
            labels = cached.map {
                LabelDTO(id: $0.id, name: $0.name, unread: $0.unread, total: $0.total,
                         source_count: $0.sourceCount, source_summary: $0.sourceSummary, position: $0.position)
            }
        }
    }

    private func persistLabels(_ dtos: [LabelDTO]) {
        for (idx, dto) in dtos.enumerated() {
            let id = dto.id
            let existing = try? context.fetch(FetchDescriptor<SDLabel>(predicate: #Predicate { $0.id == id })).first
            if let e = existing {
                e.name = dto.name; e.position = dto.position ?? idx
                e.unread = dto.unread; e.total = dto.total
                e.sourceCount = dto.source_count; e.sourceSummary = dto.source_summary
            } else {
                context.insert(SDLabel(id: dto.id, name: dto.name, position: dto.position ?? idx,
                                       unread: dto.unread, total: dto.total,
                                       sourceCount: dto.source_count, sourceSummary: dto.source_summary))
            }
        }
        try? context.save()
    }

    // ── feed ──────────────────────────────────────────────────────────────
    func feed(labelId: String, kind: String) async -> [FeedItemDTO] {
        do {
            let resp = try await api.feed(labelId: labelId, kind: kind)
            online = true
            persistFeed(resp.items, labelId: labelId)
            return resp.items
        } catch {
            online = false
            return cachedFeed(labelId: labelId, kind: kind)
        }
    }

    private func persistFeed(_ items: [FeedItemDTO], labelId: String) {
        for (idx, dto) in items.enumerated() {
            upsertItem(dto, labelId: labelId, order: Double(items.count - idx))
        }
        try? context.save()
    }

    private func upsertItem(_ dto: FeedItemDTO, labelId: String?, order: Double) {
        let id = dto.id
        let existing = try? context.fetch(FetchDescriptor<SDItem>(predicate: #Predicate { $0.id == id })).first
        if let e = existing {
            e.title = dto.title; e.url = dto.url
            e.sourceKind = dto.source_kind; e.sourceTitle = dto.source_title
            e.author = dto.author; e.publishedAt = dto.published_at
            e.points = dto.points; e.comments = dto.comments
            e.read = dto.read; e.bookmarked = dto.bookmarked
            e.score = dto.score ?? e.score; e.order = order
            if let labelId, !e.labelIds.contains(labelId) { e.labelIds.append(labelId) }
        } else {
            context.insert(SDItem(id: dto.id, title: dto.title, url: dto.url,
                                  sourceKind: dto.source_kind, sourceTitle: dto.source_title,
                                  author: dto.author, publishedAt: dto.published_at,
                                  points: dto.points, comments: dto.comments,
                                  read: dto.read, bookmarked: dto.bookmarked,
                                  bodyText: nil, bodyTier: dto.body_tier,
                                  labelIds: labelId.map { [$0] } ?? [], score: dto.score ?? 0, order: order))
        }
    }

    private func cachedFeed(labelId: String, kind: String) -> [FeedItemDTO] {
        let all = (try? context.fetch(FetchDescriptor<SDItem>(sortBy: [SortDescriptor(\.order, order: .reverse)]))) ?? []
        return all.filter { $0.labelIds.contains(labelId) && kindMatches($0.sourceKind, kind) }
            .map(Self.toDTO)
    }

    private func kindMatches(_ sourceKind: String, _ filter: String) -> Bool {
        switch filter {
        case "hn": return sourceKind == "hackernews"
        case "reddit": return sourceKind == "reddit"
        case "blogs": return ["rss", "arxiv", "github", "youtube"].contains(sourceKind)
        default: return true
        }
    }

    // ── item detail ───────────────────────────────────────────────────────
    func item(id: String) async -> ItemDetailDTO? {
        do {
            let detail = try await api.item(id: id)
            let e = try? context.fetch(FetchDescriptor<SDItem>(predicate: #Predicate { $0.id == id })).first
            e?.bodyText = detail.body_text; e?.bodyTier = detail.body_tier
            try? context.save()
            return detail
        } catch {
            online = false
            return nil
        }
    }

    // ── bookmarks / search ─────────────────────────────────────────────────
    func bookmarks() async -> [FeedItemDTO] {
        do { let items = try await api.bookmarks(); online = true; return items }
        catch {
            online = false
            let all = (try? context.fetch(FetchDescriptor<SDItem>())) ?? []
            return all.filter { $0.bookmarked }.map(Self.toDTO)
        }
    }

    func search(_ q: String) async -> [FeedItemDTO] {
        (try? await api.search(q)) ?? []
    }

    func addLabel(name: String) async {
        try? await api.addLabel(name: name)
        await refreshLabels()
    }

    // ── optimistic actions ─────────────────────────────────────────────────
    func setRead(id: String, _ read: Bool) async {
        applyLocal(id: id) { $0.read = read }
        enqueue(itemId: id, kind: read ? "read" : "unread")
        do { try await api.setState(id: id, read: read); dequeue(itemId: id, kind: read ? "read" : "unread") }
        catch { online = false }
    }

    func setBookmark(id: String, _ bookmarked: Bool) async {
        applyLocal(id: id) { $0.bookmarked = bookmarked }
        enqueue(itemId: id, kind: bookmarked ? "bookmark" : "unbookmark")
        do { try await api.setState(id: id, bookmarked: bookmarked); dequeue(itemId: id, kind: bookmarked ? "bookmark" : "unbookmark") }
        catch { online = false }
    }

    private func applyLocal(id: String, _ mutate: (SDItem) -> Void) {
        if let e = try? context.fetch(FetchDescriptor<SDItem>(predicate: #Predicate { $0.id == id })).first {
            mutate(e); try? context.save()
        }
    }

    private func enqueue(itemId: String, kind: String) {
        context.insert(SDPendingAction(itemId: itemId, kind: kind))
        try? context.save()
    }

    private func dequeue(itemId: String, kind: String) {
        let pid = "\(itemId):\(kind)"
        if let p = try? context.fetch(FetchDescriptor<SDPendingAction>(predicate: #Predicate { $0.id == pid })).first {
            context.delete(p); try? context.save()
        }
    }

    func flushPending() async {
        let pending = (try? context.fetch(FetchDescriptor<SDPendingAction>())) ?? []
        for p in pending {
            do {
                switch p.kind {
                case "read": try await api.setState(id: p.itemId, read: true)
                case "unread": try await api.setState(id: p.itemId, read: false)
                case "bookmark": try await api.setState(id: p.itemId, bookmarked: true)
                case "unbookmark": try await api.setState(id: p.itemId, bookmarked: false)
                default: break
                }
                context.delete(p)
            } catch { p.attempts += 1 }
        }
        try? context.save()
    }

    static func toDTO(_ e: SDItem) -> FeedItemDTO {
        FeedItemDTO(id: e.id, title: e.title, url: e.url, source_id: "", source_kind: e.sourceKind,
                    source_title: e.sourceTitle, author: e.author, published_at: e.publishedAt,
                    fetched_at: nil, body_tier: e.bodyTier, points: e.points, comments: e.comments,
                    read: e.read, bookmarked: e.bookmarked, score: e.score)
    }
}
