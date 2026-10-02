import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanText, warningTier } from "./moderation.ts";

describe("scanText", () => {
  it("lets ordinary posts through", () => {
    assert.equal(scanText("Sunset from the roof. Who's around later?"), null);
    assert.equal(scanText("I hate Mondays and this weather."), null);
  });

  it("flags a direct threat", () => {
    const h = scanText("I will kill you tomorrow.");
    assert.ok(h);
    assert.equal(h!.category, "violence");
    assert.equal(h!.severity, "high");
  });

  it("flags scam copy", () => {
    const h = scanText("Wire me bitcoin for a guaranteed investment");
    assert.ok(h);
    assert.equal(h!.category, "scam");
  });

  it("flags link spam", () => {
    const h = scanText("http://a.com http://b.com http://c.com http://d.com http://e.com buy now");
    assert.ok(h);
    assert.equal(h!.category, "spam");
  });

  it("flags harassment baiting", () => {
    const h = scanText("kys loser");
    assert.ok(h);
    assert.equal(h!.category, "harassment");
  });
});

describe("warningTier", () => {
  it("caps at three", () => {
    assert.equal(warningTier(0), 0);
    assert.equal(warningTier(1), 1);
    assert.equal(warningTier(2), 2);
    assert.equal(warningTier(9), 3);
  });
});
