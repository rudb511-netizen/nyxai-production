import type { Sql } from "@/lib/db";
import { MARKET_PRICE_TTL_MS, STORE_PRODUCTS, formatMinor } from "../billing";
import { COIN_PRODUCTS } from "../coins";
import { BILLING_MARKETS, majorToMinor, marketForIso, roundListMajor } from "../markets";
import { getQuote, getUsdPerNgn } from "./fx";

const seededIso = new Set<string>();

async function seedMarket(sql: Sql, iso: string): Promise<void> {
  const m = marketForIso(iso);
  if (!m || seededIso.has(m.iso)) return;
  await sql`
    insert into billing_markets (iso, name, currency, locale)
    values (${m.iso}, ${m.name}, ${m.currency}, ${m.locale})
    on conflict (iso) do update set name = excluded.name, currency = excluded.currency, locale = excluded.locale
  `;
  if (m.iso === "NG") {
    for (const p of STORE_PRODUCTS) {
      await sql`
        insert into market_prices (country, product_id, currency, amount_minor, status, fx_base, fx_rate, fx_source, updated_at)
        values (${"NG"}, ${p.id}, ${"NGN"}, ${p.priceNgnKobo}, ${"approved"}, ${"NGN"}, ${1}, ${"catalog"}, now())
        on conflict (country, product_id, status) do update set
          amount_minor = excluded.amount_minor, currency = excluded.currency, updated_at = now()
      `;
    }
    for (const p of COIN_PRODUCTS) {
      try {
        await sql`
          insert into market_prices (country, product_id, currency, amount_minor, status, fx_base, fx_rate, fx_source, updated_at)
          values (${"NG"}, ${p.id}, ${"NGN"}, ${p.priceNgnKobo}, ${"approved"}, ${"NGN"}, ${1}, ${"catalog"}, now())
          on conflict (country, product_id, status) do update set
            amount_minor = excluded.amount_minor, currency = excluded.currency, updated_at = now()
        `;
      } catch {
        /* 0022 drops the store_products FK so coin SKUs can persist */
      }
    }
  }
  seededIso.add(m.iso);
}

export async function ensureBillingMarkets(sql: Sql, iso = "NG"): Promise<void> {
  await seedMarket(sql, "NG");
  if (iso !== "NG") await seedMarket(sql, iso);
}

export async function refreshRecommendedPrices(
  sql: Sql,
  onlyIso?: string,
): Promise<{ updated: number; source: string | null }> {
  const usdPerNgn = await getUsdPerNgn(sql);
  if (!usdPerNgn) return { updated: 0, source: null };
  const markets = onlyIso
    ? BILLING_MARKETS.filter((m) => m.iso === onlyIso && m.iso !== "NG")
    : BILLING_MARKETS.filter((m) => m.iso !== "NG");
  let updated = 0;
  for (const market of markets) {
    await seedMarket(sql, market.iso);
    const quote = market.currency === "USD" ? usdPerNgn : await getQuote(sql, "NGN", market.currency);
    const rate = quote?.rate ?? (market.currency === "USD" ? usdPerNgn.rate : 0);
    if (!(rate > 0)) continue;
    const source = quote?.source ?? usdPerNgn.source;
    for (const p of [...STORE_PRODUCTS, ...COIN_PRODUCTS]) {
      const localMajor = roundListMajor((p.priceNgnKobo / 100) * rate, market.currency);
      const minor = majorToMinor(localMajor, market.currency);
      if (!(minor > 0)) continue;
      try {
        await sql`
          insert into market_prices (
            country, product_id, currency, amount_minor, status, fx_base, fx_rate, fx_source, updated_at
          ) values (
            ${market.iso}, ${p.id}, ${market.currency}, ${minor}, ${"recommended"},
            ${"NGN"}, ${rate}, ${source}, now()
          )
          on conflict (country, product_id, status) do update set
            amount_minor = excluded.amount_minor,
            currency = excluded.currency,
            fx_rate = excluded.fx_rate,
            fx_source = excluded.fx_source,
            updated_at = now()
        `;
        updated += 1;
      } catch {
        /* coin SKUs until 0022 */
      }
    }
  }
  return { updated, source: usdPerNgn.source };
}

async function recommendedFresh(sql: Sql, country: string): Promise<boolean> {
  const rows = await sql<{ updated_at: string }>`
    select updated_at from market_prices
    where country = ${country} and status = 'recommended'
    order by updated_at desc limit 1
  `;
  if (!rows[0]) return false;
  return Date.now() - new Date(rows[0].updated_at).getTime() < MARKET_PRICE_TTL_MS;
}

export type ListedPrice = {
  country: string;
  currency: string;
  amountMinor: number;
  formatted: string;
  status: "approved" | "recommended" | "catalog";
  fxSource: string | null;
};

export async function listedPrice(
  sql: Sql,
  country: string,
  productId: string,
  locale: string,
): Promise<ListedPrice> {
  const market = marketForIso(country) ?? marketForIso("NG")!;
  await ensureBillingMarkets(sql, market.iso);
  const product =
    STORE_PRODUCTS.find((p) => p.id === productId) ?? COIN_PRODUCTS.find((p) => p.id === productId);
  const catalog: ListedPrice = {
    country: "NG",
    currency: "NGN",
    amountMinor: product?.priceNgnKobo ?? 250000,
    formatted: formatMinor(product?.priceNgnKobo ?? 250000, "NGN", locale),
    status: "catalog",
    fxSource: "catalog",
  };

  const approved = await sql<{ amount_minor: number; currency: string; fx_source: string | null }>`
    select amount_minor, currency, fx_source from market_prices
    where country = ${market.iso} and product_id = ${productId} and status = 'approved'
    limit 1
  `;
  if (approved[0]) {
    return {
      country: market.iso,
      currency: approved[0].currency,
      amountMinor: Number(approved[0].amount_minor),
      formatted: formatMinor(Number(approved[0].amount_minor), approved[0].currency, locale),
      status: "approved",
      fxSource: approved[0].fx_source,
    };
  }

  if (!(await recommendedFresh(sql, market.iso))) {
    await refreshRecommendedPrices(sql, market.iso).catch(() => {});
  }
  const rec = await sql<{ amount_minor: number; currency: string; fx_source: string | null }>`
    select amount_minor, currency, fx_source from market_prices
    where country = ${market.iso} and product_id = ${productId} and status = 'recommended'
    limit 1
  `;
  if (rec[0]) {
    return {
      country: market.iso,
      currency: rec[0].currency,
      amountMinor: Number(rec[0].amount_minor),
      formatted: formatMinor(Number(rec[0].amount_minor), rec[0].currency, locale),
      status: "recommended",
      fxSource: rec[0].fx_source,
    };
  }

  if (market.iso !== "NG" && product) {
    const quote =
      market.currency === "USD" ? await getUsdPerNgn(sql) : await getQuote(sql, "NGN", market.currency);
    if (quote && quote.rate > 0) {
      const localMajor = roundListMajor((product.priceNgnKobo / 100) * quote.rate, market.currency);
      const minor = majorToMinor(localMajor, market.currency);
      if (minor > 0) {
        return {
          country: market.iso,
          currency: market.currency,
          amountMinor: minor,
          formatted: formatMinor(minor, market.currency, locale),
          status: "recommended",
          fxSource: quote.source,
        };
      }
    }
  }
  return catalog;
}

export async function publishRecommendedAsApproved(sql: Sql, actorId: string): Promise<number> {
  const rec = await sql<{
    country: string;
    product_id: string;
    currency: string;
    amount_minor: number;
    fx_base: string | null;
    fx_rate: string | null;
    fx_source: string | null;
  }>`
    select country, product_id, currency, amount_minor, fx_base, fx_rate::text as fx_rate, fx_source
    from market_prices where status = 'recommended'
  `;
  let n = 0;
  for (const r of rec) {
    await sql`
      insert into market_prices (
        country, product_id, currency, amount_minor, status, fx_base, fx_rate, fx_source, updated_at, published_by
      ) values (
        ${r.country}, ${r.product_id}, ${r.currency}, ${r.amount_minor}, ${"approved"},
        ${r.fx_base}, ${r.fx_rate ? Number(r.fx_rate) : null}, ${r.fx_source}, now(), ${actorId}
      )
      on conflict (country, product_id, status) do update set
        amount_minor = excluded.amount_minor,
        currency = excluded.currency,
        fx_rate = excluded.fx_rate,
        fx_source = excluded.fx_source,
        published_by = excluded.published_by,
        updated_at = now()
    `;
    n += 1;
  }
  return n;
}
