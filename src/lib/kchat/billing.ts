/** Store catalog, FX display math, BEP-20 USDT checks. No client unlocks live here. */

import { BILLING_MARKETS, isMarketIso, marketForIso } from "./markets.ts";
import { countryFromTimezone } from "./timezone-country.ts";

export type ProductFamily = "verify" | "nyxai";
export type EntitlementKind = "premium_verify" | "nyxai_plus";

export const STORE_PRODUCTS = [
  {
    id: "nyx.verify.monthly",
    family: "verify" as const,
    period: "month" as const,
    appleSku: "com.nyx.verify.monthly",
    googleSku: "nyx_verify_monthly",
    priceNgnKobo: 250_000,
    title: "Monthly",
    cadence: "Monthly",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["premium_verify"] as const,
  },
  {
    id: "nyx.verify.semiannual",
    family: "verify" as const,
    period: "six_month" as const,
    appleSku: "com.nyx.verify.semiannual",
    googleSku: "nyx_verify_semiannual",
    priceNgnKobo: 1_400_000,
    title: "6 months",
    cadence: "Every 6 months",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["premium_verify"] as const,
  },
  {
    id: "nyx.verify.yearly",
    family: "verify" as const,
    period: "year" as const,
    appleSku: "com.nyx.verify.yearly",
    googleSku: "nyx_verify_yearly",
    priceNgnKobo: 2_899_900,
    title: "Yearly",
    cadence: "Yearly",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["premium_verify"] as const,
  },
  {
    id: "nyx.ai.monthly",
    family: "nyxai" as const,
    period: "month" as const,
    appleSku: "com.nyx.ai.monthly",
    googleSku: "nyx_ai_monthly",
    priceNgnKobo: 100_000,
    title: "Monthly",
    cadence: "Monthly",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["nyxai_plus"] as const,
  },
  {
    id: "nyx.ai.semiannual",
    family: "nyxai" as const,
    period: "six_month" as const,
    appleSku: "com.nyx.ai.semiannual",
    googleSku: "nyx_ai_semiannual",
    priceNgnKobo: 550_000,
    title: "6 months",
    cadence: "Every 6 months",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["nyxai_plus"] as const,
  },
  {
    id: "nyx.ai.yearly",
    family: "nyxai" as const,
    period: "year" as const,
    appleSku: "com.nyx.ai.yearly",
    googleSku: "nyx_ai_yearly",
    priceNgnKobo: 1_200_000,
    title: "Yearly",
    cadence: "Yearly",
    trialDaysStore: 7,
    trialDaysWeb: 0,
    grants: ["nyxai_plus"] as const,
  },
] as const;

export type StoreProductId = (typeof STORE_PRODUCTS)[number]["id"];
export type StoreKind = "apple" | "google";
export type BillingStore = StoreKind | "web";
export type UsdtNetwork = "bep20";
export type SubStatus =
  | "trial"
  | "active"
  | "grace"
  | "billing_retry"
  | "cancelled"
  | "expired"
  | "refunded"
  | "revoked";

export const PLATFORM_FEE_BPS = 1500;
export const SETTLEMENT_DELAY_MS = 15 * 24 * 60 * 60 * 1000;
export const USDT_DECIMALS = 6;
export const FX_TTL_MS = 30 * 60 * 1000;
export const MARKET_PRICE_TTL_MS = 12 * 60 * 60 * 1000;
export const BEP20_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
export const BSC_CHAIN_ID = 56;

export function productsInFamily(family: ProductFamily) {
  return STORE_PRODUCTS.filter((p) => p.family === family);
}

export function productById(id: string) {
  return STORE_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function productFromSku(sku: string) {
  const s = sku.trim();
  const hit = STORE_PRODUCTS.find((p) => p.appleSku === s || p.googleSku === s || p.id === s);
  if (hit) return hit;
  const lower = s.toLowerCase();
  if (lower.includes("superomni") && lower.includes("monthly")) return productById("nyx.ai.monthly");
  if (lower.includes("superomni")) return productById("nyx.ai.yearly");
  return null;
}

export function familyForProduct(id: string): ProductFamily {
  const p = productById(id);
  if (p) return p.family;
  if (id.startsWith("nyx.ai.") || id.startsWith("superomni.")) return "nyxai";
  return "verify";
}

export function grantsForProduct(id: string): EntitlementKind[] {
  const p = productById(id);
  if (p) return [...p.grants];
  if (id.startsWith("superomni.") || id.startsWith("nyx.ai.")) return ["nyxai_plus"];
  if (id.startsWith("nyx.verify.")) return ["premium_verify"];
  return [];
}

export function addPeriod(from: Date, period: "month" | "six_month" | "year"): Date {
  const d = new Date(from.getTime());
  if (period === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (period === "six_month") d.setUTCMonth(d.getUTCMonth() + 6);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/**
 * Billing channel. Native bridge wins. UA is a hint for copy only.
 * A browser cannot opt into Apple/Google IAP by sending a fake platform flag.
 */
export function detectStore(ua: string, nativePlatform?: "ios" | "android" | null): BillingStore {
  if (nativePlatform === "ios") return "apple";
  if (nativePlatform === "android") return "google";
  if (typeof nativeBilling === "function") {
    const n = nativeBilling();
    if (n?.platform === "ios") return "apple";
    if (n?.platform === "android") return "google";
  }
  void ua;
  return "web";
}

export function requestGeoCountry(headers?: { get(name: string): string | null } | null): string | null {
  if (!headers) return null;
  const keys = [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "cloudfront-viewer-country",
    "x-country-code",
    "x-appengine-country",
  ];
  for (const key of keys) {
    const v = (headers.get(key) ?? "").trim().toUpperCase();
    if (v && v !== "XX" && v !== "T1" && isMarketIso(v)) return v;
  }
  return null;
}

export function detectBillingCountry(opts: {
  storeCountry?: string | null;
  accountCountry?: string | null;
  geoHeader?: string | null;
  timezone?: string | null;
  locale?: string | null;
}): {
  country: string;
  source: "store" | "account" | "geo" | "timezone" | "locale" | "default";
  confidence: "high" | "medium" | "low";
} {
  const store = (opts.storeCountry ?? "").trim().toUpperCase();
  if (isMarketIso(store)) return { country: store, source: "store", confidence: "high" };
  const account = (opts.accountCountry ?? "").trim().toUpperCase();
  if (isMarketIso(account)) return { country: account, source: "account", confidence: "high" };
  const geo = (opts.geoHeader ?? "").trim().toUpperCase();
  if (isMarketIso(geo)) return { country: geo, source: "geo", confidence: "medium" };
  const tz = countryFromTimezone(opts.timezone);
  if (tz && isMarketIso(tz)) return { country: tz, source: "timezone", confidence: "medium" };
  const loc = (opts.locale ?? "").replace("_", "-");
  const region = loc.split("-")[1]?.toUpperCase();
  if (region && isMarketIso(region)) return { country: region, source: "locale", confidence: "medium" };
  return { country: "NG", source: "default", confidence: "low" };
}

export function currencyForLocale(locale: string | null | undefined): string {
  const hit = detectBillingCountry({ locale });
  return marketForIso(hit.country)?.currency ?? "NGN";
}

export function currencyForCountry(iso: string): string {
  return marketForIso(iso)?.currency ?? "NGN";
}

export function formatMinor(amountMinor: number, currency: string, locale = "en"): string {
  const digits = currency === "JPY" || currency === "KRW" || currency === "VND" || currency === "CLP" ? 0 : currency === "BHD" || currency === "KWD" || currency === "OMR" || currency === "JOD" ? 3 : 2;
  const major = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(major);
  } catch {
    return `${currency} ${major.toFixed(Math.min(2, digits))}`;
  }
}

export function ngnKoboToMinor(kobo: number, currency: string, usdPerNgn: number): number {
  if (currency === "NGN") return Math.round(kobo);
  const ngn = kobo / 100;
  const usd = ngn * usdPerNgn;
  if (currency === "USD") return Math.round(usd * 100);
  return Math.round(usd * 100);
}

export function localizeCatalogPrice(
  kobo: number,
  currency: string,
  usdPerNgn: number | null,
  locale: string,
): { currency: string; amountMinor: number; formatted: string; estimated: boolean } {
  if (currency === "NGN" || usdPerNgn == null || !(usdPerNgn > 0)) {
    return {
      currency: "NGN",
      amountMinor: kobo,
      formatted: formatMinor(kobo, "NGN", locale),
      estimated: false,
    };
  }
  const usdCents = Math.round((kobo / 100) * usdPerNgn * 100);
  if (currency === "USD") {
    return {
      currency: "USD",
      amountMinor: usdCents,
      formatted: formatMinor(usdCents, "USD", locale),
      estimated: true,
    };
  }
  return {
    currency: "USD",
    amountMinor: usdCents,
    formatted: `${formatMinor(usdCents, "USD", locale)} (from ₦ catalog)`,
    estimated: true,
  };
}

export function convertWithQuote(
  amountMajor: number,
  from: string,
  to: string,
  quotes: Record<string, number>,
): number | null {
  if (from === to) return amountMajor;
  const direct = quotes[`${from}:${to}`];
  if (direct && direct > 0) return amountMajor * direct;
  const inverse = quotes[`${to}:${from}`];
  if (inverse && inverse > 0) return amountMajor / inverse;
  const fromUsd = from === "USD" ? 1 : quotes[`${from}:USD`];
  const toUsd = to === "USD" ? 1 : quotes[`${to}:USD`];
  if (fromUsd && toUsd && fromUsd > 0 && toUsd > 0) {
    const usd = from === "USD" ? amountMajor : amountMajor * fromUsd;
    return to === "USD" ? usd : usd / toUsd;
  }
  return null;
}

export type ProceedsInput = {
  grossMinor: number;
  currency: string;
  feeBps: number;
  taxMinor?: number;
  usdPerUnit: number;
  usdtPerUsd: number | null;
};

export type Proceeds = {
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
  netMinor: number;
  usdCents: number;
  usdtMinor: number | null;
  fxUsdPerUnit: number;
  usdtPerUsd: number | null;
};

export function computeProceeds(input: ProceedsInput): Proceeds {
  const taxMinor = Math.max(0, Math.round(input.taxMinor ?? 0));
  const feeMinor = Math.round((input.grossMinor * input.feeBps) / 10_000);
  const netMinor = input.grossMinor - feeMinor - taxMinor;
  const major = netMinor / 100;
  const usd = major * input.usdPerUnit;
  const usdCents = Math.round(usd * 100);
  const usdtMinor =
    input.usdtPerUsd && input.usdtPerUsd > 0
      ? Math.round(usd * input.usdtPerUsd * 10 ** USDT_DECIMALS)
      : null;
  return {
    grossMinor: input.grossMinor,
    feeMinor,
    taxMinor,
    netMinor,
    usdCents,
    usdtMinor,
    fxUsdPerUnit: input.usdPerUnit,
    usdtPerUsd: input.usdtPerUsd,
  };
}

export function isEntitled(status: SubStatus, periodEnd: Date, now = new Date(), graceUntil?: Date | null): boolean {
  if (status === "refunded" || status === "revoked" || status === "expired") return false;
  if (status === "grace") return (graceUntil ?? periodEnd).getTime() > now.getTime();
  if (status === "trial" || status === "active" || status === "billing_retry" || status === "cancelled") {
    return periodEnd.getTime() > now.getTime();
  }
  return false;
}

export function mapAppleNotificationType(type: string, subtype?: string | null): SubStatus | "ignore" {
  const t = type.toUpperCase();
  const s = (subtype ?? "").toUpperCase();
  if (t === "SUBSCRIBED" && (s === "INITIAL_BUY" || s === "RESUBSCRIBE")) return "trial";
  if (t === "SUBSCRIBED" || t === "DID_RENEW" || t === "OFFER_REDEEMED" || t === "ONE_TIME_CHARGE") return "active";
  if (t === "DID_FAIL_TO_RENEW" && s === "GRACE_PERIOD") return "grace";
  if (t === "DID_FAIL_TO_RENEW") return "billing_retry";
  if (t === "EXPIRED" || t === "GRACE_PERIOD_EXPIRED") return "expired";
  if (t === "REFUND" || t === "REFUND_REVERSED") return t === "REFUND" ? "refunded" : "active";
  if (t === "REVOKE") return "revoked";
  if (t === "DID_CHANGE_RENEWAL_STATUS" && s === "AUTO_RENEW_DISABLED") return "cancelled";
  if (t === "DID_CHANGE_RENEWAL_STATUS") return "active";
  if (t === "DID_CHANGE_RENEWAL_PREF" || t === "RENEWAL_EXTENDED" || t === "RENEWAL_EXTENSION") return "active";
  return "ignore";
}

export function mapGoogleNotificationType(type: number): SubStatus | "ignore" {
  switch (type) {
    case 1:
    case 2:
    case 4:
    case 7:
      return "active";
    case 3:
      return "cancelled";
    case 5:
      return "billing_retry";
    case 6:
      return "grace";
    case 12:
      return "revoked";
    case 13:
      return "expired";
    default:
      return "ignore";
  }
}

export function validateUsdtAddress(network: UsdtNetwork, address: string): string | null {
  const a = address.trim();
  if (!a) return "Enter a wallet address.";
  if (/\s/.test(a)) return "Addresses cannot contain spaces.";
  if (network !== "bep20") return "NYX treasury only sends USDT on BNB Smart Chain (BEP-20).";
  if (a.startsWith("T")) return "That looks like Tron. NYX only sends BEP-20 USDT on BNB Smart Chain.";
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return "BEP-20 USDT needs a 0x address on BNB Smart Chain.";
  if (a.toLowerCase() === BEP20_USDT_CONTRACT.toLowerCase()) {
    return "That is the USDT contract, not a wallet.";
  }
  return null;
}

export function estimatedNetworkFeeUsdtMinor(_network: UsdtNetwork = "bep20"): number {
  return Math.round(0.5 * 10 ** USDT_DECIMALS);
}

export function minWithdrawalUsdtMinor(): number {
  return 10 * 10 ** USDT_DECIMALS;
}

export function maxWithdrawalUsdtMinor(): number {
  return 10_000 * 10 ** USDT_DECIMALS;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function paymentRefFromEvent(eventId: string): string {
  const tail = eventId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase() || "X";
  return `NYX-PAY-${tail}`;
}

export type NativeBilling = {
  platform: "ios" | "android";
  purchase: (sku: string) => Promise<{
    receipt: string;
    productId: string;
    store: StoreKind;
  }>;
  restore: () => Promise<{
    receipts: Array<{ receipt: string; productId: string; store: StoreKind }>;
  }>;
  localizedPrice?: (sku: string) => Promise<{
    currency: string;
    amountMinor: number;
    formatted: string;
  } | null>;
  storeCountry?: () => Promise<string | null>;
};

export function nativeBilling(): NativeBilling | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { NyxBilling?: NativeBilling; OmnifeedBilling?: NativeBilling };
  return w.NyxBilling ?? w.OmnifeedBilling ?? null;
}

export function checkoutInstruction(store: BillingStore, trialDays: number, family: ProductFamily = "verify"): string {
  const noun = family === "nyxai" ? "NYXAI+" : "NYX Verified";
  if (store === "apple") {
    return trialDays > 0
      ? `On iPhone or iPad, ${noun} is billed through the App Store with a ${trialDays}-day free trial, then the listed price renews until you cancel in Settings → Apple ID → Subscriptions.`
      : `On iPhone or iPad, ${noun} is billed through the App Store. This browser cannot charge Apple.`;
  }
  if (store === "google") {
    return trialDays > 0
      ? `On Android, ${noun} is billed through Google Play with a ${trialDays}-day free trial, then the listed price renews until you cancel in Play → Payments & subscriptions.`
      : `On Android, ${noun} is billed through Google Play. This browser cannot charge Google Play.`;
  }
  return `On the web there is no free trial. You are charged the listed price for ${noun} through a signed checkout session. Apple and Google remain the stores on their apps.`;
}

export function marketCount(): number {
  return BILLING_MARKETS.length;
}
