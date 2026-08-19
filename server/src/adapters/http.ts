// HTTP fetch helper with conditional GET (ETag/Last-Modified), descriptive
// User-Agent, timeout, and redirect resolution. Uses Node's global fetch
// (undici under the hood). Returns cache validators so the scheduler can store
// them and send If-None-Match / If-Modified-Since next poll.
export interface FetchTextOptions {
  userAgent: string;
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  accept?: string;
  /** Extra headers (e.g. Authorization for Reddit OAuth). */
  headers?: Record<string, string>;
}

export interface FetchTextResult {
  status: number;
  notModified: boolean; // HTTP 304
  ok: boolean;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  finalUrl: string;
  retryAfterMs: number | null;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function browserUserAgent(): string {
  return BROWSER_UA;
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}

export async function fetchText(url: string, opts: FetchTextOptions): Promise<FetchTextResult> {
  const headers: Record<string, string> = {
    "user-agent": opts.userAgent,
    accept: opts.accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    ...opts.headers,
  };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const notModified = res.status === 304;
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    const body = notModified ? null : await res.text();
    return {
      status: res.status,
      notModified,
      ok: res.ok,
      body,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      contentType: res.headers.get("content-type"),
      finalUrl: res.url || url,
      retryAfterMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch JSON (HN Firebase/Algolia, Reddit OAuth). Throws on non-2xx. */
export async function fetchJson<T>(url: string, opts: FetchTextOptions): Promise<T> {
  const res = await fetchText(url, { ...opts, accept: "application/json" });
  if (!res.ok || res.body === null) {
    const err = new Error(`GET ${url} -> ${res.status}`) as Error & {
      status?: number;
      retryAfterMs?: number | null;
    };
    err.status = res.status;
    err.retryAfterMs = res.retryAfterMs;
    throw err;
  }
  return JSON.parse(res.body) as T;
}
