import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstUnviewedId,
  groupStatusesByAuthor,
  ringAriaLabel,
  ringDash,
  segmentOffset,
  sortStatusesChronological,
} from "./status-ring.ts";

const author = (id: string, username = id) => ({
  userId: id,
  username,
  displayName: username,
  avatarUrl: null,
});

describe("status grouping", () => {
  it("groups by author and sorts chronologically", () => {
    const items = [
      { id: "b", seen: true, createdAt: "2026-01-02T00:00:00Z", author: author("u1") },
      { id: "a", seen: false, createdAt: "2026-01-01T00:00:00Z", author: author("u1") },
      { id: "c", seen: false, createdAt: "2026-01-03T00:00:00Z", author: author("u2") },
    ];
    const rings = groupStatusesByAuthor(items);
    assert.equal(rings.length, 2);
    assert.deepEqual(
      rings[0]!.items.map((s) => s.id),
      ["a", "b"],
    );
    assert.equal(rings[0]!.unviewed, 1);
    assert.equal(rings[1]!.items[0]!.id, "c");
    assert.equal(firstUnviewedId(rings[0]!.items), "a");
  });

  it("uses a dynamic segment count equal to active statuses", () => {
    for (const n of [1, 2, 3, 4, 5, 9]) {
      const dash = ringDash(n);
      assert.equal(dash.count, n);
      if (n === 1) {
        assert.equal(dash.gap, 0);
        assert.equal(dash.dash, dash.circumference);
      } else {
        assert.ok(dash.gap > 0);
        assert.ok(Math.abs(n * (dash.dash + dash.gap) - dash.circumference) < 0.01);
      }
      assert.equal(segmentOffset(0, dash), 0);
    }
  });

  it("does not invent placeholder segments", () => {
    assert.equal(ringDash(0).count, 0);
    assert.equal(sortStatusesChronological([]).length, 0);
    assert.equal(firstUnviewedId([]), null);
  });

  it("describes viewed vs unviewed without relying only on color", () => {
    assert.match(ringAriaLabel("Ada", 4, 3), /4 status updates, 3 unviewed/);
    assert.match(ringAriaLabel("Ada", 1, 0), /all viewed/);
  });
});
