/** Pure streak window math — tested without the database. */

export const STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STREAK_GRACE_MS = 8 * 60 * 60 * 1000;

export type StreakSnap = {
  count: number;
  lastQualifyingAt: number | null;
  aSentAt: number | null;
  bSentAt: number | null;
  freezeUntil: number | null;
};

export function pairSent(snap: StreakSnap, isA: boolean, at: number): StreakSnap {
  const next = { ...snap };
  if (isA) next.aSentAt = at;
  else next.bSentAt = at;

  const a = next.aSentAt;
  const b = next.bSentAt;
  if (a && b) {
    const bothInWindow =
      Math.abs(a - b) <= STREAK_WINDOW_MS &&
      (next.lastQualifyingAt == null ||
        Math.min(a, b) >= next.lastQualifyingAt);
    if (bothInWindow) {
      const alreadyCountedToday =
        next.lastQualifyingAt != null &&
        at - next.lastQualifyingAt < STREAK_WINDOW_MS * 0.5;
      if (!alreadyCountedToday) {
        next.count += 1;
        next.lastQualifyingAt = at;
        next.aSentAt = isA ? at : null;
        next.bSentAt = isA ? null : at;
      }
    }
  }
  return next;
}

export function hoursLeft(snap: StreakSnap, now: number): number | null {
  if (snap.count <= 0 || !snap.lastQualifyingAt) return null;
  if (snap.freezeUntil && now < snap.freezeUntil) {
    return Math.max(0, (snap.freezeUntil - now) / 3_600_000);
  }
  const deadline = snap.lastQualifyingAt + STREAK_WINDOW_MS + STREAK_GRACE_MS;
  return Math.max(0, (deadline - now) / 3_600_000);
}

export function isBroken(snap: StreakSnap, now: number): boolean {
  if (snap.count <= 0 || !snap.lastQualifyingAt) return false;
  if (snap.freezeUntil && now < snap.freezeUntil) return false;
  return now > snap.lastQualifyingAt + STREAK_WINDOW_MS + STREAK_GRACE_MS;
}
