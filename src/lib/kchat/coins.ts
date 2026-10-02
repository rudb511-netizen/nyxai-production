/** Server catalog for NYX Coins. Client never prices or credits from this file alone. */

export type CoinProductId =
  | "nyx.coin.50"
  | "nyx.coin.100"
  | "nyx.coin.200"
  | "nyx.coin.400"
  | "nyx.coin.800"
  | "nyx.coin.1600"
  | "nyx.coin.3200"
  | "nyx.coin.6400"
  | "nyx.coin.12800";

export const COIN_PRODUCTS = [
  { id: "nyx.coin.50" as const, coins: 50, priceNgnKobo: 70_000, title: "50 NYX Coins", appleSku: "com.nyx.coins.50", googleSku: "nyx_coins_50" },
  { id: "nyx.coin.100" as const, coins: 100, priceNgnKobo: 130_000, title: "100 NYX Coins", appleSku: "com.nyx.coins.100", googleSku: "nyx_coins_100" },
  { id: "nyx.coin.200" as const, coins: 200, priceNgnKobo: 250_000, title: "200 NYX Coins", appleSku: "com.nyx.coins.200", googleSku: "nyx_coins_200" },
  { id: "nyx.coin.400" as const, coins: 400, priceNgnKobo: 490_000, title: "400 NYX Coins", appleSku: "com.nyx.coins.400", googleSku: "nyx_coins_400" },
  { id: "nyx.coin.800" as const, coins: 800, priceNgnKobo: 990_000, title: "800 NYX Coins", appleSku: "com.nyx.coins.800", googleSku: "nyx_coins_800" },
  { id: "nyx.coin.1600" as const, coins: 1600, priceNgnKobo: 1_990_000, title: "1,600 NYX Coins", appleSku: "com.nyx.coins.1600", googleSku: "nyx_coins_1600" },
  { id: "nyx.coin.3200" as const, coins: 3200, priceNgnKobo: 3_999_900, title: "3,200 NYX Coins", appleSku: "com.nyx.coins.3200", googleSku: "nyx_coins_3200" },
  { id: "nyx.coin.6400" as const, coins: 6400, priceNgnKobo: 7_990_000, title: "6,400 NYX Coins", appleSku: "com.nyx.coins.6400", googleSku: "nyx_coins_6400" },
  { id: "nyx.coin.12800" as const, coins: 12800, priceNgnKobo: 15_999_900, title: "12,800 NYX Coins", appleSku: "com.nyx.coins.12800", googleSku: "nyx_coins_12800" },
] as const;

/** Catalog valuation: 50-pack ₦700 → ₦14.00 per coin. Wallet USD uses this, never a random number. */
export const NGN_PER_COIN = 14;
export const GIFT_PLATFORM_FEE_BPS = 1500;

export const COIN_GIFTS = [
  { key: "rose", name: "Rose", coins: 10, label: "🌹" },
  { key: "heart", name: "Heart", coins: 25, label: "❤️" },
  { key: "gift", name: "Gift", coins: 50, label: "🎁" },
  { key: "sparkle", name: "Sparkle", coins: 120, label: "✨" },
  { key: "crown", name: "Crown", coins: 400, label: "👑" },
] as const;

export const BOOST_PACKAGES = [
  { id: "followers.1000", objective: "followers" as const, coins: 750, target: 1000, label: "Target up to 1,000 followers" },
  { id: "followers.5000", objective: "followers" as const, coins: 3700, target: 5000, label: "Target up to 5,000 followers" },
  { id: "followers.10000", objective: "followers" as const, coins: 7200, target: 10000, label: "Target up to 10,000 followers" },
  { id: "views.1000", objective: "views" as const, coins: 200, target: 1000, label: "Target up to 1,000 views" },
  { id: "views.2000", objective: "views" as const, coins: 390, target: 2000, label: "Target up to 2,000 views" },
  { id: "views.5000", objective: "views" as const, coins: 510, target: 5000, label: "Target up to 5,000 views" },
  { id: "views.10000", objective: "views" as const, coins: 990, target: 10000, label: "Target up to 10,000 views" },
  { id: "engagement.1000", objective: "engagement" as const, coins: 100, target: 1000, label: "Target up to 1,000 likes & comments" },
  { id: "engagement.2000", objective: "engagement" as const, coins: 190, target: 2000, label: "Target up to 2,000 likes & comments" },
  { id: "engagement.5000", objective: "engagement" as const, coins: 390, target: 5000, label: "Target up to 5,000 likes & comments" },
  { id: "engagement.10000", objective: "engagement" as const, coins: 790, target: 10000, label: "Target up to 10,000 likes & comments" },
] as const;

export function coinProductById(id: string) {
  return COIN_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function coinProductFromSku(sku: string) {
  const s = sku.trim();
  return COIN_PRODUCTS.find((p) => p.id === s || p.appleSku === s || p.googleSku === s) ?? null;
}

export function giftByKey(key: string) {
  return COIN_GIFTS.find((g) => g.key === key) ?? null;
}

export function boostById(id: string) {
  return BOOST_PACKAGES.find((b) => b.id === id) ?? null;
}

export function netGiftCoins(gross: number, feeBps = GIFT_PLATFORM_FEE_BPS): { net: number; fee: number } {
  const fee = Math.floor((gross * feeBps) / 10_000);
  return { fee, net: Math.max(0, gross - fee) };
}

export function walletUsdCents(coins: number, usdPerNgn: number | null): number | null {
  if (usdPerNgn == null || !(usdPerNgn > 0) || coins < 0) return null;
  return Math.round(coins * NGN_PER_COIN * usdPerNgn * 100);
}
