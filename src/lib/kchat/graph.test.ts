import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidE164,
  liveKindOk,
  normalizeHighlightName,
  normalizeListName,
  normalizeTag,
  parseScheduleAt,
  scheduleWindowOk,
  sixDigitOtp,
  visibilityOk,
  websiteOk,
} from "./graph.ts";

test("normalizeListName trims and caps", () => {
  assert.equal(normalizeListName("  Close   circle  "), "Close circle");
  assert.equal(normalizeListName("x".repeat(80)).length, 40);
});

test("normalizeTag strips hash and punctuation", () => {
  assert.equal(normalizeTag("#Music!"), "music");
  assert.equal(normalizeTag("  NYX_AI  "), "nyx_ai");
});

test("scheduleWindowOk rejects past and far-future", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  assert.ok(scheduleWindowOk(new Date("2026-09-19T12:00:10Z"), now));
  assert.equal(scheduleWindowOk(new Date("2026-09-19T12:05:00Z"), now), null);
  assert.ok(scheduleWindowOk(new Date("2027-09-19T12:00:00Z"), now));
});

test("parseScheduleAt accepts ISO in window", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const d = parseScheduleAt("2026-09-19T13:00:00Z", now);
  assert.ok(d);
  assert.equal(d!.toISOString(), "2026-09-19T13:00:00.000Z");
});

test("e164 and website validation", () => {
  assert.equal(isValidE164("+2348012345678"), true);
  assert.equal(isValidE164("08012345678"), false);
  assert.ok(websiteOk("nyx.app")?.includes("https://nyx.app"));
  assert.equal(websiteOk("javascript:alert(1)"), null);
});

test("sixDigitOtp is always 6 digits", () => {
  const code = sixDigitOtp(new Uint8Array([1, 2, 3]));
  assert.equal(code.length, 6);
  assert.match(code, /^\d{6}$/);
});

test("visibility and live kind guards", () => {
  assert.equal(visibilityOk("followers"), true);
  assert.equal(visibilityOk("secret"), false);
  assert.equal(liveKindOk("audio"), true);
  assert.equal(liveKindOk("space"), false);
});

test("highlight names are trimmed", () => {
  assert.equal(normalizeHighlightName("  Travel  "), "Travel");
});
