// The JSON API the iOS app consumes. Single-user bearer auth (READER_TOKEN from
// env). Routes drive the three wireframe screens plus source management.
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/db.js";
import type { Config } from "../config/env.js";
import type { SourceKind } from "../model/item.js";
import { makeSourceId, sourceKeyFor } from "../model/source.js";
import type { SourceSpec } from "../model/source.js";
import { SourceConfigSchemas } from "../adapters/types.js";
import { rankCandidates } from "../pipeline/rank.js";
import { addLabel, getLabel, listLabelsWithMeta, updateLabel } from "../store/labels.js";
import {
  assignItemLabels,
  bookmarkedItems,
  getItemLabels,
  getItemWithSource,
  labelFeedCandidates,
  removeItemLabels,
  searchItems,
  setItemState,
} from "../store/items.js";
import {
  deleteSource,
  listSourcesWithStatus,
  setSourceEnabled,
  upsertSource,
} from "../store/sources.js";
import { syncDelta } from "../store/sync.js";
import { parseOpmlToSpecs } from "../adapters/opml.js";
import { applySettingsPatch, effectiveConfig, publicSettings } from "../config/settings.js";
import { buildAdapterContext } from "../pipeline/context.js";
import { pollAll, tagIfEnabled } from "../scheduler/scheduler.js";
import { clearRedditTokenCache } from "../adapters/reddit.js";
import { feedItemDto, itemDetailDto, searchItemDto } from "./dto.js";
import { slugify } from "../util/slug.js";
import { log } from "../logging/logger.js";

const KINDS: SourceKind[] = ["rss", "hackernews", "reddit", "youtube", "arxiv", "github"];

export function buildApp(db: Db, cfg: Config): Hono {
  const app = new Hono();

  // ── auth (public: "/" and "/health"; everything else needs the token) ──────
  const PUBLIC_PATHS = new Set(["/", "/health"]);
  app.use("*", async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    if (!cfg.READER_TOKEN) return next(); // dev mode: no token configured
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== cfg.READER_TOKEN) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  // Friendly root so hitting the URL in a browser doesn't look broken.
  app.get("/", (c) =>
    c.json({
      service: "reader",
      ok: true,
      note: "Token-protected API. Open the Reader app → Settings, set this URL as the Base URL and paste your READER_TOKEN.",
      health: "/health",
    }),
  );

  app.get("/health", (c) => {
    const sources = (db.raw.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number }).n;
    const items = (db.raw.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
    return c.json({ ok: true, sources, items });
  });

  // ── labels ──────────────────────────────────────────────────────────────
  app.get("/labels", (c) => c.json({ labels: listLabelsWithMeta(db) }));

  app.post("/labels", async (c) => {
    const body = z
      .object({ id: z.string().optional(), name: z.string().min(1), position: z.number().int().optional() })
      .parse(await c.req.json());
    const id = body.id ?? slugify(body.name);
    addLabel(db, { id, name: body.name, position: body.position });
    return c.json({ id, name: body.name }, 201);
  });

  app.patch("/labels/:id", async (c) => {
    const patch = z
      .object({
        name: z.string().min(1).optional(),
        position: z.number().int().optional(),
        min_score: z.number().optional(),
      })
      .parse(await c.req.json());
    const ok = updateLabel(db, c.req.param("id"), patch);
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  // ── label feed (ranked, filtered, paginated) ──────────────────────────────
  app.get("/labels/:id/items", (c) => {
    const labelId = c.req.param("id");
    const label = getLabel(db, labelId);
    if (!label) return c.json({ error: "not found" }, 404);
    const sort = c.req.query("sort") === "new" ? "new" : "score";
    const kind = c.req.query("kind") ?? "all";
    const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize") ?? "50") || 50));
    const now = Date.now();
    const candidates = labelFeedCandidates(db, labelId, { kind, limit: 500 });
    const rankedAll = rankCandidates(candidates, now, sort);
    // Per-label quality threshold: drop low-score noise (min_score defaults to 0).
    const ranked = label.min_score > 0 ? rankedAll.filter((r) => r.score >= label.min_score) : rankedAll;
    const start = (page - 1) * pageSize;
    const pageItems = ranked.slice(start, start + pageSize).map((r) => feedItemDto(r.candidate, r.score));
    return c.json({
      label_id: labelId,
      sort,
      kind,
      page,
      page_size: pageSize,
      total: ranked.length,
      has_more: start + pageSize < ranked.length,
      items: pageItems,
    });
  });

  // ── item detail ───────────────────────────────────────────────────────────
  app.get("/items/:id", (c) => {
    const row = getItemWithSource(db, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(itemDetailDto(row, getItemLabels(db, row.id)));
  });

  app.post("/items/:id/state", async (c) => {
    const body = z.object({ read: z.boolean().optional(), bookmarked: z.boolean().optional() }).parse(
      await c.req.json(),
    );
    const ok = setItemState(db, c.req.param("id"), body);
    return ok ? c.json({ ok: true }) : c.json({ error: "not found or no change" }, 404);
  });

  app.post("/items/:id/labels", async (c) => {
    const body = z
      .object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })
      .parse(await c.req.json());
    const id = c.req.param("id");
    if (body.add?.length) {
      assignItemLabels(
        db,
        id,
        body.add.map((labelId) => ({ labelId, confidence: 1, origin: "rule" as const })),
        { bump: true },
      );
    }
    if (body.remove?.length) removeItemLabels(db, id, body.remove);
    return c.json({ ok: true, labels: getItemLabels(db, id) });
  });

  // ── bookmarks ─────────────────────────────────────────────────────────────
  app.get("/bookmarks", (c) => {
    return c.json({ items: bookmarkedItems(db, 200).map(searchItemDto) });
  });

  // ── search (FTS5) ─────────────────────────────────────────────────────────
  app.get("/search", (c) => {
    const q = c.req.query("q") ?? "";
    const rows = searchItems(db, q, 50);
    return c.json({ query: q, items: rows.map(searchItemDto) });
  });

  // ── delta sync ────────────────────────────────────────────────────────────
  app.get("/sync", (c) => {
    const since = Number(c.req.query("since") ?? "0") || 0;
    const result = syncDelta(db, since, 500);
    return c.json({ ...result, labels: listLabelsWithMeta(db) });
  });

  // ── source management ─────────────────────────────────────────────────────
  app.post("/sources", async (c) => {
    const body = z
      .object({
        kind: z.enum(KINDS as [SourceKind, ...SourceKind[]]),
        title: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
        full_text: z.enum(["excerpt", "extract", "render"]).default("excerpt"),
        authority: z.number().min(0).max(1).default(0.6),
        label_ids: z.array(z.string()).default([]),
        poll_interval_ms: z.number().int().positive().optional(),
      })
      .parse(await c.req.json());
    // validate kind-specific config
    SourceConfigSchemas[body.kind].parse(body.config);
    const spec: SourceSpec = {
      id: makeSourceId(body.kind, sourceKeyFor(body.kind, body.config)),
      kind: body.kind,
      title: body.title,
      config: body.config,
      full_text: body.full_text,
      authority: body.authority,
      poll_interval_ms: body.poll_interval_ms,
      label_ids: body.label_ids,
    };
    upsertSource(db, spec, cfg.DEFAULT_POLL_INTERVAL_MS);
    return c.json({ id: spec.id }, 201);
  });

  app.post("/import-opml", async (c) => {
    const xml = await c.req.text();
    const specs = parseOpmlToSpecs(xml);
    for (const s of specs) upsertSource(db, s, cfg.DEFAULT_POLL_INTERVAL_MS);
    return c.json({ imported: specs.length, source_ids: specs.map((s) => s.id) }, 201);
  });

  // ── settings (runtime config; secrets write-only) ─────────────────────────
  app.get("/settings", (c) => c.json(publicSettings(db, cfg)));

  app.post("/settings", async (c) => {
    const patch = z
      .object({
        reddit_client_id: z.string().optional(),
        reddit_client_secret: z.string().optional(),
        reddit_user_agent: z.string().optional(),
        anthropic_api_key: z.string().optional(),
        tag_model: z.string().optional(),
        tag_llm_enabled: z.boolean().optional(),
        http_user_agent: z.string().optional(),
        default_poll_interval_ms: z.number().int().positive().optional(),
      })
      .parse(await c.req.json());
    applySettingsPatch(db, patch);
    // If Reddit creds changed, drop any cached OAuth token so the new ones apply.
    if (patch.reddit_client_id !== undefined || patch.reddit_client_secret !== undefined) {
      clearRedditTokenCache();
    }
    return c.json(publicSettings(db, cfg));
  });

  // ── source management ─────────────────────────────────────────────────────
  app.get("/sources", (c) => c.json({ sources: listSourcesWithStatus(db) }));

  app.post("/sources/:id/toggle", async (c) => {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    const ok = setSourceEnabled(db, c.req.param("id"), body.enabled);
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  app.delete("/sources/:id", (c) => {
    const ok = deleteSource(db, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  // ── admin triggers (fire-and-forget; return immediately) ──────────────────
  app.post("/admin/poll", (c) => {
    const ctx = buildAdapterContext(effectiveConfig(db, cfg));
    void pollAll(db, ctx)
      .then((s) => log("admin").info("manual poll complete", s))
      .catch((e) => log("admin").warn("manual poll failed", { err: (e as Error).message }));
    return c.json({ started: true });
  });

  app.post("/admin/tag", (c) => {
    void tagIfEnabled(db, cfg)
      .then((t) => t && log("admin").info("manual tag complete", t))
      .catch((e) => log("admin").warn("manual tag failed", { err: (e as Error).message }));
    return c.json({ started: true });
  });

  app.onError((err, c) => {
    log("http").warn("request error", { path: c.req.path, err: err.message });
    if (err instanceof z.ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
