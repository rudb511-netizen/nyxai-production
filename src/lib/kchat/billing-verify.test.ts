import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT, generateKeyPair } from "jose";
import {
  decodePubSubData,
  parseAppleNotification,
  parseGoogleEntitlement,
  parseGoogleRtdn,
  verifyAppleSignedPayload,
} from "./billing-verify.ts";

async function sign(payload: Record<string, unknown>, key: CryptoKey) {
  return new SignJWT(payload).setProtectedHeader({ alg: "ES256" }).sign(key);
}

describe("Apple JWS", () => {
  it("activates NYXAI+ only from a verified monthly payload", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const tx = await sign(
      {
        transactionId: "txn_month_1",
        originalTransactionId: "orig_month_1",
        productId: "com.nyx.verify.monthly",
        bundleId: "com.omnifeed.app",
        purchaseDate: Date.now() - 1000,
        expiresDate: Date.now() + 30 * 86400000,
        environment: "Sandbox",
        appAccountToken: "user_abc",
      },
      privateKey,
    );
    const outer = await sign(
      {
        notificationType: "SUBSCRIBED",
        subtype: "INITIAL_BUY",
        data: { signedTransactionInfo: tx, environment: "Sandbox" },
      },
      privateKey,
    );
    const verified = await verifyAppleSignedPayload(outer, publicKey);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.entitlement.productId, "nyx.verify.monthly");
    assert.equal(verified.entitlement.status, "trial");
    assert.equal(verified.entitlement.originalTxnId, "orig_month_1");
  });

  it("rejects an unsigned claim that payment succeeded", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const { privateKey: other } = await generateKeyPair("ES256");
    const tx = await sign(
      {
        transactionId: "txn_bad",
        originalTransactionId: "orig_bad",
        productId: "com.nyx.verify.monthly",
        purchaseDate: Date.now(),
        expiresDate: Date.now() + 86400000,
      },
      other,
    );
    const outer = await sign(
      { notificationType: "SUBSCRIBED", data: { signedTransactionInfo: tx } },
      privateKey,
    );
    const verified = await verifyAppleSignedPayload(outer, publicKey);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.equal(verified.code, "unverified");
  });

  it("rejects a forged purchased:true object", () => {
    const parsed = parseAppleNotification({ notificationType: "SUBSCRIBED", purchased: true }, {});
    assert.equal(parsed.ok, false);
  });

  it("maps a yearly SKU", async () => {
    const parsed = parseAppleNotification(
      { notificationType: "DID_RENEW" },
      {
        transactionId: "t2",
        originalTransactionId: "o2",
        productId: "com.nyx.verify.yearly",
        purchaseDate: Date.now(),
        expiresDate: Date.now() + 86400000,
        environment: "Production",
      },
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.entitlement.productId, "nyx.verify.yearly");
  });
});

describe("Google RTDN", () => {
  it("decodes Pub/Sub and requires a store snapshot", () => {
    const inner = {
      version: "1.0",
      packageName: "com.omnifeed.app",
      eventTimeMillis: "1700000000000",
      subscriptionNotification: {
        notificationType: 4,
        purchaseToken: "tok_1234567890abcdefghij",
        subscriptionId: "nyx_verify_monthly",
      },
    };
    const body = { message: { data: Buffer.from(JSON.stringify(inner)).toString("base64") } };
    const decoded = decodePubSubData(body);
    assert.ok(decoded);
    const rtdn = parseGoogleRtdn(decoded!);
    assert.ok(rtdn);
    const bad = parseGoogleEntitlement(rtdn!, {
      productId: "nyx_verify_monthly",
      originalTxnId: "",
      txnId: "",
      startTime: "nope",
      expiryTime: "nope",
    });
    assert.equal(bad.ok, false);
    const ok = parseGoogleEntitlement(rtdn!, {
      productId: "nyx_verify_monthly",
      originalTxnId: "GPA.1234",
      txnId: "GPA.1234",
      startTime: Date.now(),
      expiryTime: Date.now() + 30 * 86400000,
      autoRenew: true,
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.entitlement.productId, "nyx.verify.monthly");
    assert.equal(ok.entitlement.status, "active");
  });

  it("does not treat a client purchased flag as Google verification", () => {
    const decoded = decodePubSubData({ purchased: true, super: true });
    assert.equal(parseGoogleRtdn(decoded ?? {}), null);
  });
});
