import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDistance,
  groupAlbums,
  haversineKm,
  isMessageKind,
  isMutedAt,
  messagePreview,
  muteUntilFrom,
  normalizeClientId,
  parseExtra,
  validateLocation,
  validatePoll,
  validateScheduleAt,
} from "./comms-extra.ts";

describe("comms extras", () => {
  it("accepts known message kinds", () => {
    assert.equal(isMessageKind("text"), true);
    assert.equal(isMessageKind("poll"), true);
    assert.equal(isMessageKind("sticker"), true);
    assert.equal(isMessageKind("flash"), false);
  });

  it("validates polls", () => {
    const p = validatePoll({ question: "Lunch?", options: [{ text: "Yes" }, { text: "No" }] });
    assert.equal(p.options.length, 2);
    assert.throws(() => validatePoll({ question: "x", options: [{ text: "only" }] }));
  });

  it("validates quiz polls", () => {
    assert.throws(() =>
      validatePoll({
        question: "Capital?",
        options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
        quiz: true,
      }),
    );
    const q = validatePoll({
      question: "Capital?",
      options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
      quiz: true,
      correctOptionId: "a",
    });
    assert.equal(q.correctOptionId, "a");
    assert.equal(q.multiple, false);
  });

  it("validates coordinates", () => {
    const loc = validateLocation({ lat: 6.5244, lng: 3.3792, liveMs: 60_000 });
    assert.equal(loc.liveMs, 60_000);
    assert.throws(() => validateLocation({ lat: 100, lng: 0 }));
  });

  it("computes mute expiry", () => {
    const until = muteUntilFrom("1h", 0);
    assert.ok(until instanceof Date);
    assert.equal((until as Date).getTime(), 3_600_000);
    assert.equal(muteUntilFrom("forever", 0), null);
    assert.equal(isMutedAt(false, new Date(Date.now() + 10_000).toISOString()), true);
    assert.equal(isMutedAt(false, new Date(Date.now() - 10_000).toISOString()), false);
    assert.equal(isMutedAt(true, null), true);
  });

  it("rejects past schedules", () => {
    assert.throws(() => validateScheduleAt(new Date(Date.now() - 1000).toISOString()));
    const ok = validateScheduleAt(new Date(Date.now() + 120_000).toISOString());
    assert.ok(ok);
  });

  it("parses extra json", () => {
    const extra = parseExtra({ location: { lat: 1, lng: 2 } });
    assert.equal(extra?.location?.lat, 1);
    assert.equal(parseExtra("nope"), null);
  });

  it("previews kinds", () => {
    assert.equal(messagePreview("poll", "", { poll: { question: "Hi?", options: [] } }), "Poll · Hi?");
    assert.equal(messagePreview("sticker", "", { sticker: { packId: "p", stickerId: "s", emoji: "✦", name: "Spark" } }), "Spark");
  });

  it("groups albums and distances", () => {
    const groups = groupAlbums([
      { albumId: "a" },
      { albumId: "a" },
      { albumId: null },
      { albumId: "b" },
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0]!.length, 2);
    const km = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    assert.ok(km > 100 && km < 120);
    assert.ok(formatDistance(0.05).includes("m"));
  });

  it("normalizes client ids", () => {
    assert.equal(normalizeClientId("c_abcdefgh"), "c_abcdefgh");
    assert.equal(normalizeClientId("x"), null);
  });
});
