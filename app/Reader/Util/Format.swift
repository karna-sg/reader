import Foundation

enum Format {
    // "412 pts", "1.2k upvotes"-style compact counts.
    static func compact(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }

    // Relative age from an epoch-ms timestamp: "2h", "5h", "1d".
    static func age(fromMs ms: Int?) -> String {
        guard let ms else { return "" }
        let seconds = max(0, Date().timeIntervalSince1970 - Double(ms) / 1000.0)
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86_400))d"
    }

    // Feed meta line: "Hacker News · 412 pts · 208 comments · 2h".
    static func meta(sourceTitle: String, kind: String, points: Int?, comments: Int?, publishedMs: Int?) -> String {
        var parts = [sourceTitle]
        if let p = points {
            parts.append(kind == "reddit" ? "\(compact(p)) upvotes" : "\(compact(p)) pts")
        }
        if let c = comments, c > 0 { parts.append("\(compact(c)) comments") }
        let a = age(fromMs: publishedMs)
        if !a.isEmpty { parts.append(a) }
        return parts.joined(separator: " · ")
    }

    static func syncedAgo(_ date: Date?) -> String {
        guard let date else { return "Not synced" }
        let s = Int(max(0, Date().timeIntervalSince(date)))
        if s < 60 { return "Synced just now" }
        if s < 3600 { return "Synced \(s / 60) min ago" }
        return "Synced \(s / 3600)h ago"
    }
}
