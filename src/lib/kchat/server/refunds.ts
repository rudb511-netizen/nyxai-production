import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { refundStatusLabel, refundWindow } from "../refunds";
import { takeToken, rateError } from "../rate-limit";
import { ensureProfile, notify, sqlClient } from "./helpers";
import { productById } from "../billing";
import { coinProductById } from "../coins";

export const listMyRefunds = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      family: string;
      product_id: string | null;
      checkout_id: string | null;
      amount_minor: number | null;
      currency: string | null;
      status: string;
      reason: string | null;
      deadline: string;
      created_at: string;
    }>`
      select id, family, product_id, checkout_id, amount_minor, currency, status, reason, deadline, created_at
      from refund_requests
      where user_id = ${context.userId}
      order by created_at desc
      limit 30
    `.catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      family: r.family,
      productId: r.product_id,
      checkoutId: r.checkout_id,
      amountMinor: r.amount_minor,
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      deadline: r.deadline,
      createdAt: r.created_at,
      label: refundStatusLabel(r.status),
    }));
  });

export const requestRefund = createServerFn({ method: "POST" })
  .validator((d: { checkoutId?: string; subscriptionId?: string; reason?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const wait = takeToken(`refund:${context.userId}`, 6, 60 * 60 * 1000);
    if (wait) throw new Error(rateError(wait));
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const checkoutId = data.checkoutId?.trim() || null;
    const subscriptionId = data.subscriptionId?.trim() || null;
    if (!checkoutId && !subscriptionId) throw new Error("Pick a purchase to refund.");

    let productId: string | null = null;
    let amountMinor: number | null = null;
    let currency: string | null = null;
    let purchasedAt: string | null = null;
    let family = "verify";
    let provider: string | null = null;
    let providerRef: string | null = null;

    if (checkoutId) {
      const rows = await sql<{
        id: string;
        product_id: string;
        amount_minor: number;
        currency: string;
        status: string;
        provider: string;
        provider_ref: string | null;
        created_at: string;
      }>`
        select id, product_id, amount_minor, currency, status, provider, provider_ref, created_at
        from web_checkout_sessions
        where id = ${checkoutId} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row) throw new Error("That checkout was not found.");
      if (row.status !== "paid") throw new Error("Only confirmed payments can be refunded.");
      productId = row.product_id;
      amountMinor = row.amount_minor;
      currency = row.currency;
      purchasedAt = row.created_at;
      provider = row.provider;
      providerRef = row.provider_ref;
    } else if (subscriptionId) {
      const rows = await sql<{
        id: string;
        product_id: string;
        family: string | null;
        status: string;
        created_at: string;
      }>`
        select id, product_id, family, status, created_at
        from subscriptions
        where id = ${subscriptionId} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row) throw new Error("That purchase was not found.");
      productId = row.product_id;
      purchasedAt = row.created_at;
      family = row.family ?? productById(row.product_id)?.family ?? "verify";
    }

    const product = productId ? productById(productId) : null;
    const coin = productId ? coinProductById(productId) : null;
    if (product) family = product.family;
    else if (coin) family = "coins";

    const window = refundWindow(purchasedAt ?? new Date().toISOString());
    if (window.expired) {
      throw new Error("Refund request period expired.");
    }

    const existing = await sql<{ id: string; status: string }>`
      select id, status from refund_requests
      where user_id = ${context.userId}
        and (
          (${checkoutId}::text is not null and checkout_id = ${checkoutId})
          or (${subscriptionId}::text is not null and subscription_id = ${subscriptionId})
        )
      order by created_at desc
      limit 1
    `.catch(() => []);
    if (existing[0] && existing[0].status !== "cancelled" && existing[0].status !== "denied") {
      return {
        id: existing[0].id,
        status: existing[0].status,
        label: refundStatusLabel(existing[0].status),
        submitted: existing[0].status === "submitted" || existing[0].status === "confirmed",
      };
    }

    const id = newId("rf");
    let status: "pending" | "submitted" = "pending";
    let note =
      "Refund request recorded. Your money is returned only after the payment provider confirms.";

    if (provider === "paystack" && providerRef && process.env.PAYSTACK_SECRET_KEY?.trim()) {
      try {
        const res = await fetch("https://api.paystack.co/refund", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transaction: providerRef,
            customer_note: (data.reason ?? "Customer requested a refund").slice(0, 160),
          }),
        });
        if (res.ok) {
          status = "submitted";
          note = "Submitted to Paystack. Not complete until they confirm.";
        } else {
          note = `Paystack did not accept the refund (${res.status}). The request is recorded; nothing is marked complete.`;
        }
      } catch {
        note = "Could not reach Paystack. The request is recorded; nothing is marked complete.";
      }
    } else if (provider === "stripe" && providerRef && process.env.STRIPE_SECRET_KEY?.trim()) {
      try {
        const res = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ payment_intent: providerRef }).toString(),
        });
        if (res.ok) {
          status = "submitted";
          note = "Submitted to Stripe. Not complete until they confirm.";
        } else {
          note = `Stripe did not accept the refund (${res.status}). The request is recorded; nothing is marked complete.`;
        }
      } catch {
        note = "Could not reach Stripe. The request is recorded; nothing is marked complete.";
      }
    } else if (provider === "apple" || provider === "google") {
      note =
        "Store refunds are handled in App Store or Google Play. This request is recorded on NYX; it is not complete until the store confirms.";
    } else if (!process.env.PAYSTACK_SECRET_KEY?.trim() && !process.env.STRIPE_SECRET_KEY?.trim()) {
      note =
        "Refund request recorded. This deployment cannot submit a provider refund until a payment provider is configured. Nothing is marked complete.";
    }

    await sql`
      insert into refund_requests (
        id, user_id, family, product_id, subscription_id, checkout_id,
        amount_minor, currency, status, reason, deadline
      ) values (
        ${id}, ${context.userId}, ${family}, ${productId}, ${subscriptionId}, ${checkoutId},
        ${amountMinor}, ${currency}, ${status}, ${(data.reason ?? "").slice(0, 280) || null}, ${window.deadline}
      )
    `;
    await notify(sql, {
      userId: context.userId,
      kind: "refund",
      body: note,
      entityId: id,
    });
    return { id, status, label: note, submitted: status === "submitted" };
  });
