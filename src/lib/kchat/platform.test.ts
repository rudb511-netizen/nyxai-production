import assert from "node:assert/strict";
import test from "node:test";
import {
  clipBounds,
  feedScore,
  hashSource,
  inRollout,
  isInterestTag,
  NYX_INTERESTS,
} from "./platform.ts";

test("interest catalog has unique tags", () => {
  const tags = NYX_INTERESTS.map((i) => i.tag);
  assert.equal(new Set(tags).size, tags.length);
  assert.equal(isInterestTag("music"), true);
  assert.equal(isInterestTag("not-a-topic"), false);
});

test("feedScore boosts follows, interests, and recency", () => {
  const stale = feedScore({ likes: 10, comments: 2, recencyHours: 70, following: false, interestHits: 0 });
  const fresh = feedScore({ likes: 10, comments: 2, recencyHours: 1, following: false, interestHits: 0 });
  const followed = feedScore({ likes: 10, comments: 2, recencyHours: 1, following: true, interestHits: 0 });
  const topical = feedScore({ likes: 10, comments: 2, recencyHours: 1, following: false, interestHits: 2 });
  assert.ok(fresh > stale);
  assert.ok(followed > fresh);
  assert.ok(topical > fresh);
});

test("inRollout is deterministic and honors 0/100", () => {
  assert.equal(inRollout("user_a", 0), false);
  assert.equal(inRollout("user_a", 100), true);
  const a = inRollout("abc", 50);
  const b = inRollout("abc", 50);
  assert.equal(a, b);
});

test("clipBounds rejects invalid ranges", () => {
  assert.equal(clipBounds(0, 500, 10_000), null);
  assert.equal(clipBounds(0, 90_000, 120_000), null);
  assert.equal(clipBounds(8_000, 4_000, 20_000), null);
  assert.deepEqual(clipBounds(1000, 4000, 10_000), { start: 1000, end: 4000 });
});

test("hashSource is stable", () => {
  assert.equal(hashSource("hello"), hashSource("hello"));
  assert.notEqual(hashSource("hello"), hashSource("world"));
});
