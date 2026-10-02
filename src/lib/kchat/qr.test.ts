import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inviteJoinPath, qrSvg } from "./qr.ts";

describe("qr", () => {
  it("renders an SVG matrix for invite URLs", () => {
    const svg = qrSvg("https://nyx.example/join/abc123xyz");
    assert.match(svg, /<svg/);
    assert.match(svg, /<rect/);
  });

  it("builds a join path from a token", () => {
    assert.equal(inviteJoinPath("inv_abc"), "/join/inv_abc");
    assert.equal(inviteJoinPath("a/../b"), "/join/ab");
  });
});
