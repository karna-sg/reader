// Full-text extraction for feeds that carry only excerpts. `extract` fetches the
// article and runs Mozilla Readability over a linkedom DOM. `render` (JS-heavy)
// falls back to the hosted Jina Reader (r.jina.ai). Returns null on failure so
// the caller keeps the feed excerpt.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { FullTextPolicy } from "../db/schema.js";
import { htmlToText, sanitizeHtml } from "../util/html.js";
import { browserUserAgent, fetchText } from "./http.js";
import type { ExtractResult } from "./types.js";
import { log } from "../logging/logger.js";

const MIN_EXTRACT_CHARS = 200;

export interface ExtractDeps {
  userAgent: string;
  timeoutMs: number;
}

export function makeExtractor(deps: ExtractDeps) {
  return async function extract(url: string, policy: FullTextPolicy): Promise<ExtractResult | null> {
    if (policy === "excerpt") return null;
    if (!/^https?:\/\//i.test(url)) return null;

    if (policy === "extract") {
      const viaReadability = await readabilityExtract(url, deps);
      if (viaReadability) return viaReadability;
      // fall through to render fallback if readability came up short
    }
    return jinaExtract(url, deps);
  };
}

async function readabilityExtract(url: string, deps: ExtractDeps): Promise<ExtractResult | null> {
  try {
    const res = await fetchText(url, {
      userAgent: browserUserAgent(),
      accept: "text/html,application/xhtml+xml",
      timeoutMs: deps.timeoutMs,
    });
    if (!res.ok || !res.body) return null;
    const { document } = parseHTML(res.body);
    const article = new Readability(document as unknown as Document).parse();
    const text = htmlToText(article?.content ?? null) || (article?.textContent ?? "").trim();
    if (!article || text.length < MIN_EXTRACT_CHARS) return null;
    return {
      body_html: sanitizeHtml(article.content),
      body_text: text,
      tier: "extract",
    };
  } catch (err) {
    log("extract").debug("readability failed", { url, err: (err as Error).message });
    return null;
  }
}

async function jinaExtract(url: string, deps: ExtractDeps): Promise<ExtractResult | null> {
  try {
    const res = await fetchText(`https://r.jina.ai/${url}`, {
      userAgent: deps.userAgent,
      accept: "text/plain, text/markdown, */*",
      timeoutMs: deps.timeoutMs,
    });
    if (!res.ok || !res.body) return null;
    const text = res.body.replace(/\s+\n/g, "\n").trim();
    if (text.length < MIN_EXTRACT_CHARS) return null;
    return { body_html: null, body_text: text, tier: "render" };
  } catch (err) {
    log("extract").debug("jina failed", { url, err: (err as Error).message });
    return null;
  }
}
