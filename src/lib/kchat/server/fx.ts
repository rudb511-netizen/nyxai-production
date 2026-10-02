import type { Sql } from "@/lib/db";
import { FX_TTL_MS } from "../billing.ts";

type Quote = { rate: number; source: string; fetchedAt: string };

const mem = new Map<string, { rate: number; source: string; at: number }>();

async function readSnap(sql: Sql, base: string, quote: string): Promise<Quote | null> {
  const rows = await sql<{ rate: string | number; source: string; fetched_at: string }>`
    select rate::text as rate, source, fetched_at from fx_snapshots
    where base = ${base} and quote = ${quote} limit 1
  `;
  const r = rows[0];
  if (!r) return null;
  const rate = Number(r.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { rate, source: r.source, fetchedAt: r.fetched_at };
}

async function writeSnap(sql: Sql, base: string, quote: string, rate: number, source: string): Promise<void> {
  await sql`
    insert into fx_snapshots (base, quote, rate, source, fetched_at)
    values (${base}, ${quote}, ${rate}, ${source}, now())
    on conflict (base, quote) do update set
      rate = excluded.rate, source = excluded.source, fetched_at = now()
  `;
  mem.set(`${base}:${quote}`, { rate, source, at: Date.now() });
}

async function frankfurterUsd(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: Record<string, number> };
    return j.rates && typeof j.rates === "object" ? j.rates : null;
  } catch {
    return null;
  }
}

async function openErNgn(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/NGN", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (j.result !== "success" || !j.rates) return null;
    return j.rates;
  } catch {
    return null;
  }
}

async function coingeckoUsdtPerUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { tether?: { usd?: number } };
    const usdPerUsdt = j.tether?.usd;
    if (!usdPerUsdt || usdPerUsdt <= 0) return null;
    return 1 / usdPerUsdt;
  } catch {
    return null;
  }
}

function fresh(iso: string | number): boolean {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < FX_TTL_MS;
}

export async function getUsdPerNgn(sql: Sql): Promise<{ rate: number; source: string; fetchedAt: string } | null> {
  const hit = mem.get("NGN:USD");
  if (hit && fresh(hit.at)) return { rate: hit.rate, source: hit.source, fetchedAt: new Date(hit.at).toISOString() };
  const snap = await readSnap(sql, "NGN", "USD");
  if (snap && fresh(snap.fetchedAt)) return snap;
  const rates = await openErNgn();
  const usd = rates?.USD;
  if (usd && usd > 0) {
    await writeSnap(sql, "NGN", "USD", usd, "open.er-api.com");
    return { rate: usd, source: "open.er-api.com", fetchedAt: new Date().toISOString() };
  }
  return snap;
}

export async function getQuote(sql: Sql, base: string, quote: string): Promise<Quote | null> {
  if (base === quote) return { rate: 1, source: "identity", fetchedAt: new Date().toISOString() };
  const key = `${base}:${quote}`;
  const hit = mem.get(key);
  if (hit && fresh(hit.at)) return { rate: hit.rate, source: hit.source, fetchedAt: new Date(hit.at).toISOString() };
  const snap = await readSnap(sql, base, quote);
  if (snap && fresh(snap.fetchedAt)) return snap;

  if (base === "NGN" && quote === "USD") return getUsdPerNgn(sql);
  if (base === "USD" && quote === "USDT") {
    const usdt = await coingeckoUsdtPerUsd();
    if (usdt && usdt > 0) {
      await writeSnap(sql, "USD", "USDT", usdt, "coingecko");
      return { rate: usdt, source: "coingecko", fetchedAt: new Date().toISOString() };
    }
    return snap;
  }

  const fiat = await frankfurterUsd();
  if (fiat) {
    if (base === "USD" && fiat[quote]) {
      await writeSnap(sql, "USD", quote, fiat[quote]!, "frankfurter.app");
      return { rate: fiat[quote]!, source: "frankfurter.app", fetchedAt: new Date().toISOString() };
    }
    if (quote === "USD" && fiat[base]) {
      const rate = 1 / fiat[base]!;
      await writeSnap(sql, base, "USD", rate, "frankfurter.app");
      return { rate, source: "frankfurter.app", fetchedAt: new Date().toISOString() };
    }
  }
  if (base === "NGN") {
    const ngn = await openErNgn();
    const r = ngn?.[quote];
    if (r && r > 0) {
      await writeSnap(sql, "NGN", quote, r, "open.er-api.com");
      return { rate: r, source: "open.er-api.com", fetchedAt: new Date().toISOString() };
    }
  }
  return snap;
}

export async function getUsdtPerUsd(sql: Sql): Promise<Quote | null> {
  return getQuote(sql, "USD", "USDT");
}

export async function localizeFromNgn(
  sql: Sql,
  kobo: number,
  currency: string,
  locale: string,
): Promise<{ currency: string; amountMinor: number; formatted: string; estimated: boolean; source: string | null }> {
  const { formatMinor } = await import("../billing.ts");
  if (currency === "NGN") {
    return {
      currency: "NGN",
      amountMinor: kobo,
      formatted: formatMinor(kobo, "NGN", locale),
      estimated: false,
      source: "catalog",
    };
  }
  const q = await getQuote(sql, "NGN", currency);
  if (q) {
    const major = (kobo / 100) * q.rate;
    const digits = currency === "JPY" ? 0 : 2;
    const minor = Math.round(major * 10 ** digits);
    return {
      currency,
      amountMinor: minor,
      formatted: formatMinor(minor, currency, locale),
      estimated: true,
      source: q.source,
    };
  }
  const usd = await getUsdPerNgn(sql);
  if (usd) {
    const cents = Math.round((kobo / 100) * usd.rate * 100);
    return {
      currency: "USD",
      amountMinor: cents,
      formatted: `${formatMinor(cents, "USD", locale)} (NGN catalog)`,
      estimated: true,
      source: usd.source,
    };
  }
  return {
    currency: "NGN",
    amountMinor: kobo,
    formatted: formatMinor(kobo, "NGN", locale),
    estimated: false,
    source: null,
  };
}
