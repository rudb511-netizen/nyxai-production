import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canReshareStatus } from "./status-reshare.ts";

describe("status reshare rules", () => {
  const ok = {
    allowReshare: true,
    expired: false,
    viewOnce: false,
    isSelf: false,
    isBlocked: false,
    isBlockedBy: false,
    canView: true,
  };

  it("allows a visible status when reshare is on", () => {
    assert.equal(canReshareStatus(ok).ok, true);
  });

  it("blocks when the creator disabled reshare", () => {
    const r = canReshareStatus({ ...ok, allowReshare: false });
    assert.equal(r.ok, false);
  });

  it("blocks expired, view-once, self, and blocked", () => {
    assert.equal(canReshareStatus({ ...ok, expired: true }).ok, false);
    assert.equal(canReshareStatus({ ...ok, viewOnce: true }).ok, false);
    assert.equal(canReshareStatus({ ...ok, isSelf: true }).ok, false);
    assert.equal(canReshareStatus({ ...ok, isBlocked: true }).ok, false);
  });
});
