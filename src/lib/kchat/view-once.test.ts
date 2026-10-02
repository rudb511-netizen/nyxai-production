import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canOpenViewOnce,
  deriveViewOnceState,
  hashViewOnceToken,
  newViewOnceToken,
  recipientViewOnceCopy,
  senderViewOnceCopy,
  VIEW_ONCE_TTL_MS,
  viewOnceKindAllowed,
  viewOnceNotifyBody,
} from "./view-once.ts";

describe("view-once states", () => {
  const createdAt = "2026-09-16T00:00:00.000Z";
  const t0 = Date.parse(createdAt);

  it("derives UNOPENED / OPENED / EXPIRED / REVOKED", () => {
    assert.equal(deriveViewOnceState({ viewOnce: false, createdAt }), null);
    assert.equal(deriveViewOnceState({ viewOnce: true, createdAt, now: t0 + 1000 }), "UNOPENED");
    assert.equal(
      deriveViewOnceState({ viewOnce: true, createdAt, openedAt: createdAt, now: t0 + 1000 }),
      "OPENED",
    );
    assert.equal(
      deriveViewOnceState({ viewOnce: true, createdAt, now: t0 + VIEW_ONCE_TTL_MS + 1 }),
      "EXPIRED",
    );
    assert.equal(
      deriveViewOnceState({ viewOnce: true, createdAt, revokedAt: createdAt, now: t0 + 1000 }),
      "REVOKED",
    );
  });

  it("sender cannot reopen; recipients get one authorized open", () => {
    assert.equal(canOpenViewOnce("UNOPENED", false).ok, true);
    assert.equal(canOpenViewOnce("OPENED", false).ok, false);
    assert.equal(canOpenViewOnce("OPENING", false).ok, false);
    assert.equal(canOpenViewOnce("CONSUMED", false).ok, false);
    assert.equal(canOpenViewOnce("EXPIRED", false).ok, false);
    assert.equal(canOpenViewOnce("REVOKED", false).ok, false);
    assert.equal(canOpenViewOnce("UNOPENED", true).ok, false);
    assert.equal(canOpenViewOnce("OPENED", true).ok, false);
    assert.equal(canOpenViewOnce(null, false).ok, false);
    assert.equal(recipientViewOnceCopy("UNOPENED"), "View once");
    assert.equal(recipientViewOnceCopy("OPENED"), "Opened");
    assert.equal(recipientViewOnceCopy("CONSUMED"), "Opened");
    assert.equal(senderViewOnceCopy("UNOPENED"), "View Once media sent");
    assert.equal(senderViewOnceCopy("OPENED"), "View Once media opened");
    assert.equal(viewOnceNotifyBody("Ada", "image"), "Ada sent you a View Once photo.");
    assert.equal(viewOnceNotifyBody("Ada", "voice"), "Ada sent you a View Once voice note.");
    assert.equal(viewOnceKindAllowed("image"), true);
    assert.equal(viewOnceKindAllowed("text"), false);
  });

  it("hashes view-once tokens (never store plaintext)", async () => {
    const token = newViewOnceToken();
    assert.equal(token.length, 48);
    const a = await hashViewOnceToken(token);
    const b = await hashViewOnceToken(token);
    assert.equal(a, b);
    assert.equal(a.length, 64);
    assert.notEqual(a, token);
  });
});
