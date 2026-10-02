type Bucket = { count: number; resetAt: number };

const globalRef = globalThis as typeof globalThis & {
  __kchatRate__?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  globalRef.__kchatRate__ ??= new Map();
  return globalRef.__kchatRate__;
}

/** Sliding fixed-window limiter. Returns remaining wait ms, or 0 if allowed. */
export function takeToken(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  const buckets = store();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  if (cur.count >= limit) return cur.resetAt - now;
  cur.count += 1;
  return 0;
}

export function rateError(waitMs: number): string {
  const s = Math.ceil(waitMs / 1000);
  return `Slow down — try again in ${s}s.`;
}
