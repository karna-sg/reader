// Server-owned polling. iOS background refresh is best-effort (iOS 26 tightened
// BGAppRefreshTask), so the server is the source of freshness. A croner job runs
// each minute, processing due sources sequentially with a polite per-host gap
// and 429 backoff (handled in ingest via deferSource).
import { Cron } from "croner";
import type { Db } from "../db/db.js";
import type { Config } from "../config/env.js";
import { llmTaggingReady } from "../config/env.js";
import type { AdapterContext, Source } from "../adapters/types.js";
import { listAllSources, listDueSources } from "../store/sources.js";
import { runSource } from "../pipeline/ingest.js";
import { makeAnthropicTagger, tagPending } from "../pipeline/tag.js";
import { log } from "../logging/logger.js";

const PER_HOST_GAP_MS = 1500;
const INTER_REQUEST_MS = 150;

function sourceHost(source: Source): string {
  const cfg = source.config as Record<string, unknown>;
  const url =
    (cfg.feed_url as string | undefined) ??
    (cfg.rss_url as string | undefined) ??
    (cfg.atom_url as string | undefined);
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      /* ignore */
    }
  }
  return source.kind; // grouping fallback for kinds without a single feed URL
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PollSummary {
  processed: number;
  created: number;
  errors: number;
}

async function processList(
  db: Db,
  ctx: AdapterContext,
  sources: Source[],
): Promise<PollSummary> {
  const lastHostHit = new Map<string, number>();
  let created = 0;
  let errors = 0;
  for (const source of sources) {
    const host = sourceHost(source);
    const since = Date.now() - (lastHostHit.get(host) ?? 0);
    if (since < PER_HOST_GAP_MS) await sleep(PER_HOST_GAP_MS - since);
    lastHostHit.set(host, Date.now());
    const res = await runSource(db, source, ctx);
    created += res.created;
    if (res.status === "error") errors++;
    if (res.created > 0 || res.status === "error") {
      log("scheduler").info("polled", {
        source: source.id,
        status: res.status,
        seen: res.seen,
        created: res.created,
      });
    }
    await sleep(INTER_REQUEST_MS);
  }
  return { processed: sources.length, created, errors };
}

/** Poll every source whose interval has elapsed. */
export async function pollDue(db: Db, ctx: AdapterContext): Promise<PollSummary> {
  return processList(db, ctx, listDueSources(db, Date.now()));
}

/** Poll every enabled source now, ignoring the interval (CLI `poll --all`). */
export async function pollAll(db: Db, ctx: AdapterContext): Promise<PollSummary> {
  return processList(db, ctx, listAllSources(db));
}

export interface SchedulerHandle {
  stop(): void;
}

export function startScheduler(db: Db, ctx: AdapterContext, cfg: Config): SchedulerHandle {
  const taggingOn = llmTaggingReady(cfg);
  const tagger = taggingOn ? makeAnthropicTagger(cfg) : null;
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // don't overlap ticks
    running = true;
    try {
      const summary = await pollDue(db, ctx);
      if (summary.processed > 0) log("scheduler").debug("tick", summary);
      if (tagger && summary.created > 0) {
        const t = await tagPending(db, tagger, { limit: 200 });
        if (t.tagged > 0) log("scheduler").info("auto-tagged", t);
      }
    } catch (err) {
      log("scheduler").error("tick failed", { err: (err as Error).message });
    } finally {
      running = false;
    }
  };
  const job = new Cron("* * * * *", () => void tick());
  void tick(); // run once at startup
  log("scheduler").info(`scheduler started (polling every minute; llm-tagging=${taggingOn})`);
  return {
    stop(): void {
      job.stop();
    },
  };
}
