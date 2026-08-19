// Per-feed liveness / format-drift probe. Feed endpoints drift (404, redirect,
// format change); the CLI `probe` command runs this over seeds so we log drift
// instead of silently trusting hard-coded URLs.
import { parseFeed } from "feedsmith";
import { fetchText } from "./http.js";

export interface ProbeResult {
  url: string;
  ok: boolean;
  status: number;
  format: string | null;
  itemCount: number;
  contentType: string | null;
  finalUrl: string | null;
  redirected: boolean;
  error: string | null;
}

export async function probeFeed(url: string, userAgent: string, timeoutMs = 15_000): Promise<ProbeResult> {
  try {
    const res = await fetchText(url, { userAgent, timeoutMs });
    const redirected = res.finalUrl !== url;
    if (!res.ok || !res.body) {
      return {
        url,
        ok: false,
        status: res.status,
        format: null,
        itemCount: 0,
        contentType: res.contentType,
        finalUrl: res.finalUrl,
        redirected,
        error: `HTTP ${res.status}`,
      };
    }
    const parsed = parseFeed(res.body) as {
      format: string;
      feed: { items?: unknown[]; entries?: unknown[] };
    };
    const count = (parsed.feed.items ?? parsed.feed.entries ?? []).length;
    return {
      url,
      ok: count > 0,
      status: res.status,
      format: parsed.format,
      itemCount: count,
      contentType: res.contentType,
      finalUrl: res.finalUrl,
      redirected,
      error: count > 0 ? null : "parsed but 0 items",
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: 0,
      format: null,
      itemCount: 0,
      contentType: null,
      finalUrl: null,
      redirected: false,
      error: (err as Error).message,
    };
  }
}
