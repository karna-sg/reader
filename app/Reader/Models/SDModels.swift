import Foundation
import SwiftData

// SwiftData offline cache. Scalar-only models (no relationships) keep it simple
// and Sendable-friendly. The AppModel upserts these on fetch; views read the
// in-memory DTOs but fall back to this cache when offline.

@Model
final class SDLabel {
    @Attribute(.unique) var id: String
    var name: String
    var position: Int
    var unread: Int
    var total: Int
    var sourceCount: Int
    var sourceSummary: [String]

    init(id: String, name: String, position: Int, unread: Int, total: Int, sourceCount: Int, sourceSummary: [String]) {
        self.id = id
        self.name = name
        self.position = position
        self.unread = unread
        self.total = total
        self.sourceCount = sourceCount
        self.sourceSummary = sourceSummary
    }
}

@Model
final class SDItem {
    @Attribute(.unique) var id: String
    var title: String
    var url: String
    var sourceKind: String
    var sourceTitle: String
    var author: String?
    var publishedAt: Int?
    var points: Int?
    var comments: Int?
    var read: Bool
    var bookmarked: Bool
    var bodyText: String?
    var bodyTier: String?
    var labelIds: [String]
    var score: Double
    var order: Double // stable per-label ordering (score at fetch time)

    init(id: String, title: String, url: String, sourceKind: String, sourceTitle: String,
         author: String?, publishedAt: Int?, points: Int?, comments: Int?,
         read: Bool, bookmarked: Bool, bodyText: String?, bodyTier: String?,
         labelIds: [String], score: Double, order: Double) {
        self.id = id
        self.title = title
        self.url = url
        self.sourceKind = sourceKind
        self.sourceTitle = sourceTitle
        self.author = author
        self.publishedAt = publishedAt
        self.points = points
        self.comments = comments
        self.read = read
        self.bookmarked = bookmarked
        self.bodyText = bodyText
        self.bodyTier = bodyTier
        self.labelIds = labelIds
        self.score = score
        self.order = order
    }
}

// A user action awaiting confirmation from the server (optimistic + reconcile).
@Model
final class SDPendingAction {
    @Attribute(.unique) var id: String // itemId + ":" + kind
    var itemId: String
    var kind: String // "read" | "unread" | "bookmark" | "unbookmark"
    var createdAt: Date
    var attempts: Int

    init(itemId: String, kind: String) {
        self.id = "\(itemId):\(kind)"
        self.itemId = itemId
        self.kind = kind
        self.createdAt = Date()
        self.attempts = 0
    }
}
