import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLATFORM_FEE_BPS,
  STORE_PRODUCTS,
  checkoutInstruction,
  computeProceeds,
  currencyForLocale,
  detectBillingCountry,
  detectStore,
  estimatedNetworkFeeUsdtMinor,
  formatMinor,
  grantsForProduct,
  isEntitled,
  mapAppleNotificationType,
  mapGoogleNotificationType,
  marketCount,
  productFromSku,
  requestGeoCountry,
  sha256Hex,
  validateUsdtAddress,
} from "./billing.ts";
import { BILLING_MARKETS } from "./markets.ts";

describe("catalog", () => {
  it("prices NYX verification at ₦2,500 / ₦14,000 / ₦28,999", () => {
    const m = STORE_PRODUCTS.find((p) => p.id === "nyx.verify.monthly");
    const s = STORE_PRODUCTS.find((p) => p.id === "nyx.verify.semiannual");
    const y = STORE_PRODUCTS.find((p) => p.id === "nyx.verify.yearly");
    assert.equal(m?.priceNgnKobo, 250_000);
    assert.equal(s?.priceNgnKobo, 1_400_000);
    assert.equal(y?.priceNgnKobo, 2_899_900);
    assert.equal(m?.trialDaysWeb, 0);
    assert.equal(s?.trialDaysWeb, 0);
    assert.equal(y?.trialDaysWeb, 0);
    assert.equal(m?.trialDaysStore, 7);
    const formatted = formatMinor(250_000, "NGN", "en-NG").replace(/\s/g, "");
    assert.match(formatted, /2,500/);
  });

  it("maps Apple and Google SKUs including legacy SuperOmni receipts to NYXAI+", () => {
    assert.equal(productFromSku("com.nyx.verify.monthly")?.id, "nyx.verify.monthly");
    assert.equal(productFromSku("nyx_verify_yearly")?.id, "nyx.verify.yearly");
    assert.equal(productFromSku("com.omnifeed.superomni.monthly")?.id, "nyx.ai.monthly");
    assert.equal(productFromSku("com.omnifeed.superomni.yearly")?.id, "nyx.ai.yearly");
    assert.equal(productFromSku("not-a-product"), null);
  });

  it("keeps verification and NYXAI+ grants independent", () => {
    assert.equal(STORE_PRODUCTS.length, 6);
    const vm = STORE_PRODUCTS.find((p) => p.id === "nyx.verify.monthly");
    const am = STORE_PRODUCTS.find((p) => p.id === "nyx.ai.monthly");
    assert.deepEqual([...(vm?.grants ?? [])], ["premium_verify"]);
    assert.deepEqual([...(am?.grants ?? [])], ["nyxai_plus"]);
    assert.equal(vm?.priceNgnKobo, 250_000);
    assert.equal(am?.priceNgnKobo, 100_000);
    assert.equal(STORE_PRODUCTS.find((p) => p.id === "nyx.ai.semiannual")?.priceNgnKobo, 550_000);
    assert.equal(STORE_PRODUCTS.find((p) => p.id === "nyx.ai.yearly")?.priceNgnKobo, 1_200_000);
    assert.deepEqual(grantsForProduct("nyx.verify.yearly"), ["premium_verify"]);
    assert.deepEqual(grantsForProduct("nyx.ai.yearly"), ["nyxai_plus"]);
    assert.deepEqual(grantsForProduct("superomni.monthly"), ["nyxai_plus"]);
    assert.equal(grantsForProduct("nyx.verify.monthly").includes("nyxai_plus"), false);
  });
});

describe("locale and store", () => {
  it("covers 195 billing markets", () => {
    assert.equal(BILLING_MARKETS.length, 195);
    assert.equal(marketCount(), 195);
    assert.ok(BILLING_MARKETS.some((m) => m.iso === "NG" && m.currency === "NGN"));
    assert.ok(BILLING_MARKETS.some((m) => m.iso === "US" && m.currency === "USD"));
    assert.ok(BILLING_MARKETS.some((m) => m.iso === "VA"));
    assert.ok(BILLING_MARKETS.some((m) => m.iso === "PS"));
  });

  it("picks NGN for Nigeria, USD for US, GBP for UK", () => {
    assert.equal(currencyForLocale("en-NG"), "NGN");
    assert.equal(currencyForLocale("en-US"), "USD");
    assert.equal(currencyForLocale("en-GB"), "GBP");
  });

  it("does not treat mobile Safari or Chrome as a store app", () => {
    assert.equal(detectStore("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "web");
    assert.equal(detectStore("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "web");
    assert.equal(detectStore("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "web");
    assert.equal(detectStore("Mozilla/5.0 (iPhone)", "ios"), "apple");
    assert.equal(detectStore("Mozilla/5.0 (Linux; Android 14)", "android"), "google");
  });

  it("prefers store country, then account, then geo, then timezone, then locale", () => {
    assert.equal(detectBillingCountry({ storeCountry: "US", accountCountry: "NG", geoHeader: "GB", locale: "en-KE" }).source, "store");
    assert.equal(detectBillingCountry({ accountCountry: "NG", geoHeader: "GB", locale: "en-KE" }).country, "NG");
    assert.equal(detectBillingCountry({ geoHeader: "GB", locale: "en-KE" }).source, "geo");
    assert.equal(detectBillingCountry({ timezone: "America/New_York", locale: "en-KE" }).country, "US");
    assert.equal(detectBillingCountry({ timezone: "America/New_York", locale: "en-KE" }).source, "timezone");
    assert.equal(detectBillingCountry({ locale: "en-KE" }).country, "KE");
  });

  it("maps device timezone and IP country to the matching currency", () => {
    assert.equal(detectBillingCountry({ timezone: "Africa/Lagos" }).country, "NG");
    assert.equal(currencyForLocale("en-NG"), "NGN");
    assert.equal(detectBillingCountry({ timezone: "America/New_York" }).country, "US");
    assert.equal(detectBillingCountry({ timezone: "Europe/London" }).country, "GB");
    assert.equal(detectBillingCountry({ timezone: "Asia/Tokyo" }).country, "JP");
    assert.equal(detectBillingCountry({ geoHeader: "GH", timezone: "Africa/Lagos" }).country, "GH");
    const formattedNg = formatMinor(70_000, "NGN", "en-NG").replace(/\s/g, "");
    assert.match(formattedNg, /700/);
    const formattedUs = formatMinor(70, "USD", "en-US");
    assert.match(formattedUs, /0\.70/);
  });

  it("reads country from CDN geo headers and ignores crawler values", () => {
    const h = (obj: Record<string, string>) => ({
      get(name: string) {
        return obj[name.toLowerCase()] ?? null;
      },
    });
    assert.equal(requestGeoCountry(h({ "cf-ipcountry": "KE" })), "KE");
    assert.equal(requestGeoCountry(h({ "x-vercel-ip-country": "US" })), "US");
    assert.equal(requestGeoCountry(h({ "cf-ipcountry": "XX" })), null);
  });

  it("documents trial on stores and no trial on web", () => {
    assert.match(checkoutInstruction("web", 0), /no free trial/i);
    assert.match(checkoutInstruction("apple", 7), /7-day free trial/i);
    assert.match(checkoutInstruction("google", 7), /7-day free trial/i);
    assert.match(checkoutInstruction("apple", 0), /cannot charge Apple/i);
  });
});

describe("proceeds", () => {
  it("takes 15% platform fee on a ₦2,500 monthly charge", () => {
    const p = computeProceeds({
      grossMinor: 250_000,
      currency: "NGN",
      feeBps: PLATFORM_FEE_BPS,
      usdPerUnit: 0.0007,
      usdtPerUsd: 1.0001,
    });
    assert.equal(p.feeMinor, 37_500);
    assert.equal(p.netMinor, 212_500);
    assert.ok(p.usdtMinor && p.usdtMinor > 0);
  });

  it("does not invent a USDT amount without a rate", () => {
    const p = computeProceeds({
      grossMinor: 250_000,
      currency: "NGN",
      feeBps: PLATFORM_FEE_BPS,
      usdPerUnit: 0.0007,
      usdtPerUsd: null,
    });
    assert.equal(p.usdtMinor, null);
  });
});

describe("entitlement", () => {
  it("keeps access through the paid period after cancel, not after refund", () => {
    const end = new Date(Date.now() + 86400000);
    assert.equal(isEntitled("cancelled", end), true);
    assert.equal(isEntitled("trial", end), true);
    assert.equal(isEntitled("refunded", end), false);
    assert.equal(isEntitled("expired", end), false);
    assert.equal(isEntitled("active", new Date(Date.now() - 1000)), false);
  });

  it("maps Apple and Google event types", () => {
    assert.equal(mapAppleNotificationType("SUBSCRIBED", "INITIAL_BUY"), "trial");
    assert.equal(mapAppleNotificationType("DID_FAIL_TO_RENEW", "GRACE_PERIOD"), "grace");
    assert.equal(mapAppleNotificationType("REFUND"), "refunded");
    assert.equal(mapAppleNotificationType("REVOKE"), "revoked");
    assert.equal(mapGoogleNotificationType(4), "active");
    assert.equal(mapGoogleNotificationType(3), "cancelled");
    assert.equal(mapGoogleNotificationType(13), "expired");
    assert.equal(mapGoogleNotificationType(12), "revoked");
  });
});

describe("USDT addresses", () => {
  it("accepts BEP-20 only and rejects Tron, the USDT contract, and other networks", () => {
    assert.equal(validateUsdtAddress("bep20", "0x" + "b".repeat(40)), null);
    assert.match(validateUsdtAddress("bep20", "TABCDEFGHJKLMNPQRSTUVWXYZabcdefghj") ?? "", /Tron/i);
    assert.match(validateUsdtAddress("bep20", "0x55d398326f99059fF775485246999027B3197955") ?? "", /contract/i);
    assert.match(validateUsdtAddress("bep20", "not-an-address") ?? "", /BEP-20|0x/i);
    assert.match(validateUsdtAddress("trc20" as never, "0x" + "a".repeat(40)) ?? "", /BEP-20/i);
  });

  it("quotes network fees as estimates, not as a send", () => {
    assert.ok(estimatedNetworkFeeUsdtMinor("bep20") > 0);
  });
});

describe("client cannot hash-unlock", () => {
  it("hashes receipts without treating the hash as an entitlement", async () => {
    const a = await sha256Hex("purchased:true");
    const b = await sha256Hex("purchased:true");
    assert.equal(a, b);
    assert.notEqual(a, "active");
  });
});
