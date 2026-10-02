import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAMERA_DURATIONS, NYX_FILTERS, filterCss } from "./camera-filters.ts";

describe("NYX camera filters", () => {
  it("ships 30 live filters including Original", () => {
    assert.equal(NYX_FILTERS.length, 30);
    assert.equal(NYX_FILTERS[0]?.id, "none");
    assert.notEqual(filterCss("glow"), "none");
    assert.equal(filterCss("missing"), "none");
  });

  it("exposes 15s, 60s, and 10m recording caps", () => {
    const ids = CAMERA_DURATIONS.map((d) => d.id);
    assert.deepEqual(ids, ["10m", "60s", "15s", "photo", "text"]);
    assert.equal(CAMERA_DURATIONS.find((d) => d.id === "10m")?.ms, 600_000);
    assert.equal(CAMERA_DURATIONS.find((d) => d.id === "15s")?.ms, 15_000);
  });
});
