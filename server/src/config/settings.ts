// DB-backed runtime settings. These override the env defaults and are applied
// live (the scheduler/CLI read effectiveConfig on each run), so the app can
// change integrations without editing .env or restarting the server.
// Secrets are stored here but never returned by the API (write-only).
import type { Db } from "../db/db.js";
import type { Config } from "./env.js";

/** The runtime-relevant, resolved config (DB setting → else env default). */
export interface EffectiveConfig {
  httpUserAgent: string;
  redditUserAgent: string;
  redditClientId: string | null;
  redditClientSecret: string | null;
  anthropicApiKey: string | null;
  tagModel: string;
  tagLlmEnabled: boolean;
  defaultPollIntervalMs: number;
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.raw.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** Upsert a setting; an empty/undefined value deletes it (falls back to env). */
export function setSetting(db: Db, key: string, value: string | null | undefined): void {
  if (value === null || value === undefined || value === "") {
    db.raw.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  db.raw
    .prepare(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function effectiveConfig(db: Db, env: Config): EffectiveConfig {
  const s = (k: string): string | null => getSetting(db, k);
  const enabledRaw = s("tag_llm_enabled");
  return {
    httpUserAgent: s("http_user_agent") ?? env.HTTP_USER_AGENT,
    redditUserAgent: s("reddit_user_agent") ?? env.REDDIT_USER_AGENT,
    redditClientId: s("reddit_client_id") ?? env.REDDIT_CLIENT_ID ?? null,
    redditClientSecret: s("reddit_client_secret") ?? env.REDDIT_CLIENT_SECRET ?? null,
    anthropicApiKey: s("anthropic_api_key") ?? env.ANTHROPIC_API_KEY ?? null,
    tagModel: s("tag_model") ?? env.TAG_MODEL,
    tagLlmEnabled: enabledRaw !== null ? enabledRaw === "true" : env.TAG_LLM_ENABLED,
    defaultPollIntervalMs: Number(s("default_poll_interval_ms") ?? env.DEFAULT_POLL_INTERVAL_MS),
  };
}

export function llmReady(eff: EffectiveConfig): boolean {
  return eff.tagLlmEnabled && Boolean(eff.anthropicApiKey);
}

export function redditConfigured(eff: EffectiveConfig): boolean {
  return Boolean(eff.redditClientId && eff.redditClientSecret);
}

/** Non-secret settings view the API returns (secrets shown as booleans only). */
export interface PublicSettings {
  reddit_configured: boolean;
  reddit_user_agent: string;
  anthropic_configured: boolean;
  tag_model: string;
  tag_llm_enabled: boolean;
  http_user_agent: string;
  default_poll_interval_ms: number;
}

export function publicSettings(db: Db, env: Config): PublicSettings {
  const eff = effectiveConfig(db, env);
  return {
    reddit_configured: redditConfigured(eff),
    reddit_user_agent: eff.redditUserAgent,
    anthropic_configured: Boolean(eff.anthropicApiKey),
    tag_model: eff.tagModel,
    tag_llm_enabled: eff.tagLlmEnabled,
    http_user_agent: eff.httpUserAgent,
    default_poll_interval_ms: eff.defaultPollIntervalMs,
  };
}

/** Map an incoming settings PATCH (from the app) to setting keys. Only provided
 *  fields are written; secrets omitted when undefined, cleared when "". */
export interface SettingsPatch {
  reddit_client_id?: string;
  reddit_client_secret?: string;
  reddit_user_agent?: string;
  anthropic_api_key?: string;
  tag_model?: string;
  tag_llm_enabled?: boolean;
  http_user_agent?: string;
  default_poll_interval_ms?: number;
}

export function applySettingsPatch(db: Db, patch: SettingsPatch): void {
  if (patch.reddit_client_id !== undefined) setSetting(db, "reddit_client_id", patch.reddit_client_id);
  if (patch.reddit_client_secret !== undefined) setSetting(db, "reddit_client_secret", patch.reddit_client_secret);
  if (patch.reddit_user_agent !== undefined) setSetting(db, "reddit_user_agent", patch.reddit_user_agent);
  if (patch.anthropic_api_key !== undefined) setSetting(db, "anthropic_api_key", patch.anthropic_api_key);
  if (patch.tag_model !== undefined) setSetting(db, "tag_model", patch.tag_model);
  if (patch.tag_llm_enabled !== undefined) setSetting(db, "tag_llm_enabled", String(patch.tag_llm_enabled));
  if (patch.http_user_agent !== undefined) setSetting(db, "http_user_agent", patch.http_user_agent);
  if (patch.default_poll_interval_ms !== undefined)
    setSetting(db, "default_poll_interval_ms", String(patch.default_poll_interval_ms));
}
