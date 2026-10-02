/** Map internal failures to user-safe errors. Never leak SQL, paths, or secrets. */

const SAFE =
  /couldn.?t|cannot|can’t|not found|slow down|banned|suspended|restricted|empty|blocked|friends|sign in|unauthorized|access|password|available|try again|too large|not allowed|already|expired|verify|pin up to|give the|message this|open this/i;

const LEAK =
  /sql|postgres|pglite|column|relation|syntax|stack|econn|enoent|database|select |insert |update |delete from|\/workspace|\/src\/|api key|bearer |password hash|connection string|not configured on this deployment|smtp|nodemailer|resend/i;

export function publicError(err: unknown, fallback: string): Error {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (raw && SAFE.test(raw) && !LEAK.test(raw)) return new Error(raw);
  if (raw) console.error("[omni-sec]", raw.slice(0, 300));
  return new Error(fallback);
}

export function isResourceId(id: string, prefix?: string): boolean {
  if (!id || id.length > 48) return false;
  if (prefix) return new RegExp(`^${prefix}_[a-f0-9]{24}$`, "i").test(id);
  return /^[a-z]{1,12}_[a-f0-9]{24}$/i.test(id);
}
