import Foundation

// Codable DTOs mirroring the Reader backend JSON API.

struct LabelDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let unread: Int
    let total: Int
    let source_count: Int
    let source_summary: [String]
    var position: Int? = nil
}

struct LabelsResponse: Codable {
    let labels: [LabelDTO]
}

struct FeedItemDTO: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let url: String
    let source_id: String
    let source_kind: String
    let source_title: String
    let author: String?
    let published_at: Int?
    let fetched_at: Int?
    let body_tier: String?
    let points: Int?
    let comments: Int?
    let read: Bool
    let bookmarked: Bool
    let score: Double?
}

struct FeedResponse: Codable {
    let label_id: String
    let sort: String
    let kind: String
    let page: Int
    let total: Int
    let has_more: Bool
    let items: [FeedItemDTO]
}

struct ItemLabelDTO: Codable, Hashable {
    let label_id: String
    let confidence: Double
    let origin: String
}

struct ItemDetailDTO: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let url: String
    let canonical_url: String
    let source_id: String
    let source_kind: String
    let source_title: String
    let author: String?
    let published_at: Int?
    let body_tier: String?
    let body_html: String?
    let body_text: String?
    let points: Int?
    let comments: Int?
    let read: Bool
    let bookmarked: Bool
    let label_ids: [String]
    let labels: [ItemLabelDTO]
}

struct ItemsResponse: Codable {
    let items: [FeedItemDTO]
}

struct SearchResponse: Codable {
    let query: String
    let items: [FeedItemDTO]
}

struct HealthResponse: Codable {
    let ok: Bool
    let sources: Int
    let items: Int
}
