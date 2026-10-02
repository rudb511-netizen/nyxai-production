/** Cryptographic store verification. Never activate from an unverified payload. */

import { compactVerify, importJWK, type JWK } from "jose";
import {
  mapAppleNotificationType,
  mapGoogleNotificationType,
  productFromSku,
  type BillingStore,
  type StoreKind,
  type SubStatus,
} from "./billing.ts";

export type VerifiedEntitlement = {
  store: BillingStore;
  eventType: string;
  status: SubStatus;
  productId: string;
  sku: string;
  originalTxnId: string;
  txnId: string;
  periodStart: Date;
  periodEnd: Date;
  graceUntil: Date | null;
  autoRenew: boolean;
  environment: "sandbox" | "production";
  appAccountToken: string | null;
  bundleOrPackage: string;
  raw: Record<string, unknown>;
};

export type VerifyFailure = { ok: false; error: string; code: "unverified" | "malformed" | "unknown_product" | "ignore" };
export type VerifyOk = { ok: true; entitlement: VerifiedEntitlement };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export async function verifyCompactJws(jws: string, key: CryptoKey | Uint8Array): Promise<Record<string, unknown>> {
  const { payload } = await compactVerify(jws.trim(), key);
  const json = JSON.parse(new TextDecoder().decode(payload)) as unknown;
  const rec = asRecord(json);
  if (!rec) throw new Error("Store payload was not an object.");
  return rec;
}

export async function importTestJwk(jwk: JWK): Promise<CryptoKey> {
  return importJWK(jwk, jwk.alg || "ES256") as Promise<CryptoKey>;
}

export function appleEnvironment(v: unknown): "sandbox" | "production" {
  const s = String(v ?? "").toLowerCase();
  return s.includes("sandbox") ? "sandbox" : "production";
}

export function parseAppleNotification(outer: Record<string, unknown>, tx: Record<string, unknown>): VerifyOk | VerifyFailure {
  const eventType = str(outer.notificationType) ?? "UNKNOWN";
  const subtype = str(outer.subtype);
  const mapped = mapAppleNotificationType(eventType, subtype);
  if (mapped === "ignore") return { ok: false, error: "Notification type is informational.", code: "ignore" };

  const sku = str(tx.productId) ?? "";
  const product = productFromSku(sku);
  if (!product) return { ok: false, error: "Unknown NYX product.", code: "unknown_product" };

  const originalTxnId = str(tx.originalTransactionId) ?? str(tx.transactionId);
  const txnId = str(tx.transactionId) ?? originalTxnId;
  if (!originalTxnId || !txnId) return { ok: false, error: "Missing transaction id.", code: "malformed" };

  const purchaseDate = num(tx.purchaseDate) ?? num(tx.originalPurchaseDate);
  const expires = num(tx.expiresDate);
  if (!purchaseDate || !expires) return { ok: false, error: "Missing subscription dates.", code: "malformed" };

  const grace = num(tx.gracePeriodExpiresDate);
  const env = appleEnvironment(tx.environment ?? (asRecord(outer.data)?.environment));
  const autoRenew = tx.autoRenewStatus === 1 || tx.autoRenewStatus === "1" || tx.autoRenewStatus === true;

  return {
    ok: true,
    entitlement: {
      store: "apple",
      eventType: subtype ? `${eventType}.${subtype}` : eventType,
      status: mapped,
      productId: product.id,
      sku,
      originalTxnId,
      txnId,
      periodStart: new Date(purchaseDate),
      periodEnd: new Date(expires),
      graceUntil: grace ? new Date(grace) : null,
      autoRenew,
      environment: env,
      appAccountToken: str(tx.appAccountToken),
      bundleOrPackage: str(tx.bundleId) ?? "",
      raw: { notification: outer, transaction: tx },
    },
  };
}

export async function verifyAppleSignedPayload(
  signedPayload: string,
  key: CryptoKey | Uint8Array,
  opts?: { transactionKey?: CryptoKey | Uint8Array },
): Promise<VerifyOk | VerifyFailure> {
  let outer: Record<string, unknown>;
  try {
    outer = await verifyCompactJws(signedPayload, key);
  } catch {
    return { ok: false, error: "Apple signature could not be verified.", code: "unverified" };
  }
  const data = asRecord(outer.data) ?? {};
  const signedTx = str(data.signedTransactionInfo);
  let tx: Record<string, unknown> = {};
  if (signedTx) {
    try {
      tx = await verifyCompactJws(signedTx, opts?.transactionKey ?? key);
    } catch {
      return { ok: false, error: "Apple transaction signature could not be verified.", code: "unverified" };
    }
  } else if (asRecord(outer.transaction)) {
    return { ok: false, error: "Unsigned transaction payloads are rejected.", code: "unverified" };
  }
  const renewal = str(data.signedRenewalInfo);
  if (renewal) {
    try {
      const info = await verifyCompactJws(renewal, opts?.transactionKey ?? key);
      tx = { ...tx, autoRenewStatus: info.autoRenewStatus, renewalProductId: info.autoRenewProductId };
    } catch {
      return { ok: false, error: "Apple renewal signature could not be verified.", code: "unverified" };
    }
  }
  return parseAppleNotification(outer, tx);
}

export function parseGoogleRtdn(decoded: Record<string, unknown>): {
  notificationType: number;
  purchaseToken: string;
  subscriptionId: string;
  packageName: string;
  eventTimeMillis: number;
} | null {
  const sub = asRecord(decoded.subscriptionNotification);
  if (!sub) return null;
  const notificationType = num(sub.notificationType);
  const purchaseToken = str(sub.purchaseToken);
  const subscriptionId = str(sub.subscriptionId);
  const packageName = str(decoded.packageName);
  const eventTimeMillis = num(decoded.eventTimeMillis);
  if (notificationType == null || !purchaseToken || !subscriptionId || !packageName || !eventTimeMillis) return null;
  return { notificationType, purchaseToken, subscriptionId, packageName, eventTimeMillis };
}

export type GoogleSubscriptionSnapshot = {
  productId: string;
  originalTxnId: string;
  txnId: string;
  startTime: string | number;
  expiryTime: string | number;
  autoRenew?: boolean;
  obfuscatedAccountId?: string | null;
  environment?: "sandbox" | "production";
};

export function parseGoogleEntitlement(
  rtdn: NonNullable<ReturnType<typeof parseGoogleRtdn>>,
  snapshot: GoogleSubscriptionSnapshot,
): VerifyOk | VerifyFailure {
  const mapped = mapGoogleNotificationType(rtdn.notificationType);
  if (mapped === "ignore") return { ok: false, error: "Notification type is informational.", code: "ignore" };
  const sku = snapshot.productId || rtdn.subscriptionId;
  const product = productFromSku(sku);
  if (!product) return { ok: false, error: "Unknown NYX product.", code: "unknown_product" };
  const start = num(snapshot.startTime) ?? Date.parse(String(snapshot.startTime));
  const end = num(snapshot.expiryTime) ?? Date.parse(String(snapshot.expiryTime));
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "Missing subscription dates.", code: "malformed" };
  }
  return {
    ok: true,
    entitlement: {
      store: "google",
      eventType: `GOOGLE_${rtdn.notificationType}`,
      status: mapped,
      productId: product.id,
      sku,
      originalTxnId: snapshot.originalTxnId,
      txnId: snapshot.txnId,
      periodStart: new Date(start),
      periodEnd: new Date(end),
      graceUntil: mapped === "grace" ? new Date(end) : null,
      autoRenew: Boolean(snapshot.autoRenew),
      environment: snapshot.environment ?? "production",
      appAccountToken: snapshot.obfuscatedAccountId ?? null,
      bundleOrPackage: rtdn.packageName,
      raw: { rtdn, snapshot },
    },
  };
}

export function decodePubSubData(body: unknown): Record<string, unknown> | null {
  const rec = asRecord(body);
  if (!rec) return null;
  const message = asRecord(rec.message);
  const data = str(message?.data) ?? str(rec.data);
  if (!data) return asRecord(rec.subscriptionNotification) ? rec : null;
  try {
    const json = Buffer.from(data, "base64").toString("utf8");
    return asRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

export function appleBundleAllowed(got: string, expected: string | undefined): boolean {
  if (!expected) return true;
  return got === expected;
}

export function googlePackageAllowed(got: string, expected: string | undefined): boolean {
  if (!expected) return true;
  return got === expected;
}
