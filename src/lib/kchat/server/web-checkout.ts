import { createHmac, timingSafeEqual } from "node:crypto";
import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  STORE_PRODUCTS,
  addPeriod,
  grantsForProduct,
  sha256Hex,
  type SubStatus,
} from "../billing";
import type { VerifiedEntitlement } from "../billing-verify";
import { applyVerifiedEntitlement, audit } from "./billing";
import { listedPrice } from "./markets";
import { coinProductById } from "../coins";
import { creditCoinPurchase } from "./coins";

export function paystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function webCheckoutProvider(currency: string): "paystack" | "stripe" | null {
  const paystackCurrencies = new Set(["NGN", "GHS", "ZAR", "KES", "USD"]);
  if (paystackConfigured() && paystackCurrencies.has(currency)) return "paystack";
  if (stripeConfigured()) return "stripe";
  if (paystackConfigured()) return "paystack";
  return null;
}

function originFromRequest(request?: Request): string {
  const env = process.env.APP_ORIGIN?.trim();
  if (env) return env.replace(/\/$/, "");
  const hdr = request?.headers.get("origin") || request?.headers.get("x-forwarded-host");
  if (hdr?.startsWith("http")) return hdr.replace(/\/$/, "");
  if (hdr) {
    const proto = request?.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${hdr.replace(/\/$/, "")}`;
  }
  return "";
}

export async function createWebCheckout(opts: {
  sql: Sql;
  userId: string;
  email: string | null;
  productId: string;
  country: string;
  locale: string;
  request?: Request;
}): Promise<{ url: string; sessionId: string; provider: "paystack" | "stripe"; amountMinor: number; currency: string; trialDays: 0 }> {
  const storeProduct = STORE_PRODUCTS.find((p) => p.id === opts.productId);
  const coinProduct = coinProductById(opts.productId);
  if (!storeProduct && !coinProduct) throw new Error("Unknown plan.");
  const price = await listedPrice(opts.sql, opts.country, opts.productId, opts.locale);
  const provider = webCheckoutProvider(price.currency);
  if (!provider) {
    throw new Error("Web checkout is not configured on this deployment. Use the App Store or Google Play app, or ask the operator to add a payment provider.");
  }
  const id = newId("wcs");
  const origin = originFromRequest(opts.request);
  const path = coinProduct ? "/coins" : storeProduct?.family === "nyxai" ? "/plus/ai" : "/plus";
  const callback = origin ? `${origin}${path}?checkout=${id}` : `${path}?checkout=${id}`;
  const title = coinProduct ? coinProduct.title : `NYX ${storeProduct!.title}`;
  const productId = opts.productId;

  if (provider === "paystack") {
    const secret = process.env.PAYSTACK_SECRET_KEY!.trim();
    const amount = price.currency === "NGN" ? price.amountMinor : price.amountMinor;
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: opts.email || `${opts.userId}@nyx.invalid`,
        amount,
        currency: price.currency,
        reference: id,
        callback_url: callback,
        metadata: { userId: opts.userId, productId, country: opts.country, sessionId: id },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url?: string; reference?: string } };
    if (!res.ok || !j.status || !j.data?.authorization_url) {
      throw new Error(j.message || "Paystack could not start checkout.");
    }
    await opts.sql`
      insert into web_checkout_sessions (
        id, user_id, product_id, provider, provider_ref, country, currency, amount_minor, trial_days, price_status, status
      ) values (
        ${id}, ${opts.userId}, ${productId}, ${"paystack"}, ${j.data.reference ?? id},
        ${opts.country}, ${price.currency}, ${price.amountMinor}, ${0}, ${price.status}, ${"open"}
      )
    `;
    await audit(opts.sql, opts.userId, "web_checkout_open", id, { provider, product: productId, amount: price.amountMinor, currency: price.currency });
    return { url: j.data.authorization_url, sessionId: id, provider, amountMinor: price.amountMinor, currency: price.currency, trialDays: 0 };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY!.trim();
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${callback}&ok=1`);
  params.set("cancel_url", `${callback}&ok=0`);
  params.set("client_reference_id", id);
  params.set("metadata[userId]", opts.userId);
  params.set("metadata[productId]", productId);
  params.set("metadata[sessionId]", id);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", price.currency.toLowerCase());
  params.set("line_items[0][price_data][unit_amount]", String(price.amountMinor));
  params.set("line_items[0][price_data][product_data][name]", title);
  if (opts.email) params.set("customer_email", opts.email);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !j.url || !j.id) {
    throw new Error(j.error?.message || "Stripe could not start checkout.");
  }
  await opts.sql`
    insert into web_checkout_sessions (
      id, user_id, product_id, provider, provider_ref, country, currency, amount_minor, trial_days, price_status, status
    ) values (
      ${id}, ${opts.userId}, ${productId}, ${"stripe"}, ${j.id},
      ${opts.country}, ${price.currency}, ${price.amountMinor}, ${0}, ${price.status}, ${"open"}
    )
  `;
  await audit(opts.sql, opts.userId, "web_checkout_open", id, { provider: "stripe", product: productId });
  return { url: j.url, sessionId: id, provider: "stripe", amountMinor: price.amountMinor, currency: price.currency, trialDays: 0 };
}

function paystackSignatureOk(raw: string, header: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !header) return false;
  const digest = createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function stripeSignatureOk(raw: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const digest = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function fulfillSession(sql: Sql, sessionId: string, providerEvent: string): Promise<{ applied: boolean }> {
  const rows = await sql<{
    id: string;
    user_id: string;
    product_id: string;
    status: string;
    country: string;
    currency: string;
    amount_minor: number;
    provider_ref: string | null;
  }>`select * from web_checkout_sessions where id = ${sessionId} or provider_ref = ${sessionId} limit 1`;
  const s = rows[0];
  if (!s) return { applied: false };
  if (s.status === "paid") return { applied: false };
  const coin = coinProductById(s.product_id);
  if (coin) {
    const credited = await creditCoinPurchase(sql, s.user_id, coin.id, s.id);
    await sql`
      update web_checkout_sessions set status = 'paid', paid_at = now() where id = ${s.id}
    `;
    return { applied: credited.applied };
  }
  const product = STORE_PRODUCTS.find((p) => p.id === s.product_id);
  if (!product) return { applied: false };
  const now = new Date();
  const ent: VerifiedEntitlement = {
    store: "web",
    sku: product.id,
    originalTxnId: s.id,
    txnId: s.provider_ref || s.id,
    productId: product.id,
    status: "active",
    autoRenew: false,
    environment: "production",
    periodStart: now,
    periodEnd: addPeriod(now, product.period),
    graceUntil: null,
    appAccountToken: s.user_id,
    eventType: providerEvent,
    bundleOrPackage: "web",
    raw: { sessionId: s.id, providerEvent },
  };
  const result = await applyVerifiedEntitlement(sql, ent, {
    fallbackUserId: s.user_id,
  });
  await sql`
    update web_checkout_sessions set status = 'paid', paid_at = now() where id = ${s.id}
  `;
  void grantsForProduct;
  void sha256Hex;
  return { applied: result.applied };
}

export async function handlePaystackWebhook(sql: Sql, raw: string, signature: string | null): Promise<{ ok: boolean; status: number }> {
  if (!paystackSignatureOk(raw, signature)) return { ok: false, status: 401 };
  let body: { event?: string; data?: { reference?: string; status?: string } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false, status: 400 };
  }
  if (body.event !== "charge.success" && body.data?.status !== "success") return { ok: true, status: 200 };
  const ref = body.data?.reference;
  if (!ref) return { ok: false, status: 400 };
  await fulfillSession(sql, ref, body.event || "charge.success");
  return { ok: true, status: 200 };
}

export async function handleStripeWebhook(sql: Sql, raw: string, signature: string | null): Promise<{ ok: boolean; status: number }> {
  if (!stripeSignatureOk(raw, signature)) return { ok: false, status: 401 };
  let body: { type?: string; data?: { object?: { id?: string; client_reference_id?: string; payment_status?: string } } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false, status: 400 };
  }
  if (body.type !== "checkout.session.completed") return { ok: true, status: 200 };
  const obj = body.data?.object;
  if (obj?.payment_status && obj.payment_status !== "paid") return { ok: true, status: 200 };
  const ref = obj?.client_reference_id || obj?.id;
  if (!ref) return { ok: false, status: 400 };
  await fulfillSession(sql, ref, body.type);
  return { ok: true, status: 200 };
}
