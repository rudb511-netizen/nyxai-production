import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOOST_PACKAGES,
  COIN_GIFTS,
  COIN_PRODUCTS,
  GIFT_PLATFORM_FEE_BPS,
  NGN_PER_COIN,
  boostById,
  coinProductById,
  giftByKey,
  netGiftCoins,
  walletUsdCents,
} from "./coins.ts";

describe("NYX Coins catalog", () => {
  it("matches the published NGN packages", () => {
    const expected: Record<string, number> = {
      "nyx.coin.50": 70_000,
      "nyx.coin.100": 130_000,
      "nyx.coin.200": 250_000,
      "nyx.coin.400": 490_000,
      "nyx.coin.800": 990_000,
      "nyx.coin.1600": 1_990_000,
      "nyx.coin.3200": 3_999_900,
      "nyx.coin.6400": 7_990_000,
      "nyx.coin.12800": 15_999_900,
    };
    assert.equal(COIN_PRODUCTS.length, 9);
    for (const p of COIN_PRODUCTS) {
      assert.equal(p.priceNgnKobo, expected[p.id]);
    }
    assert.equal(coinProductById("nyx.coin.50")?.coins, 50);
    assert.equal(NGN_PER_COIN, 14);
  });

  it("keeps a 15% platform fee on gifts and never goes negative", () => {
    assert.equal(GIFT_PLATFORM_FEE_BPS, 1500);
    assert.deepEqual(netGiftCoins(10), { fee: 1, net: 9 });
    assert.deepEqual(netGiftCoins(50), { fee: 7, net: 43 });
    assert.deepEqual(netGiftCoins(0), { fee: 0, net: 0 });
    assert.equal(giftByKey("rose")?.coins, 10);
    assert.equal(giftByKey("crown")?.coins, 400);
    assert.equal(COIN_GIFTS.length, 5);
  });

  it("values wallets from the catalog rate, never a random dollar figure", () => {
    const usdPerNgn = 1 / 1500;
    assert.equal(walletUsdCents(50, usdPerNgn), Math.round(50 * 14 * usdPerNgn * 100));
    assert.equal(walletUsdCents(100, null), null);
    assert.equal(walletUsdCents(-1, 0.001), null);
  });

  it("labels boost packages as targets, not guaranteed fake engagement", () => {
    const f = boostById("followers.1000");
    assert.equal(f?.coins, 750);
    assert.match(f?.label ?? "", /Target up to 1,000 followers/);
    assert.equal(BOOST_PACKAGES.filter((b) => b.objective === "views").length, 4);
    assert.equal(BOOST_PACKAGES.filter((b) => b.objective === "engagement").length, 4);
  });
});
