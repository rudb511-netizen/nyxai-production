import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  PLATFORM_FEE_BPS,
  SETTLEMENT_DELAY_MS,
  STORE_PRODUCTS,
  checkoutInstruction,
  computeProceeds,
  detectBillingCountry,
  familyForProduct,
  grantsForProduct,
  isEntitled,
  paymentRefFromEvent,
  productById,
  productFromSku,
  sha256Hex,
  type BillingStore,
  type ProductFamily,
  type StoreKind,
  type SubStatus,
} from "../billing";
import type { VerifiedEntitlement } from "../billing-verify";
import { takeToken, rateError } from "../rate-limit";
import { publicError } from "../public-error";
import { ensureProfile, notify, sqlClient } from "./helpers";
import { getUsdPerNgn, getUsdtPerUsd } from "./fx";
import { applyPurchaseEntitlements, hasNyxaiPlus, hasPremiumVerify } from "./entitlements";
import { listedPrice, publishRecommendedAsApproved, refreshRecommendedPrices } from "./markets";
import { isArcFlag } from "../types";

export type FamilySlice = {
  active: boolean;
  source: "purchase" | "arc_grant" | "none";
  status: SubStatus | "none";
  plan: "month" | "six_month" | "year" | null;
  productId: string | null;
  store: BillingStore | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  autoRenew: boolean;
  environment: "sandbox" | "production" | null;
};

export type SuperOmniState = {
  active: boolean;
  nyxaiPlus: boolean;
  premiumVerify: boolean;
  source: "purchase" | "arc_grant" | "none";
  status: SubStatus | "none";
  plan: "month" | "six_month" | "year" | null;
  productId: string | null;
  store: BillingStore | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  autoRenew: boolean;
  environment: "sandbox" | "production" | null;
  verify: FamilySlice;
  plus: FamilySlice;
};

const EMPTY_SLICE: FamilySlice = {
  active: false,
  source: "none",
  status: "none",
  plan: null,
  productId: null,
  store: null,
  renewsAt: null,
  trialEndsAt: null,
  autoRenew: false,
  environment: null,
};

const NONE: SuperOmniState = {
  active: false,
  nyxaiPlus: false,
  premiumVerify: false,
  source: "none",
  status: "none",
  plan: null,
  productId: null,
  store: null,
  renewsAt: null,
  trialEndsAt: null,
  autoRenew: false,
  environment: null,
  verify: EMPTY_SLICE,
  plus: EMPTY_SLICE,
};

export async function audit(
  sql: Sql,
  actorId: string | null,
  action: string,
  target: string | null,
  detail: Record<string, unknown>,
) {
  await sql`
    insert into billing_audit (id, actor_id, action, target, detail_json)
    values (${newId("ba")}, ${actorId}, ${action}, ${target}, ${JSON.stringify(detail)}::jsonb)
  `;
}

function sliceFromRow(
  r: {
    product_id: string;
    status: SubStatus;
    store: BillingStore;
    period_end: string;
    grace_until: string | null;
    auto_renew: boolean;
    environment: "sandbox" | "production";
    period: string;
    trial_end: string | null;
  },
  source: FamilySlice["source"],
  entitled: boolean,
): FamilySlice {
  const plan = r.period === "year" ? "year" : r.period === "six_month" ? "six_month" : "month";
  return {
    active: entitled,
    source: entitled ? (source === "none" ? "purchase" : source) : source,
    status: r.status,
    plan,
    productId: r.product_id,
    store: r.store,
    renewsAt: r.period_end,
    trialEndsAt: r.trial_end,
    autoRenew: r.auto_renew,
    environment: r.environment,
  };
}

export async function loadSuperOmni(sql: Sql, userId: string): Promise<SuperOmniState> {
  const nyxaiPlus = await hasNyxaiPlus(sql, userId);
  const premiumVerify = await hasPremiumVerify(sql, userId);
  const rows = await sql<{
    product_id: string;
    status: SubStatus;
    store: BillingStore;
    period_end: string;
    grace_until: string | null;
    auto_renew: boolean;
    environment: "sandbox" | "production";
    period: string;
    trial_end: string | null;
    family: string | null;
  }>`
    select s.product_id, s.status, s.store, s.period_end, s.grace_until, s.auto_renew, s.environment,
           coalesce(p.period, 'month') as period, s.trial_end, coalesce(s.family, p.family, 'verify') as family
    from subscriptions s
    left join store_products p on p.id = s.product_id
    where s.user_id = ${userId}
    order by s.updated_at desc
    limit 16
  `;
  const now = new Date();
  const sources = { verify: "none" as FamilySlice["source"], nyxai: "none" as FamilySlice["source"] };
  try {
    const grant = await sql<{ source: string; kind: string }>`
      select source, kind from entitlements
      where user_id = ${userId}
        and status in ('trial', 'active', 'grace', 'billing_retry')
        and (ends_at is null or ends_at > now())
      order by updated_at desc
    `;
    for (const g of grant) {
      const fam: ProductFamily = g.kind === "nyxai_plus" ? "nyxai" : "verify";
      if (g.source === "purchase" || (g.source === "arc_grant" && fam === "nyxai")) {
        if (sources[fam] === "none" || g.source === "purchase") sources[fam] = g.source;
      }
    }
  } catch {
    /* 0018 */
  }

  let verify = EMPTY_SLICE;
  let plus = EMPTY_SLICE;
  for (const r of rows) {
    const fam = familyForProduct(r.product_id);
    const entitled = isEntitled(r.status, new Date(r.period_end), now, r.grace_until ? new Date(r.grace_until) : null);
    const slice = sliceFromRow(r, fam === "nyxai" ? sources.nyxai : sources.verify, entitled);
    if (fam === "nyxai" && plus.status === "none") plus = { ...slice, active: nyxaiPlus && (entitled || sources.nyxai === "arc_grant") };
    if (fam === "verify" && verify.status === "none") verify = { ...slice, active: premiumVerify && entitled };
  }
  if (premiumVerify && !verify.active) {
    verify = {
      ...EMPTY_SLICE,
      active: true,
      source: sources.verify === "none" ? "purchase" : sources.verify,
      status: "active",
    };
  }
  if (nyxaiPlus && !plus.active) {
    plus = { ...EMPTY_SLICE, active: true, source: sources.nyxai === "none" ? "arc_grant" : sources.nyxai, status: "active" };
  }

  const primary = plus.active ? plus : verify;
  return {
    ...NONE,
    active: nyxaiPlus,
    nyxaiPlus,
    premiumVerify,
    source: primary.source,
    status: primary.status,
    plan: primary.plan,
    productId: primary.productId,
    store: primary.store,
    renewsAt: primary.renewsAt,
    trialEndsAt: primary.trialEndsAt,
    autoRenew: primary.autoRenew,
    environment: primary.environment,
    verify,
    plus,
  };
}

export async function hasSuperOmni(sql: Sql, userId: string): Promise<boolean> {
  try {
    return await hasNyxaiPlus(sql, userId);
  } catch {
    return false;
  }
}

async function refreshTreasuryTotals(sql: Sql): Promise<void> {
  const pending = await sql<{ n: string | number }>`
    select coalesce(sum(usd_cents), 0)::text as n from ledger_entries
    where account_id = 'org_treasury' and status = 'pending' and kind in ('net_proceeds')
  `;
  const settled = await sql<{ n: string | number }>`
    select coalesce(sum(usd_cents), 0)::text as n from ledger_entries
    where account_id = 'org_treasury' and status = 'settled' and kind in ('net_proceeds', 'settlement')
  `;
  const refunds = await sql<{ n: string | number }>`
    select coalesce(sum(usd_cents), 0)::text as n from ledger_entries
    where account_id = 'org_treasury' and kind = 'refund'
  `;
  const withdrawn = await sql<{ n: string | number }>`
    select coalesce(sum(amount_usd_cents), 0)::text as n from withdrawals
    where status in ('pending_send', 'sent', 'pending_auth')
  `;
  const usdt = await sql<{ n: string | number }>`
    select coalesce(sum(usdt_minor), 0)::text as n from ledger_entries
    where account_id = 'org_treasury' and kind = 'usdt_credit' and status = 'settled'
  `;
  const pendingN = Number(pending[0]?.n ?? 0);
  const settledN = Number(settled[0]?.n ?? 0) + Number(refunds[0]?.n ?? 0) - Number(withdrawn[0]?.n ?? 0);
  const convPend = await sql<{ n: string | number }>`
    select coalesce(sum(usd_cents), 0)::text as n from treasury_conversions
    where status in ('pending', 'sent')
  `.catch(() => [{ n: 0 }]);
  try {
    await sql`
      update treasury_accounts set
        pending_usd_cents = ${pendingN},
        settled_usd_cents = ${Math.max(0, settledN)},
        usdt_on_hand_minor = ${Number(usdt[0]?.n ?? 0)},
        convertible_usd_cents = ${Math.max(0, settledN)},
        conversion_pending_usd_cents = ${Number(convPend[0]?.n ?? 0)},
        updated_at = now()
      where id = 'org_treasury'
    `;
  } catch {
    await sql`
      update treasury_accounts set
        pending_usd_cents = ${pendingN},
        settled_usd_cents = ${Math.max(0, settledN)},
        usdt_on_hand_minor = ${Number(usdt[0]?.n ?? 0)},
        updated_at = now()
      where id = 'org_treasury'
    `;
  }
}

export async function settleDueLedger(sql: Sql): Promise<number> {
  const due = await sql<{ id: string }>`
    update ledger_entries set status = 'settled', settled_at = now()
    where status = 'pending'
      and kind = 'net_proceeds'
      and available_at is not null
      and available_at <= now()
    returning id
  `;
  if (due.length) await refreshTreasuryTotals(sql);
  return due.length;
}

async function recordPurchaseLedger(
  sql: Sql,
  ent: VerifiedEntitlement,
  subscriptionId: string,
  eventId: string,
): Promise<void> {
  const product = productById(ent.productId);
  if (!product) return;
  if (ent.status === "expired" || ent.status === "cancelled") return;
  const existing = await sql<{ n: number }>`
    select count(*)::int as n from ledger_entries
    where store_event_id = ${eventId} and kind = 'store_gross'
  `;
  if ((existing[0]?.n ?? 0) > 0) return;
  if (ent.status === "refunded" || ent.status === "revoked") return;

  const usdPerNgn = await getUsdPerNgn(sql);
  const usdt = await getUsdtPerUsd(sql);
  if (!usdPerNgn) {
    await audit(sql, null, "ledger_skipped_no_fx", ent.txnId, { reason: "NGN/USD rate unavailable" });
  }
  const proceeds = computeProceeds({
    grossMinor: product.priceNgnKobo,
    currency: "NGN",
    feeBps: PLATFORM_FEE_BPS,
    usdPerUnit: usdPerNgn?.rate ?? 0,
    usdtPerUsd: usdt?.rate ?? null,
  });
  const available = new Date(Date.now() + SETTLEMENT_DELAY_MS).toISOString();
  const payRef = paymentRefFromEvent(eventId);
  const rows: Array<{ kind: string; minor: number; usd: number; usdt: number | null; status: string }> = [
    { kind: "store_gross", minor: proceeds.grossMinor, usd: Math.round(proceeds.grossMinor * (usdPerNgn?.rate ?? 0)), status: "pending" , usdt: null},
    { kind: "platform_fee", minor: -proceeds.feeMinor, usd: -Math.round(proceeds.feeMinor * (usdPerNgn?.rate ?? 0)), status: "pending", usdt: null },
    { kind: "net_proceeds", minor: proceeds.netMinor, usd: proceeds.usdCents, status: "pending", usdt: proceeds.usdtMinor },
  ];
  for (const row of rows) {
    await sql`
      insert into ledger_entries (
        id, account_id, kind, currency, amount_minor, usd_cents, usdt_minor,
        fx_usd_per_unit, usdt_per_usd, status, available_at, subscription_id,
        store_event_id, original_txn_id, note
      ) values (
        ${newId("le")}, 'org_treasury', ${row.kind}, ${"NGN"}, ${row.minor}, ${row.usd},
        ${row.usdt ?? 0}, ${usdPerNgn?.rate ?? null}, ${usdt?.rate ?? null}, ${row.status},
        ${available}, ${subscriptionId}, ${eventId}, ${ent.originalTxnId},
        ${`${payRef}${usdPerNgn ? ` · FX ${usdPerNgn.source}` : " · FX unavailable — USD not marked settled"}`}
      )
    `;
  }
  try {
    await sql`
      insert into payment_refs (id, user_id, product_id, store, amount_minor, currency, status, store_event_id, subscription_id)
      values (
        ${payRef}, ${ent.appAccountToken}, ${product.id}, ${ent.store}, ${product.priceNgnKobo}, ${"NGN"},
        ${"recorded"}, ${eventId}, ${subscriptionId}
      )
      on conflict (id) do nothing
    `;
  } catch {
    /* 0019 */
  }
  await refreshTreasuryTotals(sql);
}

async function recordRefundLedger(sql: Sql, originalTxnId: string, eventId: string): Promise<void> {
  const nets = await sql<{ id: string; usd_cents: number; amount_minor: number; usdt_minor: number }>`
    select id, usd_cents, amount_minor, usdt_minor from ledger_entries
    where original_txn_id = ${originalTxnId} and kind = 'net_proceeds' and status <> 'reversed'
  `;
  for (const n of nets) {
    await sql`update ledger_entries set status = 'reversed' where original_txn_id = ${originalTxnId}`;
    await sql`
      insert into ledger_entries (
        id, account_id, kind, currency, amount_minor, usd_cents, usdt_minor,
        status, settled_at, store_event_id, original_txn_id, note
      ) values (
        ${newId("le")}, 'org_treasury', 'refund', 'NGN', ${-Math.abs(n.amount_minor)},
        ${-Math.abs(n.usd_cents)}, ${-Math.abs(n.usdt_minor)}, 'settled', now(),
        ${eventId}, ${originalTxnId}, 'Store refund/chargeback'
      )
    `;
  }
  await refreshTreasuryTotals(sql);
}

export async function applyVerifiedEntitlement(
  sql: Sql,
  ent: VerifiedEntitlement,
  opts?: { fallbackUserId?: string | null },
): Promise<{ applied: boolean; userId: string | null; duplicate: boolean }> {
  await settleDueLedger(sql).catch(() => {});
  const product = productById(ent.productId) ?? productFromSku(ent.sku);
  if (!product) return { applied: false, userId: null, duplicate: false };

  let userId = opts?.fallbackUserId ?? null;
  if (ent.appAccountToken) {
    const tokenUser = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${ent.appAccountToken} limit 1
    `;
    if (tokenUser[0]) userId = tokenUser[0].user_id;
  }
  if (!userId) {
    const existing = await sql<{ user_id: string }>`
      select user_id from subscriptions where original_txn_id = ${ent.originalTxnId} limit 1
    `;
    userId = existing[0]?.user_id ?? null;
  }

  const hash = await sha256Hex(`${ent.store}:${ent.eventType}:${ent.txnId}:${ent.status}`);
  const dup = await sql<{ id: string }>`select id from store_events where payload_hash = ${hash} limit 1`;
  if (dup[0]) return { applied: false, userId, duplicate: true };

  const eventId = newId("se");
  await sql`
    insert into store_events (
      id, store, event_type, original_txn_id, txn_id, payload_hash, product_id, user_id, matched, payload_json
    ) values (
      ${eventId}, ${ent.store}, ${ent.eventType}, ${ent.originalTxnId}, ${ent.txnId}, ${hash},
      ${product.id}, ${userId}, ${Boolean(userId)}, ${JSON.stringify({ sku: ent.sku, status: ent.status, env: ent.environment })}::jsonb
    )
  `;

  if (!userId) {
    await audit(sql, null, "unmatched_store_event", ent.originalTxnId, {
      store: ent.store,
      event: ent.eventType,
      sku: ent.sku,
    });
    return { applied: false, userId: null, duplicate: false };
  }

  const current = await sql<{ id: string; status: SubStatus }>`
    select id, status from subscriptions where original_txn_id = ${ent.originalTxnId} limit 1
  `;

  const subId = current[0]?.id ?? newId("sub");
  const family = product.family;
  if (current[0]) {
    await sql`
      update subscriptions set
        latest_txn_id = ${ent.txnId},
        status = ${ent.status},
        product_id = ${product.id},
        family = ${family},
        auto_renew = ${ent.autoRenew},
        environment = ${ent.environment},
        period_start = ${ent.periodStart.toISOString()},
        period_end = ${ent.periodEnd.toISOString()},
        grace_until = ${ent.graceUntil ? ent.graceUntil.toISOString() : null},
        app_account_token = ${ent.appAccountToken},
        updated_at = now()
      where id = ${subId}
    `;
  } else {
    const live = await sql<{ id: string }>`
      select s.id from subscriptions s
      where s.user_id = ${userId}
        and s.status in ('trial', 'active', 'grace', 'billing_retry')
        and coalesce(s.family, ${family}) = ${family}
      limit 1
    `;
    if (live[0] && live[0].id !== subId) {
      await sql`
        update subscriptions set status = 'cancelled', auto_renew = false, updated_at = now()
        where id = ${live[0].id}
      `;
    }
    await sql`
      insert into subscriptions (
        id, user_id, product_id, family, store, original_txn_id, latest_txn_id, status,
        auto_renew, environment, period_start, period_end, grace_until, app_account_token
      ) values (
        ${subId}, ${userId}, ${product.id}, ${family}, ${ent.store}, ${ent.originalTxnId}, ${ent.txnId},
        ${ent.status}, ${ent.autoRenew}, ${ent.environment},
        ${ent.periodStart.toISOString()}, ${ent.periodEnd.toISOString()},
        ${ent.graceUntil ? ent.graceUntil.toISOString() : null}, ${ent.appAccountToken}
      )
    `;
  }

  const noun = family === "nyxai" ? "NYXAI+" : "NYX Verified";
  if (ent.status === "active" || ent.status === "grace" || ent.status === "billing_retry" || ent.status === "trial") {
    await recordPurchaseLedger(sql, ent, subId, eventId);
    await applyPurchaseEntitlements(sql, {
      userId,
      subscriptionId: subId,
      productId: product.id,
      grants: grantsForProduct(product.id),
      status: ent.status,
      periodStart: ent.periodStart,
      periodEnd: ent.periodEnd,
    }).catch(() => {});
    await notify(sql, {
      userId,
      kind: "billing",
      body:
        ent.status === "trial"
          ? `Your 7-day ${noun} trial is on until the trial ends, then the store renews at the listed price unless you cancel.`
          : ent.status === "active"
            ? `${noun} is on for this period.`
            : "Billing needs attention on the store. Access continues during the grace window.",
    });
  } else if (ent.status === "refunded" || ent.status === "revoked") {
    await recordRefundLedger(sql, ent.originalTxnId, eventId);
    await applyPurchaseEntitlements(sql, {
      userId,
      subscriptionId: subId,
      productId: product.id,
      grants: grantsForProduct(product.id),
      status: ent.status,
      periodStart: ent.periodStart,
      periodEnd: ent.periodEnd,
    }).catch(() => {});
    await notify(sql, {
      userId,
      kind: "billing",
      body: `The store refunded or revoked this ${noun} plan. That purchase is off.`,
    });
  } else if (ent.status === "expired") {
    await applyPurchaseEntitlements(sql, {
      userId,
      subscriptionId: subId,
      productId: product.id,
      grants: grantsForProduct(product.id),
      status: "expired",
      periodStart: ent.periodStart,
      periodEnd: ent.periodEnd,
    }).catch(() => {});
    await notify(sql, {
      userId,
      kind: "billing",
      body: `The ${noun} plan ended.`,
    });
  } else if (ent.status === "cancelled") {
    await notify(sql, {
      userId,
      kind: "billing",
      body: `Auto-renew is off. ${noun} stays until the current period ends.`,
    });
  }

  await audit(sql, userId, "subscription_" + ent.status, subId, {
    store: ent.store,
    sku: ent.sku,
    txn: ent.txnId,
    event: ent.eventType,
    family,
  });
  return { applied: true, userId, duplicate: false };
}

export const getBillingCatalog = createServerFn({ method: "GET" })
  .validator((d: { locale?: string; country?: string; storeCountry?: string; timezone?: string; family?: ProductFamily } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const locale = data.locale || "en-NG";
    const { liveGeoCountry } = await import("./request-geo");
    const detected = detectBillingCountry({
      storeCountry: data.storeCountry,
      accountCountry: me.billing_country,
      geoHeader: liveGeoCountry(),
      timezone: data.timezone,
      locale,
    });
    const country = detected.country;
    const family = data.family === "nyxai" ? "nyxai" : data.family === "verify" ? "verify" : null;
    const plans = [];
    for (const p of STORE_PRODUCTS) {
      if (family && p.family !== family) continue;
      let price;
      try {
        price = await listedPrice(sql, country, p.id, locale);
      } catch {
        price = {
          country: "NG",
          currency: "NGN",
          amountMinor: p.priceNgnKobo,
          formatted: (await import("../billing")).formatMinor(p.priceNgnKobo, "NGN", locale),
          status: "catalog" as const,
          fxSource: "catalog",
        };
      }
      plans.push({
        id: p.id,
        family: p.family,
        title: p.title,
        cadence: p.cadence,
        period: p.period,
        appleSku: p.appleSku,
        googleSku: p.googleSku,
        catalogNgnKobo: p.priceNgnKobo,
        catalogFormatted: (await import("../billing")).formatMinor(p.priceNgnKobo, "NGN", locale),
        trialDaysStore: p.trialDaysStore,
        trialDaysWeb: 0,
        grants: [...p.grants],
        display: {
          currency: price.currency,
          amountMinor: price.amountMinor,
          formatted: price.formatted,
          estimated: price.status !== "approved",
          source: price.status,
        },
      });
    }
    const market = (await import("../markets")).marketForIso(country);
    return {
      plans,
      locale,
      country,
      countryName: market?.name ?? country,
      countrySource: detected.source,
      countryConfidence: detected.confidence,
      preferredCurrency: market?.currency ?? "NGN",
      webCheckout: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim()),
      trialOnWeb: false,
      trialOnStore: 7,
      nativeIap: {
        apple: Boolean(process.env.APPLE_IAP_PRIVATE_KEY?.trim() && process.env.APPLE_IAP_KEY_ID?.trim()),
        google: Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()),
      },
    };
  });

export const getSuperOmniStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SuperOmniState> => {
    const sql = await sqlClient();
    await settleDueLedger(sql).catch(() => {});
    const me = await ensureProfile(sql, { id: context.userId });
    const { syncArcGrant } = await import("./entitlements");
    await syncArcGrant(sql, context.userId, isArcFlag(me)).catch(() => {});
    return loadSuperOmni(sql, context.userId);
  });

export const startSuperOmniCheckout = createServerFn({ method: "POST" })
  .validator(
    (d: {
      productId: string;
      locale?: string;
      timezone?: string;
      userAgent?: string;
      nativePlatform?: "ios" | "android" | null;
      storeCountry?: string | null;
      startWeb?: boolean;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`so-co:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const product = productById(data.productId);
    if (!product) throw new Error("Unknown NYX plan.");
    const me = await ensureProfile(sql, { id: context.userId });
    const nativePlatform = data.nativePlatform === "ios" || data.nativePlatform === "android" ? data.nativePlatform : null;
    const store: BillingStore = data.startWeb
      ? "web"
      : nativePlatform === "ios"
        ? "apple"
        : nativePlatform === "android"
          ? "google"
          : "web";
    const trialDays = store === "web" ? 0 : product.trialDaysStore;
    const sku = store === "apple" ? product.appleSku : product.googleSku;
    const { syncArcGrant } = await import("./entitlements");
    await syncArcGrant(sql, context.userId, isArcFlag(me)).catch(() => {});
    const status = await loadSuperOmni(sql, context.userId);
    const slice = product.family === "nyxai" ? status.plus : status.verify;
    if (isArcFlag(me) && slice.active && slice.source === "arc_grant") {
      return {
        productId: product.id,
        store,
        sku,
        appleSku: product.appleSku,
        googleSku: product.googleSku,
        appAccountToken: me.user_id,
        canPurchaseHere: false,
        alreadyGranted: true,
        trialDays: 0,
        checkoutUrl: null as string | null,
        instruction: product.family === "verify"
          ? "ARC Admin rank already includes NYX Verified. There is nothing to pay."
          : "ARC Admin rank already includes NYXAI+. There is nothing to pay.",
      };
    }
    await audit(sql, context.userId, "checkout_started", product.id, { store, sku, trialDays, family: product.family });

    if (store === "web" && data.startWeb) {
      const { createWebCheckout } = await import("./web-checkout");
      const { liveGeoCountry } = await import("./request-geo");
      const country = detectBillingCountry({
        storeCountry: data.storeCountry,
        accountCountry: me.billing_country,
        geoHeader: liveGeoCountry(),
        timezone: data.timezone,
        locale: data.locale,
      }).country;
      const authRows = await sql.query<{ email: string | null }>(
        `select email from "user" where id = $1`,
        [context.userId],
      );
      const session = await createWebCheckout({
        sql,
        userId: context.userId,
        email: authRows[0]?.email ?? null,
        productId: product.id,
        country,
        locale: data.locale || "en-NG",
      });
      return {
        productId: product.id,
        store,
        sku,
        appleSku: product.appleSku,
        googleSku: product.googleSku,
        appAccountToken: me.user_id,
        canPurchaseHere: true,
        alreadyGranted: false,
        trialDays: 0,
        checkoutUrl: session.url,
        instruction: checkoutInstruction("web", 0, product.family),
      };
    }

    return {
      productId: product.id,
      store,
      sku,
      appleSku: product.appleSku,
      googleSku: product.googleSku,
      appAccountToken: me.user_id,
      canPurchaseHere: store !== "web",
      alreadyGranted: false,
      trialDays,
      checkoutUrl: null as string | null,
      instruction: checkoutInstruction(store, trialDays, product.family),
    };
  });

export const restoreSuperOmni = createServerFn({ method: "POST" })
  .validator(
    (d: { store: StoreKind; receipt: string; productId?: string }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`so-rs:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const receipt = data.receipt.trim();
    if (!receipt || receipt.length < 20) {
      throw new Error("Nothing to restore. Complete a store purchase first.");
    }
    const { verifyRestoredReceipt } = await import("./store-verify");
    let ent;
    try {
      ent = await verifyRestoredReceipt(data.store, receipt, data.productId);
    } catch (e) {
      throw publicError(e, "The store could not verify that purchase.");
    }
    if (!ent.ok) {
      throw new Error(
        ent.code === "unverified"
          ? "The store could not verify that purchase."
          : ent.error,
      );
    }
    const result = await applyVerifiedEntitlement(sql, ent.entitlement, {
      fallbackUserId: context.userId,
    });
    return { ok: true as const, applied: result.applied, duplicate: result.duplicate, status: await loadSuperOmni(sql, context.userId) };
  });

export const listMyBillingEvents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    return sql<{
      event_type: string;
      store: string;
      processed_at: string;
      matched: boolean;
    }>`
      select event_type, store, processed_at, matched
      from store_events
      where user_id = ${context.userId}
      order by processed_at desc
      limit 20
    `;
  });

export const listMyPurchases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const subscriptions = await sql<{
      id: string;
      product_id: string;
      family: string | null;
      store: string;
      status: string;
      period_end: string;
      auto_renew: boolean;
      created_at: string;
    }>`
      select id, product_id, family, store, status, period_end, auto_renew, created_at
      from subscriptions
      where user_id = ${context.userId}
      order by created_at desc
      limit 20
    `;
    const events = await sql<{
      id: string;
      event_type: string;
      store: string;
      product_id: string | null;
      processed_at: string;
      matched: boolean;
    }>`
      select id, event_type, store, product_id, processed_at, matched
      from store_events
      where user_id = ${context.userId}
      order by processed_at desc
      limit 20
    `;
    const checkouts = await sql<{
      id: string;
      product_id: string;
      provider: string;
      currency: string;
      amount_minor: number;
      status: string;
      created_at: string;
    }>`
      select id, product_id, provider, currency, amount_minor, status, created_at
      from web_checkout_sessions
      where user_id = ${context.userId}
      order by created_at desc
      limit 20
    `.catch(() => []);
    const refs = await sql<{
      id: string;
      product_id: string | null;
      store: string | null;
      amount_minor: number | null;
      currency: string | null;
      status: string;
      created_at: string;
    }>`
      select id, product_id, store, amount_minor, currency, status, created_at
      from payment_refs
      where user_id = ${context.userId}
      order by created_at desc
      limit 20
    `.catch(() => []);
    return { subscriptions, events, checkouts, refs };
  });

export const getWebCheckoutStatus = createServerFn({ method: "GET" })
  .validator((d: { sessionId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const id = data.sessionId.trim();
    if (!id) throw new Error("Missing checkout session.");
    const rows = await sql<{
      id: string;
      status: string;
      product_id: string;
      amount_minor: number;
      currency: string;
    }>`
      select id, status, product_id, amount_minor, currency
      from web_checkout_sessions
      where (id = ${id} or provider_ref = ${id}) and user_id = ${context.userId}
      limit 1
    `;
    const s = rows[0];
    if (!s) return { found: false as const, status: "unknown", billing: await loadSuperOmni(sql, context.userId) };
    return {
      found: true as const,
      status: s.status,
      productId: s.product_id,
      amountMinor: s.amount_minor,
      currency: s.currency,
      billing: await loadSuperOmni(sql, context.userId),
    };
  });

export function appleConfig() {
  return {
    bundleId: process.env.APPLE_IAP_BUNDLE_ID?.trim() || "",
    issuerId: process.env.APPLE_IAP_ISSUER_ID?.trim() || "",
    keyId: process.env.APPLE_IAP_KEY_ID?.trim() || "",
    privateKey: process.env.APPLE_IAP_PRIVATE_KEY?.trim() || "",
    online: Boolean(process.env.APPLE_IAP_PRIVATE_KEY?.trim() && process.env.APPLE_IAP_KEY_ID?.trim()),
  };
}

export function googleConfig() {
  return {
    packageName: process.env.GOOGLE_PLAY_PACKAGE?.trim() || "",
    serviceAccount: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() || "",
    online: Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()),
  };
}

export const setBillingCountry = createServerFn({ method: "POST" })
  .validator((d: { country: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const iso = data.country.trim().toUpperCase();
    const { isMarketIso } = await import("../markets");
    if (!isMarketIso(iso)) throw new Error("Unknown billing country.");
    await sql`update profiles set billing_country = ${iso} where user_id = ${context.userId}`;
    return { country: iso };
  });

export const publishMarketPrices = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    if (!isArcFlag(me)) throw new Error("ARC access required.");
    const rec = await refreshRecommendedPrices(sql);
    const n = await publishRecommendedAsApproved(sql, context.userId);
    await audit(sql, context.userId, "market_prices_published", null, { published: n, recommended: rec.updated });
    return { published: n, recommended: rec.updated, source: rec.source };
  });
