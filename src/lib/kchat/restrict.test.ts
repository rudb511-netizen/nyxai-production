import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { denyIfRestricted, parseRestrict } from "./restrict.ts";

describe("restrict", () => {
  it("parses empty caps", () => {
    assert.deepEqual(parseRestrict(null), {});
    assert.equal(parseRestrict({ post: true }).post, true);
  });

  it("denies only flagged capabilities", () => {
    assert.doesNotThrow(() => denyIfRestricted({}, "post"));
    assert.throws(() => denyIfRestricted({ post: true }, "post"), /cannot post/);
    assert.doesNotThrow(() => denyIfRestricted({ post: true }, "message"));
  });
});
