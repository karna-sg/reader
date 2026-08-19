// Environment configuration: load .env, validate with zod, expose a typed Config.
// Secrets (ANTHROPIC_API_KEY, REDDIT_CLIENT_SECRET, READER_TOKEN) come from env
// ONLY — never hard-coded, never logged (the logger masks them).
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const boolFromString = z
  .string()
  .transform((s) => s.trim().toLowerCase() === "true")
  .pipe(z.boolean());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  READER_TOKEN: z.string().min(1).optional(),
  DB_PATH: z.string().min(1).default("./data/reader.db"),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  TAG_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  TAG_LLM_ENABLED: boolFromString.default(false),

  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().default("reader-personal/0.1"),

  DEFAULT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  HTTP_USER_AGENT: z.string().default("reader-personal/0.1 (+https://example.invalid/reader)"),

  LOG_LEVEL: z
    .enum(["silly", "trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True once LLM tagging is fully configured (key present + explicitly enabled). */
export function llmTaggingReady(cfg: Config): boolean {
  return cfg.TAG_LLM_ENABLED && Boolean(cfg.ANTHROPIC_API_KEY);
}

/** True once Reddit OAuth is configured (both id + secret present). */
export function redditOAuthReady(cfg: Config): boolean {
  return Boolean(cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET);
}
