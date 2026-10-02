import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import { familyForProduct, isEntitled, type SubStatus } from "../billing";
import { isArcFlag } from "../types";

export type EntitlementKind = "premium_verify" | "nyxai_plus";
export type EntitlementSource = "purchase" | "arc_grant";

const LIVE: SubStatus[] = ["trial", "active", "grace", "billing_retry", "cancelled"];

async function note(sql: Sql, actorId: string, action: string, detail: Record<string, unknown>) {
  try {
    await sql`
      insert into billing_audit (id, actor_id, action, target, detail_json)
      values (${newId("ba")}, ${actorId}, ${action}, ${actorId}, ${JSON.stringify(detail)}::jsonb)
    `;
  } catch {
    /* ignore */
  }
}

export async function hasEntitlement(
  sql: Sql,
  userId: string,
  kind: EntitlementKind,
): Promise<boolean> {
  try {
    const rows = await sql<{ status: SubStatus; ends_at: string | null }>`
      select status, ends_at from entitlements
      where user_id = ${userId} and kind = ${kind}
      order by updated_at desc
      limit 8
    `;
    const now = new Date();
    return rows.some((r) => {
      if (r.status === "refunded" || r.status === "revoked" || r.status === "expired") return false;
      if (!r.ends_at) return r.status === "active" || r.status === "trial";
      const end = new Date(r.ends_at);
      if (r.status === "trial") return end.getTime() > now.getTime();
      return isEntitled(r.status, end, now);
    });
  } catch {
    return false;
  }
}

export async function hasNyxaiPlus(sql: Sql, userId: string): Promise<boolean> {
  if (await hasEntitlement(sql, userId, "nyxai_plus")) return true;
  try {
    const rows = await sql<{ status: SubStatus; period_end: string; grace_until: string | null; product_id: string }>`
      select status, period_end, grace_until, product_id from subscriptions
      where user_id = ${userId}
        and (product_id like 'nyx.ai.%' or product_id like 'superomni.%')
      order by updated_at desc
      limit 8
    `;
    const now = new Date();
    return rows.some((r) => isEntitled(r.status, new Date(r.period_end), now, r.grace_until ? new Date(r.grace_until) : null));
  } catch {
    return false;
  }
}

export async function hasPremiumVerify(sql: Sql, userId: string): Promise<boolean> {
  return hasEntitlement(sql, userId, "premium_verify");
}

async function writeEntitlement(
  sql: Sql,
  opts: {
    userId: string;
    kind: EntitlementKind;
    source: EntitlementSource;
    status: SubStatus;
    productId?: string | null;
    subscriptionId?: string | null;
    startsAt: Date;
    endsAt: Date | null;
  },
): Promise<void> {
  const existing = await sql<{ id: string }>`
    select id from entitlements
    where user_id = ${opts.userId} and kind = ${opts.kind} and source = ${opts.source}
      and status in ('trial', 'active', 'grace', 'billing_retry', 'cancelled')
    order by updated_at desc
    limit 1
  `;
  const id = existing[0]?.id ?? newId("ent");
  const ends = opts.endsAt ? opts.endsAt.toISOString() : null;
  if (existing[0]) {
    await sql`
      update entitlements set
        status = ${opts.status},
        product_id = ${opts.productId ?? null},
        subscription_id = ${opts.subscriptionId ?? null},
        starts_at = ${opts.startsAt.toISOString()},
        ends_at = ${ends},
        updated_at = now()
      where id = ${id}
    `;
  } else {
    await sql`
      insert into entitlements (
        id, user_id, kind, source, status, product_id, subscription_id, starts_at, ends_at
      ) values (
        ${id}, ${opts.userId}, ${opts.kind}, ${opts.source}, ${opts.status},
        ${opts.productId ?? null}, ${opts.subscriptionId ?? null},
        ${opts.startsAt.toISOString()}, ${ends}
      )
    `;
  }
}

export async function applyPurchaseEntitlements(
  sql: Sql,
  opts: {
    userId: string;
    subscriptionId: string;
    productId: string;
    grants: EntitlementKind[];
    status: SubStatus;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<void> {
  const family = familyForProduct(opts.productId);
  const grants = opts.grants.filter((g) =>
    family === "nyxai" ? g === "nyxai_plus" : g === "premium_verify",
  );
  if (opts.status === "expired" || opts.status === "refunded" || opts.status === "revoked") {
    await sql`
      update entitlements set status = ${opts.status}, ends_at = now(), updated_at = now()
      where user_id = ${opts.userId}
        and source = 'purchase'
        and (subscription_id = ${opts.subscriptionId} or product_id = ${opts.productId})
        and status in ('trial', 'active', 'grace', 'billing_retry', 'cancelled')
    `;
  } else {
    for (const kind of grants) {
      await writeEntitlement(sql, {
        userId: opts.userId,
        kind,
        source: "purchase",
        status: opts.status,
        productId: opts.productId,
        subscriptionId: opts.subscriptionId,
        startsAt: opts.periodStart,
        endsAt: opts.periodEnd,
      });
    }
  }
  await syncPremiumFlag(sql, opts.userId);
}

async function grantArcKind(sql: Sql, userId: string, kind: EntitlementKind): Promise<void> {
  await writeEntitlement(sql, {
    userId,
    kind,
    source: "arc_grant",
    status: "active",
    startsAt: new Date(),
    endsAt: null,
  });
}

async function revokeArcKind(sql: Sql, userId: string, kind: EntitlementKind): Promise<void> {
  await sql`
    update entitlements set status = 'expired', ends_at = now(), updated_at = now()
    where user_id = ${userId} and kind = ${kind} and source = 'arc_grant'
      and status in ('trial', 'active', 'grace', 'billing_retry')
  `;
}

export async function grantArcNyxaiPlus(sql: Sql, userId: string): Promise<void> {
  try {
    await grantArcKind(sql, userId, "nyxai_plus");
    await syncPremiumFlag(sql, userId);
    await note(sql, userId, "arc_grant_nyxai", { source: "arc_grant" });
  } catch {
    /* 0018/0019 */
  }
}

export async function revokeArcNyxaiPlus(sql: Sql, userId: string): Promise<void> {
  try {
    await revokeArcKind(sql, userId, "nyxai_plus");
    await revokeArcKind(sql, userId, "premium_verify");
    await syncPremiumFlag(sql, userId);
    await note(sql, userId, "arc_grant_revoke", { source: "arc_grant" });
  } catch {
    /* ignore */
  }
}

/** Strip ordinary NYX Verified that was auto-granted only because of ARC Admin. Purchases stay. */
export async function stripArcOrdinaryVerify(sql: Sql): Promise<number> {
  let n = 0;
  try {
    const rows = await sql<{ user_id: string }>`
      update entitlements e
         set status = 'expired', ends_at = now(), updated_at = now()
       where e.kind = 'premium_verify'
         and e.source = 'arc_grant'
         and e.status in ('trial', 'active', 'grace', 'billing_retry', 'cancelled')
         and exists (
           select 1 from profiles p
           where p.user_id = e.user_id and coalesce(p.is_arc, false) = true
         )
      returning e.user_id
    `;
    const ids = [...new Set(rows.map((r) => r.user_id))];
    n = ids.length;
    for (const userId of ids) {
      await syncPremiumFlag(sql, userId);
      try {
        await sql`
          update profiles set
            is_verified = (verify_kind in ('org', 'founder', 'developer') or coalesce(is_premium, false)),
            updated_at = now()
          where user_id = ${userId} and coalesce(is_arc, false) = true
        `;
      } catch {
        /* ignore */
      }
    }
  } catch {
    n = 0;
  }
  return n;
}

export async function syncArcGrant(sql: Sql, userId: string, isArc: boolean): Promise<void> {
  if (isArc) await grantArcNyxaiPlus(sql, userId);
  else await revokeArcNyxaiPlus(sql, userId);
}

export async function syncPremiumFlag(sql: Sql, userId: string): Promise<boolean> {
  const on = await hasPremiumVerify(sql, userId);
  try {
    await sql`update profiles set is_premium = ${on} where user_id = ${userId}`;
  } catch {
    /* column may not exist yet */
  }
  return on;
}

void LIVE;
void isArcFlag;
