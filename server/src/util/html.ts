// Minimal HTML helpers built on linkedom (already a dependency for readability).
// htmlToText strips markup for hashing/search/reader body_text; sanitizeHtml
// removes active content so stored body_html is safe to render.
import { parseHTML } from "linkedom";

const DANGEROUS = ["script", "style", "iframe", "object", "embed", "noscript", "template"];

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return "";
  // Drop non-content elements so their text (e.g. inline script) never leaks.
  for (const tag of DANGEROUS) {
    for (const el of Array.from(body.querySelectorAll(tag))) el.remove();
  }
  return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return "";
  for (const tag of DANGEROUS) {
    for (const el of Array.from(body.querySelectorAll(tag))) el.remove();
  }
  // Strip inline event handlers and javascript: URLs.
  for (const el of Array.from(body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value ?? "";
      if (name.startsWith("on") || (/^(href|src)$/.test(name) && /^\s*javascript:/i.test(value))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return body.innerHTML.trim();
}

/** First non-empty string from candidates, else null. */
export function firstText(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Parse an RFC-822 or ISO-8601 date string to epoch ms, or null. */
export function parseDateMs(input: string | null | undefined): number | null {
  if (!input) return null;
  const t = Date.parse(input);
  return Number.isFinite(t) ? t : null;
}
