# Reader — Personal iOS Knowledge Aggregator

An RSS-first, self-hosted knowledge aggregator: a Node/TS backend fetches high-signal
practitioner sources (blogs, Medium, Substack, Hacker News, Reddit, YouTube, arXiv,
GitHub, Lobste.rs, dev.to), dedups, auto-tags into labels, ranks, and serves JSON to a
SwiftUI iOS app that reproduces the Labels → Feed → Reader flow with an offline cache.

Built to the plan in `~/.claude/plans/could-you-please-read-elegant-dragonfly.md`.

```
reader/
├─ server/   Node/TS service (Hono + node:sqlite + kysely + croner + feedsmith + Anthropic)
└─ app/      SwiftUI + SwiftData iOS app (XcodeGen project)
```

## Backend (server/)

Node ≥ 22.19, pnpm. All data is a single SQLite file (`node:sqlite`, no native deps).

```bash
cd server
pnpm install
cp env.example .env        # set READER_TOKEN; optionally ANTHROPIC_API_KEY, REDDIT_CLIENT_ID/SECRET

# seed sources
pnpm exec tsx src/entry.ts import-opml     seeds/reader.opml      # blogs / Medium / Substack / etc.
pnpm exec tsx src/entry.ts import-sources  seeds/sources.json     # HN / Reddit / YouTube / arXiv / GitHub

pnpm exec tsx src/entry.ts probe seeds/reader.opml   # (optional) check feed liveness
pnpm exec tsx src/entry.ts poll --all                # fetch everything once
pnpm exec tsx src/entry.ts serve                     # HTTP API + polling scheduler on :8787
```

Other commands: `poll` (due only), `tag` (Claude Haiku auto-tagging when enabled), `--help`.
Dev checks: `pnpm test` (36 tests), `pnpm exec tsc --noEmit`, `pnpm exec oxlint`, `pnpm build`.

### JSON API (bearer token from `READER_TOKEN`)
`GET /health · /labels · /labels/:id/items?kind=&sort=&page= · /items/:id · /search?q= · /bookmarks · /sync?since=` and
`POST /labels · /items/:id/state · /items/:id/labels · /sources · /import-opml`.

### Channel notes (verified 2026-08-19)
- **Hacker News** — Firebase v0 + Algolia, keyless, real points/comments.
- **Reddit** — anonymous `.json`/`.rss` is now blocked; set `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`
  (OAuth, 100 qpm, free for personal use) or a `user=/feed=` token URL. Otherwise Reddit sources error cleanly.
- **YouTube / arXiv / GitHub** — keyless Atom/RSS feeds.
- **Auto-tagging** — off by default (rules only). Set `ANTHROPIC_API_KEY` + `TAG_LLM_ENABLED=true` to enable
  the Claude Haiku pass (`claude-haiku-4-5`, structured outputs, cached taxonomy; ~<$1/mo).
- **Search** — SQLite FTS5 (sqlite-vec/embeddings deferred: unreliable via node:sqlite on macOS).

## iOS app (app/)

Xcode 26+, XcodeGen. Talks to the backend (default `http://127.0.0.1:8799`; change in Settings).

```bash
cd app
xcodegen generate
xcodebuild -project Reader.xcodeproj -scheme Reader \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build build
xcrun simctl install "iPhone 17" build/Build/Products/Debug-iphonesimulator/Reader.app
xcrun simctl launch "iPhone 17" com.reader.personal
```

Three screens matching the wireframe: **Labels** (sources + unread badges), **Feed**
(All/HN/Reddit/Blogs filter, score sort, greyed read items, "synced" footer), **Reader**
(extracted text + Open original + bookmark/mark-read/share). Optimistic read/bookmark
actions reconcile with the server; SwiftData caches for offline; `BGAppRefreshTask` does a
best-effort background pull (the server owns freshness — iOS 26 tightened background cadence).

For personal install on a device, sign with a free Apple ID (7-day re-sign).
