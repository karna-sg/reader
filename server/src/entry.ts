// Reader server CLI. Commands: serve (HTTP + scheduler), poll (one-shot fetch),
// probe (feed liveness), import-opml (bulk source import).
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import { getConfig, llmTaggingReady } from "./config/env.js";
import { initLogger, log } from "./logging/logger.js";
import { openDb } from "./db/db.js";
import "./adapters/registry.js"; // registers adapters
import { buildAdapterContext } from "./pipeline/context.js";
import { pollAll, pollDue, startScheduler } from "./scheduler/scheduler.js";
import { buildApp } from "./http/app.js";
import { probeFeed } from "./adapters/probe.js";
import { parseOpmlToSpecs } from "./adapters/opml.js";
import { countSources, listAllSources, upsertSource } from "./store/sources.js";
import { importSourceSpecs } from "./store/seed-sources.js";
import { makeAnthropicTagger, tagPending } from "./pipeline/tag.js";

const program = new Command();
program.name("reader").description("Personal knowledge-aggregator backend").version("0.1.0");

program
  .command("serve")
  .description("Run the HTTP API and the polling scheduler")
  .action(() => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    const logger = log("serve");
    const db = openDb(cfg.DB_PATH);
    if (!cfg.READER_TOKEN) {
      logger.warn("READER_TOKEN is not set — the API is UNAUTHENTICATED (dev mode only).");
    }
    const ctx = buildAdapterContext(cfg);
    const scheduler = startScheduler(db, ctx, cfg);
    const app = buildApp(db, cfg);
    const server = serve({ fetch: app.fetch, port: cfg.PORT });
    logger.info(`Reader API listening on http://localhost:${cfg.PORT} (${countSources(db)} sources)`);
    const shutdown = (): void => {
      logger.info("shutting down…");
      scheduler.stop();
      server.close();
      db.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("poll")
  .description("Fetch sources once and exit")
  .option("--all", "poll every enabled source, ignoring the poll interval")
  .action(async (opts: { all?: boolean }) => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    const db = openDb(cfg.DB_PATH);
    const ctx = buildAdapterContext(cfg);
    const summary = opts.all ? await pollAll(db, ctx) : await pollDue(db, ctx);
    log("poll").info("poll complete", summary);
    db.close();
  });

program
  .command("tag")
  .description("Run the Claude Haiku auto-tagging pass over untagged items")
  .option("--limit <n>", "max items to tag", "100")
  .action(async (opts: { limit: string }) => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    if (!llmTaggingReady(cfg)) {
      log("tag").warn("LLM tagging not enabled — set ANTHROPIC_API_KEY and TAG_LLM_ENABLED=true");
      return;
    }
    const db = openDb(cfg.DB_PATH);
    const tagger = makeAnthropicTagger(cfg);
    const result = await tagPending(db, tagger, { limit: Number(opts.limit) || 100 });
    log("tag").info("tagging complete", result);
    db.close();
  });

program
  .command("import-sources")
  .description("Import a JSON array of structured sources (HN/Reddit/YouTube/arXiv/GitHub)")
  .argument("<jsonFile>", "JSON file of source specs")
  .action(async (jsonFile: string) => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    const db = openDb(cfg.DB_PATH);
    const { imported } = importSourceSpecs(db, await readFile(jsonFile, "utf8"), cfg.DEFAULT_POLL_INTERVAL_MS);
    log("import").info(`imported ${imported} structured sources`);
    db.close();
  });

program
  .command("probe")
  .description("Check feed liveness/format for an OPML file or the DB's sources")
  .argument("[opmlFile]", "OPML file to probe (defaults to configured sources)")
  .action(async (opmlFile: string | undefined) => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    const urls: { title: string; url: string }[] = [];
    if (opmlFile) {
      const specs = parseOpmlToSpecs(await readFile(opmlFile, "utf8"));
      for (const s of specs) urls.push({ title: s.title, url: String((s.config as { feed_url?: string }).feed_url) });
    } else {
      const db = openDb(cfg.DB_PATH);
      for (const s of listAllSources(db)) {
        const u = (s.config as { feed_url?: string; atom_url?: string; rss_url?: string });
        const url = u.feed_url ?? u.atom_url ?? u.rss_url;
        if (url) urls.push({ title: s.title, url });
      }
      db.close();
    }
    let ok = 0;
    let bad = 0;
    for (const { title, url } of urls) {
      const r = await probeFeed(url, cfg.HTTP_USER_AGENT);
      const flag = r.ok ? "OK " : "BAD";
      if (r.ok) ok++;
      else bad++;
      const note = r.redirected ? ` (redirected → ${r.finalUrl})` : "";
      process.stdout.write(
        `${flag}  ${String(r.status).padStart(3)}  ${r.format ?? "-"}  items=${String(r.itemCount).padStart(3)}  ${title}${r.error ? `  [${r.error}]` : ""}${note}\n`,
      );
    }
    process.stdout.write(`\n${ok} ok, ${bad} bad, ${urls.length} total\n`);
  });

program
  .command("import-opml")
  .description("Import an OPML subscription list into sources")
  .argument("<opmlFile>", "OPML file to import")
  .action(async (opmlFile: string) => {
    const cfg = getConfig();
    initLogger(cfg.LOG_LEVEL);
    const db = openDb(cfg.DB_PATH);
    const specs = parseOpmlToSpecs(await readFile(opmlFile, "utf8"));
    for (const s of specs) upsertSource(db, s, cfg.DEFAULT_POLL_INTERVAL_MS);
    log("import").info(`imported ${specs.length} sources`);
    db.close();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
