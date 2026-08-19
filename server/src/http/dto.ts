// Shape store rows into the JSON the iOS app consumes. Engagement is unified to
// points/comments for display ("Hacker News · 412 pts · 208 comments · 2h").
import type { FeedCandidate, ItemLabelRow, ItemWithSource } from "../store/items.js";

export interface FeedItemDto {
  id: string;
  title: string;
  url: string;
  source_id: string;
  source_kind: string;
  source_title: string;
  author: string | null;
  published_at: number | null;
  fetched_at: number;
  body_tier: string;
  points: number | null;
  comments: number | null;
  read: boolean;
  bookmarked: boolean;
  score: number | null;
}

function unifiedPoints(r: { hn_points: number | null; reddit_upvotes: number | null }): number | null {
  if (r.hn_points !== null) return r.hn_points;
  if (r.reddit_upvotes !== null) return r.reddit_upvotes;
  return null;
}
function unifiedComments(r: { hn_comments: number | null; reddit_comments: number | null }): number | null {
  if (r.hn_comments !== null) return r.hn_comments;
  if (r.reddit_comments !== null) return r.reddit_comments;
  return null;
}

export function feedItemDto(c: FeedCandidate, score: number | null): FeedItemDto {
  return {
    id: c.id,
    title: c.title,
    url: c.url,
    source_id: c.source_id,
    source_kind: c.source_kind,
    source_title: c.source_title,
    author: c.author,
    published_at: c.published_at,
    fetched_at: c.fetched_at,
    body_tier: c.body_tier,
    points: unifiedPoints(c),
    comments: unifiedComments(c),
    read: c.read_at !== null,
    bookmarked: c.bookmarked_at !== null,
    score,
  };
}

export interface ItemDetailDto extends FeedItemDto {
  body_html: string | null;
  body_text: string | null;
  canonical_url: string;
  label_ids: string[];
  labels: { label_id: string; confidence: number; origin: string }[];
}

export function itemDetailDto(r: ItemWithSource, labels: ItemLabelRow[]): ItemDetailDto {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    canonical_url: r.canonical_url,
    source_id: r.source_id,
    source_kind: r.source_kind,
    source_title: r.source_title,
    author: r.author,
    published_at: r.published_at,
    fetched_at: r.fetched_at,
    body_tier: r.body_tier,
    body_html: r.body_html,
    body_text: r.body_text,
    points: unifiedPoints(r),
    comments: unifiedComments(r),
    read: r.read_at !== null,
    bookmarked: r.bookmarked_at !== null,
    score: null,
    label_ids: labels.map((l) => l.label_id),
    labels: labels.map((l) => ({ label_id: l.label_id, confidence: l.confidence, origin: l.origin })),
  };
}

export function searchItemDto(r: ItemWithSource): FeedItemDto {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    source_id: r.source_id,
    source_kind: r.source_kind,
    source_title: r.source_title,
    author: r.author,
    published_at: r.published_at,
    fetched_at: r.fetched_at,
    body_tier: r.body_tier,
    points: unifiedPoints(r),
    comments: unifiedComments(r),
    read: r.read_at !== null,
    bookmarked: r.bookmarked_at !== null,
    score: null,
  };
}
