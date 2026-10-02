/** Pure live-session helpers. No I/O. */

export function clampHeartBurst(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(30, Math.floor(n)));
}

export function formatLiveDuration(startedAt: string | null | undefined, now = Date.now()): string {
  const t = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(t)) return "0:00";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
