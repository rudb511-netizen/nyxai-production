/** Native store purchases. Web stays on the existing checkout. Server still verifies every receipt. */

import { COIN_PRODUCTS } from "./coins.ts";
import { STORE_PRODUCTS, type NativeBilling, type StoreKind } from "./billing.ts";

export type PurchasePlatform = "ios" | "android" | "web";
export type PurchaseState =
  | "idle"
  | "loading"
  | "unavailable"
  | "initiated"
  | "waiting"
  | "success"
  | "cancelled"
  | "pending"
  | "failed"
  | "already_owned"
  | "restored";

export type CatalogProduct = {
  id: string;
  appleSku: string;
  googleSku: string;
  type: "consumable" | "subscription";
  family: "verify" | "nyxai" | "coins";
  androidPlanId?: string;
};

const SUB_PLANS: Record<string, string> = {
  month: "monthly",
  six_month: "six-month",
  year: "yearly",
};

export function catalogProducts(): CatalogProduct[] {
  const subs: CatalogProduct[] = STORE_PRODUCTS.map((p) => ({
    id: p.id,
    appleSku: p.appleSku,
    googleSku: p.googleSku,
    type: "subscription" as const,
    family: p.family,
    androidPlanId: SUB_PLANS[p.period],
  }));
  const coins: CatalogProduct[] = COIN_PRODUCTS.map((p) => ({
    id: p.id,
    appleSku: p.appleSku,
    googleSku: p.googleSku,
    type: "consumable" as const,
    family: "coins" as const,
  }));
  return [...subs, ...coins];
}

export function catalogProduct(idOrSku: string): CatalogProduct | null {
  const s = idOrSku.trim();
  return (
    catalogProducts().find((p) => p.id === s || p.appleSku === s || p.googleSku === s) ?? null
  );
}

export function skuForPlatform(product: CatalogProduct, platform: PurchasePlatform): string {
  if (platform === "ios") return product.appleSku;
  if (platform === "android") return product.googleSku;
  return product.id;
}

export async function detectPurchasePlatform(): Promise<PurchasePlatform> {
  if (typeof window === "undefined") return "web";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform();
      if (p === "ios") return "ios";
      if (p === "android") return "android";
    }
  } catch {
    /* web */
  }
  return "web";
}

type Plugin = {
  NativePurchases: {
    isBillingSupported: () => Promise<{ isBillingSupported: boolean }>;
    getProducts: (opts: { productIdentifiers: string[]; productType?: string }) => Promise<{
      products: Array<{
        identifier?: string;
        productIdentifier?: string;
        priceString?: string;
        price?: number;
        currencyCode?: string;
        title?: string;
      }>;
    }>;
    purchaseProduct: (opts: Record<string, unknown>) => Promise<{
      transactionId?: string;
      purchaseToken?: string;
      receipt?: string;
      productIdentifier?: string;
      productId?: string;
    }>;
    restorePurchases?: () => Promise<void>;
    getPurchases?: (opts?: { productType?: string }) => Promise<{
      purchases: Array<{
        productIdentifier?: string;
        productId?: string;
        transactionId?: string;
        purchaseToken?: string;
        receipt?: string;
      }>;
    }>;
  };
  PURCHASE_TYPE?: { INAPP: string; SUBS: string };
};

async function loadPlugin(): Promise<Plugin | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const mod = (await import("@capgo/native-purchases")) as unknown as Plugin;
    if (!mod.NativePurchases) return null;
    return mod;
  } catch {
    return null;
  }
}

function userFacingPurchaseError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/cancel/i.test(raw)) return new Error("Purchase cancelled.");
  if (/declin/i.test(raw)) return new Error("Payment was declined.");
  if (/pending/i.test(raw)) return new Error("Purchase is pending.");
  if (/own|already/i.test(raw)) return new Error("This package is already owned.");
  if (/unavail|not found|invalid product/i.test(raw)) return new Error("This package is currently unavailable.");
  if (/network|offline/i.test(raw)) return new Error("The store could not be reached. Try again.");
  if (/billing/i.test(raw) && /android|google|play/i.test(raw)) {
    return new Error("Google Play is unavailable. Please try again.");
  }
  if (/storekit|apple|app store/i.test(raw)) {
    return new Error("App Store is unavailable. Please try again.");
  }
  return new Error("Purchase could not be completed.");
}

export async function getStoreProducts(ids: string[], platform: PurchasePlatform) {
  const plugin = await loadPlugin();
  if (!plugin || platform === "web") return [];
  const skus = ids
    .map((id) => catalogProduct(id))
    .filter((p): p is CatalogProduct => Boolean(p))
    .map((p) => skuForPlatform(p, platform));
  if (!skus.length) return [];
  try {
    const res = await plugin.NativePurchases.getProducts({ productIdentifiers: skus });
    return res.products ?? [];
  } catch {
    return [];
  }
}

export async function purchaseNativeProduct(
  productId: string,
  platform: PurchasePlatform,
): Promise<{ receipt: string; productId: string; store: StoreKind }> {
  if (platform === "web") {
    throw new Error("Native store billing is only available in the NYX Android and iOS apps.");
  }
  const product = catalogProduct(productId);
  if (!product) throw new Error("This package is currently unavailable.");
  const plugin = await loadPlugin();
  if (!plugin) throw new Error(platform === "ios" ? "App Store is unavailable. Please try again." : "Google Play is unavailable. Please try again.");
  const supported = await plugin.NativePurchases.isBillingSupported().catch(() => ({ isBillingSupported: false }));
  if (!supported.isBillingSupported) {
    throw new Error(platform === "ios" ? "App Store is unavailable. Please try again." : "Google Play is unavailable. Please try again.");
  }
  const sku = skuForPlatform(product, platform);
  const isSub = product.type === "subscription";
  try {
    const tx = await plugin.NativePurchases.purchaseProduct({
      productIdentifier: sku,
      productType: isSub ? plugin.PURCHASE_TYPE?.SUBS ?? "subs" : plugin.PURCHASE_TYPE?.INAPP ?? "inapp",
      quantity: 1,
      isConsumable: product.type === "consumable",
      ...(platform === "android" && isSub && product.androidPlanId
        ? { planIdentifier: product.androidPlanId }
        : {}),
    });
    const receipt = tx.purchaseToken || tx.receipt || tx.transactionId || "";
    if (!receipt) throw new Error("Purchase verification failed. Your account was not charged twice.");
    return {
      receipt,
      productId: tx.productIdentifier || tx.productId || sku,
      store: platform === "ios" ? "apple" : "google",
    };
  } catch (e) {
    throw userFacingPurchaseError(e);
  }
}

export async function restoreNativePurchases(platform: PurchasePlatform) {
  if (platform === "web") {
    throw new Error("Restore is for App Store and Google Play purchases on the NYX apps.");
  }
  const plugin = await loadPlugin();
  if (!plugin) throw new Error("The store is unavailable. Please try again.");
  await plugin.NativePurchases.restorePurchases?.().catch(() => undefined);
  const bag = await plugin.NativePurchases.getPurchases?.().catch(() => ({ purchases: [] }));
  const receipts = (bag?.purchases ?? [])
    .map((p) => ({
      receipt: p.purchaseToken || p.receipt || p.transactionId || "",
      productId: p.productIdentifier || p.productId || "",
      store: (platform === "ios" ? "apple" : "google") as StoreKind,
    }))
    .filter((r) => r.receipt && r.productId);
  return { receipts };
}

export async function localizedNativePrice(sku: string, platform: PurchasePlatform) {
  const products = await getStoreProducts([sku], platform);
  const hit = products[0];
  if (!hit) return null;
  const amount = typeof hit.price === "number" ? Math.round(hit.price * 100) : 0;
  return {
    currency: hit.currencyCode || "",
    amountMinor: amount,
    formatted: hit.priceString || "",
  };
}

export async function installNativeBillingBridge(): Promise<NativeBilling | null> {
  if (typeof window === "undefined") return null;
  const platform = await detectPurchasePlatform();
  if (platform === "web") return null;
  const billing: NativeBilling = {
    platform,
    purchase: (sku) => purchaseNativeProduct(sku, platform),
    restore: () => restoreNativePurchases(platform),
    localizedPrice: (sku) => localizedNativePrice(sku, platform),
  };
  (window as Window & { NyxBilling?: NativeBilling }).NyxBilling = billing;
  return billing;
}
