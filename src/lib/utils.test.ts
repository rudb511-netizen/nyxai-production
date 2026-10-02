import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboxTime } from "./utils.ts";

describe("inboxTime", () => {
  it("shows a clock for today", () => {
    const now = new Date();
    const out = inboxTime(now);
    assert.ok(/\d/.test(out), out);
    assert.notEqual(out, "Yesterday");
  });

  it("labels yesterday", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(15, 0, 0, 0);
    assert.equal(inboxTime(d), "Yesterday");
  });

  it("uses a date for older messages", () => {
    const d = new Date(2024, 0, 15, 12, 0, 0);
    const out = inboxTime(d);
    assert.ok(/Jan/i.test(out), out);
    assert.ok(/15/.test(out), out);
  });

  it("handles empty", () => {
    assert.equal(inboxTime(null), "");
    assert.equal(inboxTime(undefined), "");
  });
});
