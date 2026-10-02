import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hoursLeft, isBroken, pairSent, STREAK_WINDOW_MS } from "./streaks.ts";

describe("streaks", () => {
  it("increments when both sides send", () => {
    const t0 = 1_700_000_000_000;
    let s = {
      count: 0,
      lastQualifyingAt: null as number | null,
      aSentAt: null as number | null,
      bSentAt: null as number | null,
      freezeUntil: null as number | null,
    };
    s = pairSent(s, true, t0);
    assert.equal(s.count, 0);
    s = pairSent(s, false, t0 + 60_000);
    assert.equal(s.count, 1);
  });

  it("breaks after the window + grace", () => {
    const t0 = 1_700_000_000_000;
    const s = {
      count: 3,
      lastQualifyingAt: t0,
      aSentAt: t0,
      bSentAt: t0,
      freezeUntil: null as number | null,
    };
    assert.equal(isBroken(s, t0 + STREAK_WINDOW_MS), false);
    assert.equal(isBroken(s, t0 + STREAK_WINDOW_MS + 9 * 3600_000), true);
    assert.ok((hoursLeft(s, t0 + 1000) ?? 0) > 0);
  });
});
