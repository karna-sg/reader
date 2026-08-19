// Structured logging via tslog, with native masking of secret-shaped values so
// a token/key never lands in logs. Mirrors the openclaw logging convention.
import { Logger } from "tslog";

const SECRET_KEYS = [
  "token",
  "reader_token",
  "apikey",
  "api_key",
  "anthropic_api_key",
  "secret",
  "client_secret",
  "reddit_client_secret",
  "password",
  "authorization",
  "bearer",
];
const SECRET_VALUE_RES = [
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /sk-[A-Za-z0-9._-]{16,}/g, // anthropic-style keys
  /\b[A-Za-z0-9_-]{24,}\b/g, // long opaque tokens
];

const MASK = "[REDACTED:secret-shaped]";

/**
 * Recursively redact secret-shaped keys/values from an arbitrary value.
 * Used when we forward data outside tslog (e.g. HTTP error bodies).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") {
    let s = value;
    for (const re of SECRET_VALUE_RES) s = s.replace(re, MASK);
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? MASK : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const LEVEL_NUM: Record<LogLevel, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

let root: Logger<unknown> | undefined;

export function initLogger(level: LogLevel): void {
  root = new Logger({
    name: "reader",
    minLevel: LEVEL_NUM[level],
    type: "pretty",
    hideLogPositionForProduction: true,
    maskValuesOfKeys: SECRET_KEYS,
    maskValuesOfKeysCaseInsensitive: true,
    maskPlaceholder: MASK,
    maskValuesRegEx: SECRET_VALUE_RES,
  });
}

/** Get (lazily initializing at info) the app logger, optionally sub-scoped. */
export function log(scope?: string): Logger<unknown> {
  if (!root) initLogger("info");
  const base = root as Logger<unknown>;
  return scope ? base.getSubLogger({ name: scope }) : base;
}
