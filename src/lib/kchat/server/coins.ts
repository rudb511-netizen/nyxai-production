import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  BOOST_PACKAGES,
  COIN_GIFTS,
  COIN_PRODUCTS,
  boostById,
  coinProductById,
  coinProductFromSku,
  giftByKey,
  netGiftCoins,
  type CoinProductId,
} from "../coins";
import { detectBillingCountry } from "../billing";
import { takeToken, rateError } from "../rate-limit";
import { ensureProfile, notify, sqlClient } from "./helpers";
import { listedPrice } from "./markets";

async function ensureWallet(sql: Sql, userId: string): Promise<{ balance: number }> {
  await sql`
    insert into coin_wallets (user_id, balance) values (${userId}, 0)
    on conflict (user_id) do nothing
  `;
  const rows = await sql<{ balance: number }>`
    select balance from coin_wallets where user_id = ${userId} limit 1
  `;
  return { balance: Number(rows[0]?.balance ?? 0) };
}

export async function creditCoins(opts: {
  sql: Sql;
  userId: string;
  amount: number;
  kind: "purchase" | "gift_received" | "refund" | "reversal" | "admin_adjust";
  reason: string;
  relatedId: string;
  productId?: string | null;
}): Promise<{ balance: number; duplicate: boolean }> {
  if (opts.amount <= 0) throw new Error("Invalid coin amount.");
  await ensureWallet(opts.sql, opts.userId);
  try {
    const before = await opts.sql<{ balance: number }>`
      select balance from coin_wallets where user_id = ${opts.userId} limit 1
    `;
    const bal = Number(before[0]?.balance ?? 0);
    const after = bal + opts.amount;
    await opts.sql`
      insert into coin_ledger (
        id, user_id, kind, direction, amount, balance_before, balance_after, reason, related_id, product_id
      ) values (
        ${newId("clg")}, ${opts.userId}, ${opts.kind}, ${"in"}, ${opts.amount},
        ${bal}, ${after}, ${opts.reason}, ${opts.relatedId}, ${opts.productId ?? null}
      )
    `;
    await opts.sql`
      update coin_wallets set balance = ${after}, updated_at = now() where user_id = ${opts.userId}
    `;
    return { balance: after, duplicate: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/unique|duplicate/i.test(msg)) {
      const w = await ensureWallet(opts.sql, opts.userId);
      return { balance: w.balance, duplicate: true };
    }
    throw e;
  }
}

async function debitCoins(opts: {
  sql: Sql;
  userId: string;
  amount: number;
  kind: "gift_sent" | "boost_spend" | "reversal";
  reason: string;
  relatedId: string;
  productId?: string | null;
}): Promise<{ balance: number }> {
  if (opts.amount <= 0) throw new Error("Invalid coin amount.");
  await ensureWallet(opts.sql, opts.userId);
  const before = await opts.sql<{ balance: number }>`
    select balance from coin_wallets where user_id = ${opts.userId} limit 1
  `;
  const bal = Number(before[0]?.balance ?? 0);
  if (bal < opts.amount) throw new Error("Not enough NYX Coins.");
  const after = bal - opts.amount;
  await opts.sql`
    insert into coin_ledger (
      id, user_id, kind, direction, amount, balance_before, balance_after, reason, related_id, product_id
    ) values (
      ${newId("clg")}, ${opts.userId}, ${opts.kind}, ${"out"}, ${opts.amount},
      ${bal}, ${after}, ${opts.reason}, ${opts.relatedId}, ${opts.productId ?? null}
    )
  `;
  const upd = await opts.sql`
    update coin_wallets set balance = ${after}, updated_at = now()
    where user_id = ${opts.userId} and balance >= ${opts.amount}
  `;
  void upd;
  const check = await opts.sql<{ balance: number }>`
    select balance from coin_wallets where user_id = ${opts.userId} limit 1
  `;
  if (Number(check[0]?.balance ?? 0) !== after) {
    throw new Error("Not enough NYX Coins.");
  }
  return { balance: after };
}

export async function creditCoinPurchase(
  sql: Sql,
  userId: string,
  productId: string,
  relatedId: string,
): Promise<{ applied: boolean; coins: number }> {
  const product = coinProductById(productId);
  if (!product) return { applied: false, coins: 0 };
  const r = await creditCoins({
    sql,
    userId,
    amount: product.coins,
    kind: "purchase",
    reason: `Purchased ${product.title}`,
    relatedId,
    productId: product.id,
  });
  if (!r.duplicate) {
    await notify(sql, {
      userId,
      kind: "coins",
      body: `${product.coins.toLocaleString()} NYX Coins were added after a verified payment.`,
      entityId: relatedId,
    });
  }
  return { applied: !r.duplicate, coins: product.coins };
}

export async function attributeBoostEvent(opts: {
  sql: Sql;
  videoId: string;
  viewerId: string;
  kind: "impression" | "view" | "follow" | "like" | "comment";
  authorId?: string;
}): Promise<void> {
  try {
    const campaigns = await opts.sql<{ id: string; objective: string }>`
      select id, objective from boost_campaigns
      where video_id = ${opts.videoId}
        and status = 'active'
        and end_at > now()
        and owner_id <> ${opts.viewerId}
    `;
    for (const c of campaigns) {
      if (opts.kind === "follow" && c.objective !== "followers") continue;
      if (opts.kind === "view" && c.objective === "followers") continue;
      if ((opts.kind === "like" || opts.kind === "comment") && c.objective !== "engagement") continue;
      if (opts.kind === "impression" && c.objective === "followers") continue;
      try {
        await opts.sql`
          insert into boost_events (id, campaign_id, viewer_id, kind)
          values (${newId("be")}, ${c.id}, ${opts.viewerId}, ${opts.kind})
        `;
      } catch {
        continue;
      }
      const col =
        opts.kind === "impression"
          ? "impressions"
          : opts.kind === "view"
            ? "views"
            : opts.kind === "follow"
              ? "followers_gained"
              : opts.kind === "like"
                ? "likes"
                : "comments";
      await opts.sql.query(
        `update boost_campaigns set ${col} = ${col} + 1, updated_at = now() where id = $1`,
        [c.id],
      );
    }
  } catch {
    /* 0021 */
  }
}

export async function attributeFollowBoosts(sql: Sql, followerId: string, authorId: string): Promise<void> {
  try {
    const vids = await sql<{ id: string }>`
      select v.id from videos v
      join boost_campaigns b on b.video_id = v.id
      where v.author_id = ${authorId}
        and b.status = 'active'
        and b.objective = 'followers'
        and b.end_at > now()
      limit 12
    `;
    for (const v of vids) {
      await attributeBoostEvent({ sql, videoId: v.id, viewerId: followerId, kind: "follow", authorId });
    }
  } catch {
    /* ignore */
  }
}

export const getCoinWallet = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const w = await ensureWallet(sql, context.userId);
    return {
      balance: w.balance,
      ngnPerCoin: 14,
      valuation: "NYX Coins are spent on gifts and boosts inside NYX. A purchase is added only after the store verifies it.",
    };
  });

export const getCoinCatalog = createServerFn({ method: "GET" })
  .validator((d: { locale?: string; storeCountry?: string; timezone?: string } = {}) => d)
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
    const packages = [];
    for (const p of COIN_PRODUCTS) {
      let price: Awaited<ReturnType<typeof listedPrice>>;
      try {
        price = await listedPrice(sql, country, p.id, locale);
      } catch {
        price = {
          country: "NG",
          currency: "NGN",
          amountMinor: p.priceNgnKobo,
          formatted: (await import("../billing")).formatMinor(p.priceNgnKobo, "NGN", locale),
          status: "catalog",
          fxSource: "catalog",
        };
      }
      packages.push({
        id: p.id as CoinProductId,
        coins: p.coins,
        title: p.title,
        appleSku: p.appleSku,
        googleSku: p.googleSku,
        catalogNgnKobo: p.priceNgnKobo,
        display: {
          currency: price.currency,
          amountMinor: price.amountMinor,
          formatted: price.formatted,
          estimated: price.status !== "approved" && price.currency !== "NGN",
          source: price.status,
          fxSource: price.fxSource,
        },
      });
    }
    const { marketForIso } = await import("../markets");
    const market = marketForIso(country);
    return {
      packages,
      gifts: COIN_GIFTS.map((g) => ({ ...g })),
      boosts: BOOST_PACKAGES.map((b) => ({ ...b })),
      country,
      countryName: market?.name ?? country,
      countrySource: detected.source,
      preferredCurrency: market?.currency ?? "NGN",
      locale,
      webCheckout: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim()),
      nativeIap: {
        apple: Boolean(process.env.APPLE_IAP_PRIVATE_KEY?.trim() && process.env.APPLE_IAP_KEY_ID?.trim()),
        google: Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()),
      },
    };
  });

export const listCoinLedger = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      kind: string;
      direction: string;
      amount: number;
      balance_after: number;
      reason: string | null;
      created_at: string;
    }>`
      select id, kind, direction, amount, balance_after, reason, created_at
      from coin_ledger where user_id = ${context.userId}
      order by created_at desc limit 50
    `.catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      direction: r.direction,
      amount: r.amount,
      balanceAfter: r.balance_after,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  });

export const startCoinCheckout = createServerFn({ method: "POST" })
  .validator(
    (d: {
      productId: string;
      locale?: string;
      timezone?: string;
      nativePlatform?: "ios" | "android" | null;
      storeCountry?: string | null;
      startWeb?: boolean;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`coin-co:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const product = coinProductById(data.productId);
    if (!product) throw new Error("Unknown NYX Coins package.");
    const me = await ensureProfile(sql, { id: context.userId });
    const nativePlatform =
      data.nativePlatform === "ios" || data.nativePlatform === "android" ? data.nativePlatform : null;
    const store = data.startWeb ? "web" : nativePlatform === "ios" ? "apple" : nativePlatform === "android" ? "google" : "web";
    const sku = store === "apple" ? product.appleSku : product.googleSku;

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
        coins: product.coins,
        store,
        sku,
        appleSku: product.appleSku,
        googleSku: product.googleSku,
        checkoutUrl: session.url,
        sessionId: session.sessionId,
        instruction: `Pay ${session.currency} ${(session.amountMinor / 100).toFixed(session.currency === "NGN" ? 0 : 2)} for ${product.coins} NYX Coins. Coins are added only after the payment provider confirms.`,
      };
    }

    return {
      productId: product.id,
      coins: product.coins,
      store,
      sku,
      appleSku: product.appleSku,
      googleSku: product.googleSku,
      checkoutUrl: null as string | null,
      sessionId: null as string | null,
      instruction:
        store === "web"
          ? "This browser uses web checkout. Coins are added only after a verified payment."
          : "Complete the purchase in the store. Coins are added only after the store receipt is verified.",
    };
  });

/** Credit coins only after Google Play or the App Store confirms the transaction. */
export const confirmCoinPurchase = createServerFn({ method: "POST" })
  .validator((d: { store: "apple" | "google"; receipt: string; productId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`coin-ok:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const receipt = data.receipt.trim();
    if (receipt.length < 8 || receipt.length > 20_000) {
      throw new Error("The store did not return a receipt. Coins were not added.");
    }
    const product = coinProductFromSku(data.productId) ?? coinProductById(data.productId);
    if (!product) throw new Error("Unknown NYX Coins package.");
    const sku = data.store === "apple" ? product.appleSku : product.googleSku;
    const { verifyGoogleConsumable, verifyAppleConsumable, consumeGoogleProduct } = await import("./store-verify");
    const verified =
      data.store === "apple"
        ? await verifyAppleConsumable(receipt, sku)
        : await verifyGoogleConsumable(receipt, sku);
    const log = (result: string, tx?: string) => {
      console.info(
        JSON.stringify({
          event: "billing_verify",
          platform: data.store,
          productId: product.id,
          result,
          tx: tx ? tx.slice(0, 16) : undefined,
          at: new Date().toISOString(),
        }),
      );
    };
    if (!verified.ok) {
      log(verified.code);
      throw new Error(verified.error);
    }
    if (verified.state === "pending") {
      log("pending", verified.transactionId);
      return { status: "pending" as const, applied: false, duplicate: false, coins: 0, balance: null as number | null };
    }
    const related = `${data.store}:${verified.transactionId}`.slice(0, 180);
    const hash = createHash("sha256").update(related).digest("hex");
    const claimed = await sql<{ id: string }>`
      insert into store_events (id, store, event_type, original_txn_id, txn_id, payload_hash, product_id, user_id, matched, payload_json)
      values (
        ${newId("se")}, ${data.store}, ${"coin_purchase"}, ${verified.transactionId}, ${verified.transactionId},
        ${hash}, ${product.id}, ${context.userId}, ${true}, ${"{}"}::jsonb
      )
      on conflict (payload_hash) do nothing
      returning id
    `;
    if (!claimed[0]) {
      const owner = await sql<{ user_id: string | null }>`
        select user_id from store_events where payload_hash = ${hash} limit 1
      `;
      if (owner[0]?.user_id && owner[0].user_id !== context.userId) {
        log("replay", verified.transactionId);
        throw new Error("That purchase was already used.");
      }
    }
    const credited = await creditCoinPurchase(sql, context.userId, product.id, related);
    if (data.store === "google") {
      await consumeGoogleProduct(receipt, sku).catch(() => undefined);
    }
    const w = await ensureWallet(sql, context.userId);
    log(credited.applied ? "credited" : "duplicate", verified.transactionId);
    return {
      status: "purchased" as const,
      applied: credited.applied,
      duplicate: !credited.applied,
      coins: product.coins,
      balance: w.balance,
    };
  });

export const sendCoinGift = createServerFn({ method: "POST" })
  .validator(
    (d: {
      giftKey: string;
      recipientUsername?: string;
      conversationId?: string;
      liveId?: string;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`gift:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const gift = giftByKey(data.giftKey);
    if (!gift) throw new Error("Unknown gift.");
    const me = await ensureProfile(sql, { id: context.userId });
    let recipientId: string | null = null;
    if (data.liveId) {
      const live = await sql<{ host_id: string }>`
        select host_id from live_streams where id = ${data.liveId} limit 1
      `;
      if (!live[0]) throw new Error("That live stream is not available.");
      recipientId = live[0].host_id;
    } else if (data.conversationId) {
      await sql`
        select 1 from conversation_members
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `.then((rows) => {
        if (rows.length === 0) throw new Error("You are not in this conversation.");
      });
      if (data.recipientUsername) {
        const p = await sql<{ user_id: string }>`
          select user_id from profiles where username_lc = ${data.recipientUsername.trim().toLowerCase()} limit 1
        `;
        recipientId = p[0]?.user_id ?? null;
      } else {
        const others = await sql<{ user_id: string }>`
          select user_id from conversation_members
          where conversation_id = ${data.conversationId} and user_id <> ${context.userId}
        `;
        if (others.length !== 1) throw new Error("Pick who should receive this gift.");
        recipientId = others[0]!.user_id;
      }
    }
    if (!recipientId || recipientId === context.userId) throw new Error("Pick someone else to gift.");
    const { net, fee } = netGiftCoins(gift.coins);
    const giftId = newId("gf");
    await debitCoins({
      sql,
      userId: context.userId,
      amount: gift.coins,
      kind: "gift_sent",
      reason: `Sent ${gift.name}`,
      relatedId: giftId,
    });
    await creditCoins({
      sql,
      userId: recipientId,
      amount: net,
      kind: "gift_received",
      reason: `Received ${gift.name}`,
      relatedId: giftId,
    });
    await sql`
      insert into coin_gifts (id, sender_id, recipient_id, gift_key, coins, net_coins, conversation_id, live_id)
      values (
        ${giftId}, ${context.userId}, ${recipientId}, ${gift.key}, ${gift.coins}, ${net},
        ${data.conversationId ?? null}, ${data.liveId ?? null}
      )
    `;
    if (data.conversationId) {
      await sql`
        insert into messages (id, conversation_id, sender_id, kind, body, media_url)
        values (${newId("m")}, ${data.conversationId}, ${context.userId}, ${"gift"}, ${gift.name}, ${gift.key})
      `;
      await sql`
        update conversations set last_message_at = now(), last_message_body = ${`Sent a ${gift.name}`}
        where id = ${data.conversationId}
      `;
    }
    await notify(sql, {
      userId: recipientId,
      kind: "gift",
      body: `${me.display_name} sent a ${gift.name}`,
      actorId: me.user_id,
      entityId: data.liveId ?? data.conversationId ?? null,
    });
    void fee;
    const w = await ensureWallet(sql, context.userId);
    return { id: giftId, gift: gift.key, coins: gift.coins, net, balance: w.balance };
  });

export const listLiveGifts = createServerFn({ method: "GET" })
  .validator((d: { liveId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ data }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      gift_key: string;
      coins: number;
      sender_id: string;
      created_at: string;
    }>`
      select id, gift_key, coins, sender_id, created_at
      from coin_gifts where live_id = ${data.liveId}
      order by created_at desc limit 40
    `.catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      giftKey: r.gift_key,
      coins: r.coins,
      senderId: r.sender_id,
      createdAt: r.created_at,
    }));
  });

export const startBoost = createServerFn({ method: "POST" })
  .validator((d: { videoId: string; packageId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`boost:${context.userId}`, 10, 60_000);
    if (wait) throw new Error(rateError(wait));
    const pack = boostById(data.packageId);
    if (!pack) throw new Error("Unknown boost package.");
    const vid = await sql<{ id: string; author_id: string }>`
      select id, author_id from videos where id = ${data.videoId} and is_removed = false limit 1
    `;
    if (!vid[0] || vid[0].author_id !== context.userId) {
      throw new Error("You can only boost your own videos.");
    }
    const campaignId = newId("bst");
    await debitCoins({
      sql,
      userId: context.userId,
      amount: pack.coins,
      kind: "boost_spend",
      reason: pack.label,
      relatedId: campaignId,
      productId: pack.id,
    });
    await sql`
      insert into boost_campaigns (
        id, owner_id, video_id, objective, package_id, coin_budget, remaining_budget, target_label, status
      ) values (
        ${campaignId}, ${context.userId}, ${data.videoId}, ${pack.objective}, ${pack.id},
        ${pack.coins}, ${0}, ${pack.label}, ${"active"}
      )
    `;
    const w = await ensureWallet(sql, context.userId);
    return {
      id: campaignId,
      label: pack.label,
      coins: pack.coins,
      balance: w.balance,
      note: "This promotes the video to people already on NYX. It does not create fake followers, views, likes, or comments.",
    };
  });

export const listBoosts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      video_id: string;
      objective: string;
      package_id: string;
      coin_budget: number;
      target_label: string;
      status: string;
      impressions: number;
      views: number;
      followers_gained: number;
      likes: number;
      comments: number;
      start_at: string;
      end_at: string;
    }>`
      select id, video_id, objective, package_id, coin_budget, target_label, status,
             impressions, views, followers_gained, likes, comments, start_at, end_at
      from boost_campaigns
      where owner_id = ${context.userId}
      order by created_at desc
      limit 40
    `.catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      videoId: r.video_id,
      objective: r.objective,
      packageId: r.package_id,
      coins: r.coin_budget,
      label: r.target_label,
      status: r.status,
      impressions: r.impressions,
      views: r.views,
      followersGained: r.followers_gained,
      likes: r.likes,
      comments: r.comments,
      startAt: r.start_at,
      endAt: r.end_at,
    }));
  });

export const requestRefund = createServerFn({ method: "POST" })
  .validator((d: { checkoutId?: string; subscriptionId?: string; family?: string; reason?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`rf:${context.userId}`, 6, 60_000);
    if (wait) throw new Error(rateError(wait));
    let purchaseAt: Date | null = null;
    let amount: number | null = null;
    let currency: string | null = null;
    let productId: string | null = null;
    let family = data.family ?? "verify";
    if (data.checkoutId) {
      const row = await sql<{
        id: string;
        product_id: string;
        amount_minor: number;
        currency: string;
        status: string;
        created_at: string;
        paid_at: string | null;
      }>`
        select id, product_id, amount_minor, currency, status, created_at, paid_at
        from web_checkout_sessions where id = ${data.checkoutId} and user_id = ${context.userId} limit 1
      `;
      if (!row[0] || row[0].status !== "paid") throw new Error("No completed purchase found.");
      purchaseAt = new Date(row[0].paid_at || row[0].created_at);
      amount = row[0].amount_minor;
      currency = row[0].currency;
      productId = row[0].product_id;
      if (productId.startsWith("nyx.coin.")) family = "coins";
      else if (productId.startsWith("nyx.ai.")) family = "nyxai";
      else family = "verify";
    } else if (data.subscriptionId) {
      const row = await sql<{ id: string; product_id: string; created_at: string; family: string | null }>`
        select id, product_id, created_at, family from subscriptions
        where id = ${data.subscriptionId} and user_id = ${context.userId} limit 1
      `;
      if (!row[0]) throw new Error("No purchase found.");
      purchaseAt = new Date(row[0].created_at);
      productId = row[0].product_id;
      family = row[0].family || family;
    } else {
      throw new Error("Pick a purchase to refund.");
    }
    const deadline = new Date(purchaseAt.getTime() + 24 * 60 * 60 * 1000);
    if (Date.now() > deadline.getTime()) {
      throw new Error("Refund request period expired. Store or card refund rights still follow the payment provider.");
    }
    const existing = await sql<{ id: string; status: string }>`
      select id, status from refund_requests
      where user_id = ${context.userId}
        and (
          (${data.checkoutId ?? null}::text is not null and checkout_id = ${data.checkoutId ?? null})
          or (${data.subscriptionId ?? null}::text is not null and subscription_id = ${data.subscriptionId ?? null})
        )
      order by created_at desc limit 1
    `;
    if (existing[0] && existing[0].status !== "denied" && existing[0].status !== "cancelled") {
      return {
        id: existing[0].id,
        status: existing[0].status,
        message:
          existing[0].status === "confirmed"
            ? "The payment provider already confirmed this refund."
            : "A refund request is already pending. It is not complete until the payment provider confirms.",
      };
    }
    const id = newId("rf");
    await sql`
      insert into refund_requests (
        id, user_id, family, product_id, subscription_id, checkout_id, amount_minor, currency, status, reason, deadline
      ) values (
        ${id}, ${context.userId}, ${family}, ${productId}, ${data.subscriptionId ?? null},
        ${data.checkoutId ?? null}, ${amount}, ${currency}, ${"pending"},
        ${(data.reason ?? "").slice(0, 280)}, ${deadline.toISOString()}
      )
    `;
    await notify(sql, {
      userId: context.userId,
      kind: "billing",
      body: "Refund requested. Nothing is reversed until the payment provider confirms.",
      entityId: id,
    });
    return {
      id,
      status: "pending",
      deadline: deadline.toISOString(),
      message:
        "Refund requested. NYX will not mark this complete until the payment provider confirms. Apple and Google handle store refunds on their side.",
    };
  });


