import assert from "node:assert/strict";
import test from "node:test";
import { clampHeartBurst, formatLiveDuration } from "./live-session.ts";
import { appendHashtag, removeHashtag, seedDefaultTags, tagsFromText } from "./graph.ts";

test("clampHeartBurst rejects floods and junk", () => {
  assert.equal(clampHeartBurst(1), 1);
  assert.equal(clampHeartBurst(30), 30);
  assert.equal(clampHeartBurst(500), 30);
  assert.equal(clampHeartBurst(0), 0);
  assert.equal(clampHeartBurst(-4), 0);
  assert.equal(clampHeartBurst(Number.NaN), 0);
  assert.equal(clampHeartBurst(2.9), 2);
});

test("formatLiveDuration is a clock, not a fake counter", () => {
  const start = "2026-09-23T08:00:00.000Z";
  const now = new Date("2026-09-23T08:01:05.000Z").getTime();
  assert.equal(formatLiveDuration(start, now), "1:05");
  assert.equal(formatLiveDuration(start, new Date("2026-09-23T09:00:00.000Z").getTime()), "1:00:00");
  assert.equal(formatLiveDuration("", now), "0:00");
});

test("default hashtags are editable and not reinserted", () => {
  assert.equal(seedDefaultTags(""), "#Nyx #krdx ");
  assert.equal(seedDefaultTags("  "), "#Nyx #krdx ");
  assert.equal(seedDefaultTags("hello"), "hello");
  const seeded = seedDefaultTags("");
  const removed = removeHashtag(seeded, "Nyx");
  assert.deepEqual(tagsFromText(removed), ["krdx"]);
  assert.equal(seedDefaultTags(removed), removed);
  const added = appendHashtag(removed, "#music");
  assert.deepEqual(tagsFromText(added), ["krdx", "music"]);
  assert.equal(appendHashtag(added, "MUSIC"), added);
});
