# Blueprint: A Personal-Use iOS "Reader" — Self-Hosted Knowledge Aggregator

## TL;DR
- **Build an RSS-first aggregator.** The large majority of the authentic, high-signal sources you want (Reddit, Hacker News, Medium, GitHub, Substack, personal & company engineering blogs, arXiv, Lobste.rs, YouTube, dev.to) expose free RSS/Atom feeds or free JSON APIs. Point a small backend at those, store to SQLite, and serve JSON to a SwiftUI app. This is the "hack" — you do **not** need paid social APIs for most of it.
- **Three of your nine platforms are impractical to pull directly.** X/Twitter (free tier discontinued in early February 2026, now consumption-based pay-per-use), LinkedIn (partner-only API, aggressive anti-scraping plus active litigation), and Instagram (login-gated, strict anti-crawl) are not worth ingesting for a solo project. Substitute by following the same practitioners' blogs, Substacks, and YouTube/podcast feeds.
- **Simplest architecture that works:** self-host Miniflux or FreshRSS (each does ~90% of fetching/storage/dedup and exposes a Google Reader/Fever sync API), OR write a ~200-line Python FastAPI + `feedparser` fetcher on a $4-6/mo VPS or a Raspberry Pi. Add a per-item LLM/embeddings tagging pass to power labels. SwiftUI app with SwiftData offline cache and a `BGAppRefreshTask` background refresh.

## Key Findings

1. **Reddit's hidden `.rss` endpoints are the single best hack** and survived the 2023/2025 API crackdowns because they were never part of the priced surface. Append `.rss` to any subreddit, user, search, or multireddit URL. The official API free tier still exists — **100 queries per minute per OAuth client ID, averaged over a 10-minute window** (unauthenticated requests are capped at 10 QPM and otherwise blocked) — but it now requires **pre-approval under Reddit's November 2025 Responsible Builder Policy**, which "extended pre-approval requirements to all developers, not just commercial users. Even a weekend personal project now requires explicit approval." Commercial use is ~$0.24 per 1,000 calls (reported ~$12,000/mo minimum) and is explicitly prohibited on the free tier.
2. **Hacker News is effectively free and unlimited** via the official Firebase API and the community Algolia Search API (no key, no meaningful limits), plus hnrss.org for filtered RSS (points thresholds, keyword search, Ask/Show HN).
3. **Medium, Substack, GitHub, YouTube, and arXiv all have clean, free feed patterns** — Medium `/feed/@user` and `/feed/<publication>`, Substack `/feed`, GitHub `.atom` on releases/commits/tags/user, YouTube `feeds/videos.xml?channel_id=`, arXiv `rss.arxiv.org/rss/<category>`.
4. **X/Twitter, LinkedIn, and Instagram are the hard three.** Nitter is largely dead/unreliable; RSSHub can technically generate feeds for all three but requires self-hosting with session cookies and breaks often. The pragmatic move is to not aggregate them directly.
5. **Miniflux and FreshRSS are production-grade, cheap, self-hosted backends** with standardized sync APIs (Google Reader + Fever), meaning you can skip most custom backend code.

## Details

### AREA 1 — Authentic Sources Directory (organized by label)

**Cross-cutting aggregators (highest signal-per-feed):**
- **Hacker News** — `https://news.ycombinator.com/rss` (front page only, ~30 items). Power feeds via hnrss.org: `https://hnrss.org/frontpage`, `https://hnrss.org/newest?points=100`, `https://hnrss.org/newest?q=<keyword>`, `https://hnrss.org/ask`, `https://hnrss.org/show`. Full data/comments via Algolia (`http://hn.algolia.com/api/v1/search_by_date`, tags: `story`, `comment`, `ask_hn`, `show_hn`, `author_<name>`, `front_page`) and Firebase (`https://hacker-news.firebaseio.com/v0/`, supports SSE streaming).
- **Lobste.rs** — `https://lobste.rs/rss` and per-tag `https://lobste.rs/t/programming.rss`. Smaller and higher signal-to-noise than HN for CS/programming.
- **GitHub Trending** (no official feed) — via self-hosted RSSHub `/github/trending/:since/:language`.

**STARTUP / INDIE / SAAS**
- Reddit: r/startups, r/Entrepreneur, r/SaaS, r/indiehackers, r/SideProject, r/microsaas, r/EntrepreneurRideAlong, r/smallbusiness. Feed example: `https://www.reddit.com/r/SaaS/top/.rss?limit=50`.
- Newsletters/blogs: Lenny's Newsletter (`https://www.lennysnewsletter.com/feed`), Not Boring / Packy McCormick (`https://www.notboring.co/feed`), Stratechery free articles (`https://stratechery.com/feed/`), Paul Graham essays (official `paulgraham.com/rss.html` is stalled — use community feed `https://program247365.github.io/paulgraham-rss/`), patio11 / Bits about Money (`https://www.bitsaboutmoney.com/archive/rss/` — note: not on Substack).
- Indie Hackers, Product Hunt (via RSSHub).

**ENGINEERING / SOFTWARE**
- Reddit: r/ExperiencedDevs, r/programming, r/webdev, r/devops.
- Practitioner blogs: Julia Evans (`https://jvns.ca/atom.xml`), Dan Luu (`https://danluu.com/atom.xml`), Simon Willison (`https://simonwillison.net/atom/everything/` — high volume, level-headed AI/LLM coverage), Martin Fowler (`https://martinfowler.com/feed.atom`), Brendan Gregg (`https://www.brendangregg.com/blog/rss.xml`), Tim Bray (`https://www.tbray.org/ongoing/ongoing.atom`), Joel Spolsky (`https://www.joelonsoftware.com/feed/`, mostly archival now).
- Newsletter: The Pragmatic Engineer / Gergely Orosz (`https://newsletter.pragmaticengineer.com/feed`; blog `https://blog.pragmaticengineer.com/rss/`).
- Company engineering blogs (all verified active in 2025-2026): Netflix (`https://netflixtechblog.com/feed`), Stripe (`https://stripe.com/blog/feed.rss`), Cloudflare (`https://blog.cloudflare.com/rss`), Uber (`https://www.uber.com/blog/engineering/rss/` — old `eng.uber.com/feed/` is dead), Airbnb (`https://medium.com/feed/airbnb-engineering`), Meta (`https://engineering.fb.com/feed/`), Spotify (`https://engineering.atspotify.com/feed/`), Slack (`https://slack.engineering/feed/`), GitHub (`https://github.blog/feed/`), Shopify (`https://shopify.engineering/blog.atom`), Figma (`https://www.figma.com/blog/feed/atom.xml`).
- Bulk import via OPML: `github.com/kilimchoi/engineering-blogs`, `github.com/tuan3w/awesome-tech-rss`.

**AI / ML**
- Reddit: r/MachineLearning, r/LocalLLaMA, r/learnmachinelearning, r/artificial, r/AI_Agents, r/mlops.
- arXiv: `https://rss.arxiv.org/rss/cs.LG`, `cs.CL`, `cs.AI` (combine with `+`, e.g. `cs.AI+cs.CL`, up to 2000 items, updated daily at midnight ET); custom query feeds via `github.com/ronpay/arxiv-rss-feed-generator` or `github.com/lukasschwab/arxiv-feeds`.
- Papers With Code, Kaggle blog.
- Company/research: Google Research (`https://research.google/blog/rss`), OpenAI (`https://openai.com/news/rss.xml` — old `/blog/rss.xml` now redirects here), Anthropic (**no official RSS** — use a community RSSHub mirror), Import AI / Jack Clark (`https://importai.substack.com/feed`; old `import.ai/rss` is a 404).
- Medium: the former Towards Data Science (`https://towardsdatascience.com/feed`; the successor "Data Science" publication is at `https://medium.com/feed/data-science`).

**PRODUCT / DESIGN**
- Reddit: r/ProductManagement, r/userexperience, r/web_design.
- Lenny's Newsletter (product), Figma blog, Designer News / Dribbble (via RSSHub), Stratechery (strategy).

**INVESTING / FINANCE**
- Reddit: r/investing, r/Bogleheads, r/SecurityAnalysis.
- Bogleheads forum; Money Stuff by Matt Levine (Bloomberg-hosted, **not** Substack — an RSS exists but the endpoint is Bloomberg-proprietary and can be flaky/paywalled).

**SCIENCE / CAREER / HEALTH-PRODUCTIVITY**
- arXiv subject feeds (physics, q-bio, econ), Quanta Magazine; Reddit r/cscareerquestions (career), r/productivity; Wikipedia Current Events portal feed; TLDR-style curated newsletters (which keep web archives that expose feeds).

**Beyond the 9 — additional authentic channels worth adding:** Substack (per-topic newsletters above), Lobste.rs, Indie Hackers, Product Hunt, Stack Overflow/Stack Exchange (per-tag RSS), dev.to (`/feed`, `/feed/username`, `/feed/tag/tagname`), Hashnode, YouTube (channel RSS + transcripts via `youtube-transcript-api`), podcasts (RSS enclosures + transcripts), arXiv, Papers With Code, Kaggle, Designer News/Dribbble, Bogleheads, Wikipedia current events, TLDR newsletters.

### AREA 2 — Data Access Methods ("the hack")

**Per-platform access comparison:**

| Platform | Best method | Effort | Reliability | Cost | Rate limits / notes |
|---|---|---|---|---|---|
| **Reddit** | `.rss` on any URL (subreddit/user/search/multi) | Low | Medium | Free | HTTP 429 if aggressive; set a unique User-Agent, cache, poll ≤ every 5-10 min. OAuth API: 100 QPM per client (10-min avg), needs Nov-2025 pre-approval. |
| **Hacker News** | Firebase API + Algolia search + hnrss.org | Low | High | Free | No key, no meaningful limits. hnrss caches a few minutes. |
| **Medium** | `/feed/@user`, `/feed/<pub>`, `/feed/<pub>/tagged/<tag>` | Low | High | Free | Official API deprecated; RSS is the supported surface. ~10 latest items, excerpts (not full text). |
| **Personal blogs** | Native RSS/Atom (`/feed`, `/atom.xml`, `/rss.xml`) | Low | High | Free | Some truncate to excerpts → use full-text extraction. |
| **Company eng blogs** | Native RSS/Atom (see list) | Low | High | Free | Cloudflare's own WAF may 403 bot user-agents — send a browser-like UA. |
| **GitHub** | Atom: `releases.atom`, `commits.atom`, `tags.atom`, `<user>.atom` | Low | High | Free | Trending needs RSSHub. REST/GraphQL API: 5,000 req/hr authenticated. |
| **Substack** | Append `/feed` to publication domain | Low | High | Free | Free posts full; paid posts truncated. |
| **YouTube** | `feeds/videos.xml?channel_id=UC…` | Low | High | Free | ~15 latest, no key. `playlist_id=` variant; swap channel `UC`→`UULF` for long-form only. Transcripts via youtube-transcript-api. |
| **arXiv** | `rss.arxiv.org/rss/<cat>` (+combine, custom query gen) | Low | High | Free | Daily update midnight ET; 2000-item limit. |
| **Lobste.rs / dev.to / Stack Exchange** | Native RSS | Low | High | Free | Per-tag and per-user feeds available. |
| **X / Twitter** | RSSHub (self-host + cookies) or paid API | High | Low | Paid | Free tier discontinued early Feb 2026; consumption-based: $0.005 per post read (per returned resource — a call returning 100 posts costs $0.005×100), capped at 2M reads/mo; $0.015 per post created ($0.20 if it contains a link); Enterprise ~$42,000+/mo. Nitter mostly dead. **Recommend: skip.** |
| **LinkedIn** | RSSHub (fragile) / none | High | Very low | — | Partner-only API (~500 calls/user/day, basic profile only); aggressive anti-scrape + lawsuits (Proxycurl shut down after LinkedIn suit, 2025). **Recommend: skip.** |
| **Instagram** | RSSHub via Picnob/Picuki, or credentials | High | Low | — | Strict anti-crawl, login required, 2FA unsupported by the private-API route. **Recommend: skip.** |

**Third-party/community tooling:**
- **RSSHub** (`github.com/DIYgod/RSSHub`): "over 5,000 routes covering platforms like TikTok, Weibo, Bilibili, YouTube, Spotify, Instagram… the world's largest RSS network, with over 5,000 public instances processing hundreds of millions of requests per month" (1,300+ contributors). Self-host via Docker or Cloudflare Workers. Its Twitter/Instagram routes need config/cookies and are flagged "strict anti-crawling."
- **Nitter** — development officially resumed Feb 6 2025, but public instances are unreliable and now generally require login/session tokens; treat as effectively dead for reliable feeds.
- **RSS-Bridge, morss, Full-Text RSS** — convert truncated feeds/pages into full content.
- **Content extraction (URL → clean text/markdown):** **Trafilatura** is the recommended open-source default — on the ScrapingHub article-extraction benchmark it scores **F1 0.945 (precision 0.925, recall 0.966)**, narrowly ahead of go-readability at 0.943, at roughly 14-22ms/page and free under Apache 2.0. (The newer Rust port rs-trafilatura reportedly tops the same set at F1 0.966.) For JS-heavy pages, render with Playwright first, then extract. Alternatives: Mozilla Readability / readability-lxml, newspaper4k; **Jina Reader** (`https://r.jina.ai/<url>`) for zero-setup hosted conversion; **Firecrawl** for heavy SPAs (paid).

### AREA 3 — Label / Taxonomy Design

**Core model: each label = (set of feeds) + (keyword/semantic filters) + (quality threshold).**

Two-level taxonomy — broad labels, each mapping to sources + filters:

| Broad label | Example sub-topics | Core sources |
|---|---|---|
| Startup | fundraising, PMF, growth, indie | r/startups, r/SaaS, Lenny, Not Boring, HN Show HN |
| Engineering | systems, backend, career, SRE | r/ExperiencedDevs, Lobste.rs, Pragmatic Engineer, company eng blogs |
| AI/ML | LLMs, research, MLOps | r/MachineLearning, arXiv cs.LG/cs.CL, OpenAI/Anthropic, Import AI |
| Product | PM, discovery, roadmap | r/ProductManagement, Lenny, Stratechery |
| Design | UX, UI, design systems | Figma blog, Designer News, r/userexperience |
| Investing | index funds, analysis | r/Bogleheads, Money Stuff, r/investing |
| Career | interviewing, leveling | r/cscareerquestions, Pragmatic Engineer |
| Health/Productivity | habits, focus | curated blogs, r/productivity |
| Science | physics, bio, econ | arXiv subject feeds, Quanta |

**How existing apps handle topics/filtering:** Feedly (folders + paid AI "Leo" filtering), Inoreader (folders, rules/automation, 150 feeds on free tier), Miniflux (single "river of news" + regex keep/block rules), Readwise Reader (tags + saved filtered views), Matter. Miniflux and Tiny Tiny RSS support article scoring/filtering natively (TTRSS most powerful).

**Auto-tagging / dedup / ranking pipeline (recommended):**
1. **Dedup** — URL canonicalization (strip UTM/query params, resolve redirects) + content hashing (SHA-256) for exact duplicates. For near-duplicates (the same story reposted with tweaks) use embeddings + cosine similarity with a ~0.8 cutoff, clustering items published within a ~1-week window — the approach used in production news pipelines. Lightweight tools: SemHash, WordLlama, or LSH.
2. **Auto-tag into labels** — either (a) cheap LLM classification (send title + excerpt to a small model — local Llama 3.1 8B or an inexpensive API — returning one or more labels), or (b) local embeddings + nearest-label centroid. Use keyword filters as a fast pre-filter to save tokens.
3. **Rank/score** — combine source authority + engagement signal (HN points, Reddit upvotes) + recency decay (e.g., the HN "gravity" form: `score = points / (age_hours + 2)^1.5`) + semantic relevance to the label. Apply a per-label quality threshold to suppress noise.

### AREA 4 — Architecture Blueprint (SwiftUI + small backend)

**Path A — Custom-lite backend (max control):**
- **Backend:** Python + FastAPI; `feedparser` (parsing), `trafilatura` (full-text extraction), `httpx` (fetching), APScheduler or system cron (scheduled pulls).
- **Storage:** SQLite (single-user, zero-ops). Move to Postgres only if you want embeddings via pgvector.
- **Dedup:** URL canonicalization + content hash; optional embedding similarity.
- **API:** simple JSON REST — `GET /labels`, `GET /labels/{id}/items?since=`, `GET /items/{id}` (extracted full text + original link), `POST /items/{id}/read`.

**Path B — Stand on an existing self-hosted RSS backend (least code, recommended to start):**
- **Miniflux** — single Go binary + Postgres, built-in full-text fetch, exposes both a clean REST API and the Google Reader API, plus regex keep/block rules. Minimal and fast; hostable for ~$1/mo on PikaPods. Best if you want to write almost no fetcher code and focus on the SwiftUI client + a thin tagging layer. (Fever API is read-only here.)
- **FreshRSS** — PHP, supports SQLite/MySQL/Postgres, Fever API + Google Reader API, extensions (YouTube, XPath scraping, WebSub push). Best if you want SQLite + extensibility.
- **Tiny Tiny RSS** — most powerful filtering/scoring, but the steepest ops.
In both cases you consume the Google Reader/Fever API from Swift and bolt your own LLM tagging pass on the side.

**Hosting:** Cheapest reliable option is a small VPS (e.g., Hetzner-class, ~$4-6/mo) or a Raspberry Pi at home. Note the free-tier landscape has tightened: **Fly.io ended its free tier in October 2024** (new accounts get only a 2-hour/7-day trial, then pay-as-you-go), and **Railway has no permanent free tier** (Hobby is $5/mo with $5 of included usage). A flat $3-6/mo VPS or a Pi is the most predictable for an always-on fetcher.

**SwiftUI app structure:**
- Screens: Labels list → item feed per label → in-app reader view (extracted text + a prominent "Open original link").
- Persistence: **SwiftData** (iOS 17+, Swift-native, minimal boilerplate) for offline cache. Consider Core Data only if you need batch-insert performance — SwiftData has no `NSBatchInsertRequest` equivalent, which matters for large imports (Core Data is ~5-7x faster there). Keep model objects off the main thread; SwiftData/Core Data models are not `Sendable`.
- Background refresh: register a `BGAppRefreshTask` at launch; pull-to-refresh via `.refreshable`.
- Reference open-source: **NetNewsWire** (free, open-source iOS/Mac RSS reader) for reading-UI, sync, and background-refresh patterns.

**Build order (MVP-first):**
1. **Phase 1 — RSS core:** fetcher for RSS/Atom sources (personal + company blogs, Medium, Substack, YouTube, arXiv, Lobste.rs, GitHub `.atom`) → SQLite → JSON API → SwiftUI list/reader. This alone delivers most of the value.
2. **Phase 2 — free JSON APIs:** add Hacker News (Firebase/Algolia) and Reddit `.rss` (with a unique User-Agent + caching), plus Trafilatura full-text extraction.
3. **Phase 3 — intelligence:** dedup + LLM/embedding auto-tagging + per-label ranking/quality thresholds. This is what turns a feed reader into a knowledge base.
4. **Phase 4 — hard platforms (optional):** self-hosted RSSHub for GitHub Trending / Product Hunt / (attempted) X/Instagram, accepting fragility.

## Recommendations

1. **Start with Miniflux or FreshRSS, not a custom backend.** You get fetching, storage, dedup, and a documented sync API for ~$1-6/mo. Spend your effort on the SwiftUI client and the label/tagging layer these tools don't do well. Move to a custom FastAPI fetcher only if you outgrow their filtering.
2. **Treat RSS as the product.** Curate ~50-100 feeds across your labels from the directory above; this delivers the bulk of authentic practitioner knowledge with near-zero maintenance. Bootstrap quickly by importing the two OPML lists (`kilimchoi/engineering-blogs`, `tuan3w/awesome-tech-rss`).
3. **Do not build X/LinkedIn/Instagram ingestion.** The cost, fragility, and legal risk are disproportionate for one person. Substitute the same voices via their blogs, Substacks, and YouTube. Revisit only if RSSHub routes prove stable for specific accounts you truly need.
4. **Add one LLM tagging pass** over incoming items to auto-file into labels and dedup. Keep it cheap — a small/local model, title + excerpt only.
5. **Thresholds that should change the plan:** if Reddit `.rss` begins returning persistent 429s (as some users reported in June 2026), migrate those subreddits to the authenticated OAuth API (apply for Responsible Builder approval). If your VPS bill or maintenance creeps up, collapse back to hosted Miniflux. If you find you genuinely need an X account's content, only then evaluate self-hosted RSSHub with cookies — and expect breakage.

## Caveats
- Reddit `.rss` is rate-limited and undocumented; it could be restricted further at any time (Reddit has tightened access repeatedly since 2023 and its Nov-2025 policy lets it deny API requests "with no stated reason or appeal"). Architect so a tightening doesn't break everything.
- Feed endpoints change: Uber's old `eng.uber.com/feed/` is dead; OpenAI moved from `/blog/rss.xml` to `/news/rss.xml`; Paul Graham's official feed is stalled. Verify each on subscribe and prefer actively maintained OPML lists.
- **Anthropic, the Discord blog, Kelsey Hightower (no maintained blog), and some newsletters (e.g., The Batch) have no official RSS** — you'll need RSSHub or an email-to-RSS bridge.
- Some feeds carry excerpts only (Medium, many blogs, paid Substacks, personalized Stratechery/Money Stuff). Full-text extraction helps but paywalled content stays partial — respect paywalls and per-site ToS for personal use.
- Exact dates and pricing (X pay-per-use switch reported between Feb 6-9 2026; Fly.io/Railway free tiers; Reddit policy figures) are current as of mid-2026 and change frequently; re-verify before relying on any single number.