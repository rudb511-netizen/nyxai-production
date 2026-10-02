/** Pure helpers for NYX platform ranking, flags, clips, and interests. */

export type FeedTab = "foryou" | "following" | "friends" | "trending";

export const FEED_TABS: { id: FeedTab; label: string }[] = [
  { id: "foryou", label: "For You" },
  { id: "following", label: "Following" },
  { id: "friends", label: "Friends" },
  { id: "trending", label: "Trending" },
];

export const NYX_INTERESTS = [
  { tag: "music", label: "Music" },
  { tag: "sports", label: "Sports" },
  { tag: "gaming", label: "Gaming" },
  { tag: "anime", label: "Anime" },
  { tag: "tech", label: "Technology" },
  { tag: "education", label: "Education" },
  { tag: "comedy", label: "Comedy" },
  { tag: "fashion", label: "Fashion" },
  { tag: "food", label: "Food" },
  { tag: "travel", label: "Travel" },
  { tag: "art", label: "Art" },
  { tag: "news", label: "News" },
  { tag: "business", label: "Business" },
  { tag: "health", label: "Health" },
  { tag: "film", label: "Film" },
  { tag: "creators", label: "Creators" },
] as const;

export type InterestTag = (typeof NYX_INTERESTS)[number]["tag"];

export function isInterestTag(v: string): v is InterestTag {
  return NYX_INTERESTS.some((i) => i.tag === v);
}

export function feedScore(opts: {
  likes: number;
  comments: number;
  recencyHours: number;
  following: boolean;
  interestHits: number;
}): number {
  const engagement = Math.max(0, opts.likes) * 2 + Math.max(0, opts.comments) * 3;
  const recency = Math.max(0, 72 - Math.max(0, opts.recencyHours)) / 72;
  const follow = opts.following ? 10 : 0;
  const interest = Math.max(0, opts.interestHits) * 5;
  return engagement * (0.35 + recency * 0.65) + follow + interest;
}

export function inRollout(userId: string, percent: number): boolean {
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  if (p >= 100) return true;
  if (p <= 0) return false;
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100 < p;
}

export function clipBounds(startMs: number, endMs: number, durationMs: number | null): { start: number; end: number } | null {
  const start = Math.max(0, Math.floor(startMs));
  const end = Math.floor(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (end - start < 1_000) return null;
  if (end - start > 60_000) return null;
  if (durationMs != null && end > durationMs + 250) return null;
  return { start, end };
}

export function hashSource(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export const FOCUS_MUTED_KINDS = new Set([
  "like",
  "comment",
  "follow",
  "repost",
  "live",
  "story",
  "streak",
]);
