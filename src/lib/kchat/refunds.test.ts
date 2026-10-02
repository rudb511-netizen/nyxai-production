import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundStatusLabel, refundWindow, REFUND_WINDOW_MS } from "./refunds.ts";

describe("refund window", () => {
  it("expires 24 hours after purchase and never claims provider confirmation", () => {
    const t = Date.parse("2026-09-15T12:00:00.000Z");
    const open = refundWindow(new Date(t), t + 60_000);
    assert.equal(open.expired, false);
    assert.equal(Date.parse(open.deadline) - t, REFUND_WINDOW_MS);
    const late = refundWindow(new Date(t), t + REFUND_WINDOW_MS + 1);
    assert.equal(late.expired, true);
    assert.match(refundStatusLabel("pending"), /only after the provider confirms/i);
    assert.match(refundStatusLabel("expired"), /expired/i);
  });
});
