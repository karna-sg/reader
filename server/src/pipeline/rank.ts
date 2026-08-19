// Per-item ranking. Combines source authority, normalized engagement, label
// confidence, and HN-gravity recency decay. Computed at read time because the
// recency term is time-dependent.
//
//   score = authority
//         × (1 + log10(1 + points + 2·comments))   -- engagement (null→0→term=1)
//         × confidence                               -- label tag relevance 0..1
//         ÷ (age_hours + 2) ^ 1.5                     -- HN gravity decay
import type { FeedCandidate } from "../store/items.js";

const HOUR_MS = 3_600_000;

export function scoreCandidate(c: FeedCandidate, now: number): number {
  const points = (c.hn_points ?? 0) + (c.reddit_upvotes ?? 0);
  const comments = (c.hn_comments ?? 0) + (c.reddit_comments ?? 0);
  const engagement = 1 + Math.log10(1 + Math.max(0, points) + 2 * Math.max(0, comments));
  const publishedAt = c.published_at ?? c.fetched_at;
  const ageHours = Math.max(0, (now - publishedAt) / HOUR_MS);
  const decay = Math.pow(ageHours + 2, 1.5);
  const authority = c.authority > 0 ? c.authority : 0.5;
  const confidence = c.confidence > 0 ? c.confidence : 0.5;
  return (authority * engagement * confidence) / decay;
}

export type SortMode = "score" | "new";

/** Rank candidates in place-safe copy; returns a new sorted array. */
export function rankCandidates(
  candidates: FeedCandidate[],
  now: number,
  sort: SortMode = "score",
): { candidate: FeedCandidate; score: number }[] {
  const scored = candidates.map((candidate) => ({ candidate, score: scoreCandidate(candidate, now) }));
  if (sort === "new") {
    scored.sort(
      (a, b) =>
        (b.candidate.published_at ?? b.candidate.fetched_at) -
        (a.candidate.published_at ?? a.candidate.fetched_at),
    );
  } else {
    scored.sort((a, b) => b.score - a.score);
  }
  return scored;
}
