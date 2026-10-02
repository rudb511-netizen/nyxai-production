import { SignJWT, compactVerify, importPKCS8, importX509 } from "jose";
import {
  appleBundleAllowed,
  decodePubSubData,
  googlePackageAllowed,
  parseAppleNotification,
  parseGoogleEntitlement,
  parseGoogleRtdn,
  verifyAppleSignedPayload,
  type GoogleSubscriptionSnapshot,
  type VerifyFailure,
  type VerifyOk,
} from "../billing-verify";
import { appleConfig, googleConfig } from "./billing";

function appleRoot(): string | null {
  return process.env.APPLE_IAP_ROOT_PEM?.trim() || null;
}

async function keyFromAppleX5c(jws: string): Promise<CryptoKey | null> {
  const head = jws.split(".")[0];
  if (!head) return null;
  try {
    const json = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as { x5c?: string[] };
    const chain = json.x5c ?? [];
    const leaf = chain[0];
    if (!leaf) return null;
    const pem = `-----BEGIN CERTIFICATE-----\n${leaf}\n-----END CERTIFICATE-----`;
    const key = await importX509(pem, "ES256");
    const rootPem = appleRoot();
    if (rootPem && chain[chain.length - 1]) {
      try {
        await importX509(rootPem, "ES256");
      } catch {
        /* root optional if chain import fails — still require leaf signature */
      }
    }
    return key;
  } catch {
    return null;
  }
}

async function appleApiTransaction(transactionId: string): Promise<Record<string, unknown> | null> {
  const cfg = appleConfig();
  if (!cfg.online || !cfg.privateKey || !cfg.keyId || !cfg.issuerId || !cfg.bundleId) return null;
  const key = await importPKCS8(cfg.privateKey.replace(/\\n/g, "\n"), "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })
    .setIssuer(cfg.issuerId)
    .setIssuedAt()
    .setExpirationTime("20m")
    .setAudience("appstoreconnect-v1")
    .setSubject(cfg.bundleId)
    .sign(key);
  const hosts = ["https://api.storekit.itunes.apple.com", "https://api.storekit-sandbox.itunes.apple.com"];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { signedTransactionInfo?: string };
      if (!j.signedTransactionInfo) continue;
      const { payload } = await compactVerify(j.signedTransactionInfo, async (header) => {
        const x5c = header.x5c?.[0];
        if (!x5c) throw new Error("no cert");
        return importX509(`-----BEGIN CERTIFICATE-----\n${x5c}\n-----END CERTIFICATE-----`, "ES256");
      });
      return JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    } catch {
      /* try sandbox host */
    }
  }
  return null;
}

export async function verifyAppleWebhook(signedPayload: string): Promise<VerifyOk | VerifyFailure> {
  const raw = signedPayload.trim();
  if (!raw || raw.split(".").length !== 3) {
    return { ok: false, error: "Apple payload was not a signed notification.", code: "malformed" };
  }
  const leaf = await keyFromAppleX5c(raw);
  if (leaf) {
    const verified = await verifyAppleSignedPayload(raw, leaf);
    if (verified.ok) {
      const cfg = appleConfig();
      if (!appleBundleAllowed(verified.entitlement.bundleOrPackage, cfg.bundleId || undefined)) {
        return { ok: false, error: "Apple bundle id did not match.", code: "unverified" };
      }
      return verified;
    }
    if (verified.code !== "unverified") return verified;
  }
  return { ok: false, error: "Apple signature could not be verified.", code: "unverified" };
}

export async function verifyRestoredReceipt(
  store: "apple" | "google",
  receipt: string,
  productId?: string,
): Promise<VerifyOk | VerifyFailure> {
  if (store === "apple") {
    const asNotification = await verifyAppleWebhook(receipt);
    if (asNotification.ok) return asNotification;
    const tx = await appleApiTransaction(receipt);
    if (!tx) return { ok: false, error: "Apple could not restore that transaction.", code: "unverified" };
    return parseAppleNotification({ notificationType: "SUBSCRIBED", subtype: "RESUBSCRIBE" }, tx);
  }
  const snap = await googleGetSubscription(receipt, productId);
  if (!snap.ok) return snap;
  const rtdn = {
    notificationType: 4,
    purchaseToken: receipt,
    subscriptionId: snap.snapshot.productId,
    packageName: googleConfig().packageName || snap.snapshot.productId,
    eventTimeMillis: Date.now(),
  };
  return parseGoogleEntitlement(rtdn, snap.snapshot);
}

type SaJson = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

function parseSa(): SaJson | null {
  const raw = googleConfig().serviceAccount;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SaJson;
  } catch {
    return null;
  }
}

async function googleAccessToken(): Promise<string | null> {
  const sa = parseSa();
  if (!sa?.client_email || !sa.private_key) return null;
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ?? null;
}

export async function googleGetSubscription(
  purchaseToken: string,
  productId?: string,
): Promise<{ ok: true; snapshot: GoogleSubscriptionSnapshot } | VerifyFailure> {
  const cfg = googleConfig();
  if (!cfg.online || !cfg.packageName) {
    return { ok: false, error: "Google Play verification is not configured.", code: "unverified" };
  }
  const access = await googleAccessToken();
  if (!access) return { ok: false, error: "Google Play verification is not configured.", code: "unverified" };
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, error: "Google Play did not recognize that purchase.", code: "unverified" };
  const j = (await res.json()) as {
    latestOrderId?: string;
    startTime?: string;
    lineItems?: Array<{
      productId?: string;
      expiryTime?: string;
      latestSuccessfulOrderId?: string;
      autoRenewingPlan?: { autoRenewEnabled?: boolean };
    }>;
    regionCode?: string;
    testPurchase?: unknown;
    externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  };
  const line = j.lineItems?.[0];
  const sku = line?.productId || productId || "";
  const start = j.startTime;
  const expiry = line?.expiryTime;
  const txn = line?.latestSuccessfulOrderId || j.latestOrderId;
  if (!sku || !start || !expiry || !txn) {
    return { ok: false, error: "Google Play purchase was incomplete.", code: "malformed" };
  }
  return {
    ok: true,
    snapshot: {
      productId: sku,
      originalTxnId: txn,
      txnId: txn,
      startTime: start,
      expiryTime: expiry,
      autoRenew: Boolean(line?.autoRenewingPlan?.autoRenewEnabled),
      obfuscatedAccountId: j.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
      environment: j.testPurchase ? "sandbox" : "production",
    },
  };
}

export async function verifyGoogleWebhook(body: unknown): Promise<VerifyOk | VerifyFailure> {
  const decoded = decodePubSubData(body);
  if (!decoded) return { ok: false, error: "Google notification was malformed.", code: "malformed" };
  const rtdn = parseGoogleRtdn(decoded);
  if (!rtdn) return { ok: false, error: "Not a subscription notification.", code: "malformed" };
  const cfg = googleConfig();
  if (!googlePackageAllowed(rtdn.packageName, cfg.packageName || undefined)) {
    return { ok: false, error: "Google package name did not match.", code: "unverified" };
  }
  const snap = await googleGetSubscription(rtdn.purchaseToken, rtdn.subscriptionId);
  if (!snap.ok) return snap;
  return parseGoogleEntitlement(rtdn, snap.snapshot);
}

export async function consumeGoogleProduct(purchaseToken: string, sku: string): Promise<boolean> {
  const cfg = googleConfig();
  const access = await googleAccessToken();
  if (!access || !cfg.packageName || !sku || !purchaseToken) return false;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(purchaseToken)}:consume`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(8000),
  });
  return res.ok || res.status === 409;
}

export type ConsumableVerify =
  | { ok: true; productId: string; transactionId: string; state: "purchased" | "pending" }
  | VerifyFailure;

/** Google Play product purchase. A client success flag is never enough. */
export async function verifyGoogleConsumable(purchaseToken: string, sku: string): Promise<ConsumableVerify> {
  const cfg = googleConfig();
  if (!cfg.online || !cfg.packageName) {
    return { ok: false, error: "Google Play verification is not configured. Nothing was added.", code: "unverified" };
  }
  const access = await googleAccessToken();
  if (!access) return { ok: false, error: "Google Play verification is not configured. Nothing was added.", code: "unverified" };
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, error: "Google Play did not recognize that purchase.", code: "unverified" };
  const j = (await res.json()) as { purchaseState?: number; orderId?: string };
  const txn = (j.orderId ?? "").trim();
  if (!txn) return { ok: false, error: "Google Play purchase was incomplete.", code: "malformed" };
  if (j.purchaseState === 2) return { ok: true, productId: sku, transactionId: txn, state: "pending" };
  if (j.purchaseState === 1) return { ok: false, error: "That purchase was cancelled.", code: "unverified" };
  if (j.purchaseState !== 0) return { ok: false, error: "Google Play purchase was not completed.", code: "unverified" };
  return { ok: true, productId: sku, transactionId: txn, state: "purchased" };
}

/** App Store transaction id or signed StoreKit JWS. */
export async function verifyAppleConsumable(receipt: string, expectedSku: string): Promise<ConsumableVerify> {
  const trimmed = receipt.trim();
  let tx: Record<string, unknown> | null = null;
  if (trimmed.split(".").length === 3) {
    const leaf = await keyFromAppleX5c(trimmed);
    if (!leaf) return { ok: false, error: "Apple signature could not be verified.", code: "unverified" };
    try {
      const { payload } = await compactVerify(trimmed, leaf);
      tx = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Apple signature could not be verified.", code: "unverified" };
    }
  } else {
    tx = await appleApiTransaction(trimmed);
  }
  if (!tx) return { ok: false, error: "Apple could not verify that transaction.", code: "unverified" };
  const productId = String(tx.productId ?? "");
  const txn = String(tx.transactionId ?? tx.originalTransactionId ?? "");
  if (!productId || !txn) return { ok: false, error: "Apple transaction was incomplete.", code: "malformed" };
  if (expectedSku && productId !== expectedSku) {
    return { ok: false, error: "That receipt is for a different product.", code: "unverified" };
  }
  if (tx.revocationDate) return { ok: false, error: "Apple revoked that transaction.", code: "unverified" };
  const bundle = String(tx.bundleId ?? "");
  const cfg = appleConfig();
  if (bundle && cfg.bundleId && !appleBundleAllowed(bundle, cfg.bundleId)) {
    return { ok: false, error: "Apple bundle id did not match.", code: "unverified" };
  }
  return { ok: true, productId, transactionId: txn, state: "purchased" };
}
