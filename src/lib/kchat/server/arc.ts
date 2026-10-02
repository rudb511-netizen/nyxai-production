import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import { adminRank, canManageAdministrator, canPunishTarget, RANK } from "../safety";
import { asVerifyKind, identityKind, isArcFlag, type VerifyKind } from "../types";
import { roleForKind } from "./mark-code";
import type { ProfileRow } from "./helpers";

export async function claimArcSeat(sql: Sql, userId: string): Promise<number> {
  const existing = await sql<{ seat: number }>`
    select seat from mark_seats where kind = 'arc' and user_id = ${userId} limit 1
  `;
  if (existing[0]) {
    try {
      const { syncArcGrant } = await import("./entitlements");
      await syncArcGrant(sql, userId, true);
    } catch {
      /* 0018 */
    }
    return existing[0].seat;
  }
  for (const seat of [1, 2, 3] as const) {
    try {
      await sql`
        insert into mark_seats (kind, seat, user_id)
        values ('arc', ${seat}, ${userId})
      `;
      try {
        const { syncArcGrant } = await import("./entitlements");
        await syncArcGrant(sql, userId, true);
      } catch {
        /* 0018 */
      }
      return seat;
    } catch {
      /* seat taken or unique user race */
    }
  }
  const raced = await sql<{ seat: number }>`
    select seat from mark_seats where kind = 'arc' and user_id = ${userId} limit 1
  `;
  if (raced[0]) return raced[0].seat;
  throw new Error("That code didn’t work.");
}

export async function sweepUnauthorizedMarks(sql: Sql): Promise<number> {
  let n = 0;
  try {
    const founder = await sql<{ user_id: string }>`
      update profiles
      set
        verify_kind = 'none',
        is_verified = coalesce(is_premium, false),
        role = case when coalesce(is_arc, false) then 'super_admin' else 'user' end,
        updated_at = now()
      where verify_kind = 'founder'
        and user_id not in (select user_id from mark_redemptions where kind = 'founder')
      returning user_id
    `;
    n += founder.length;
  } catch {
    /* ignore */
  }
  try {
    const arc = await sql<{ user_id: string }>`
      update profiles
      set
        is_arc = false,
        role = case
          when verify_kind = 'founder' then 'super_admin'
          when verify_kind in ('org', 'developer') then 'admin'
          else 'user'
        end,
        is_verified = verify_kind in ('org', 'founder', 'developer'),
        updated_at = now()
      where is_arc = true
        and user_id not in (select user_id from mark_seats where kind = 'arc')
      returning user_id
    `;
    n += arc.length;
    for (const row of arc) {
      try {
        const { syncArcGrant } = await import("./entitlements");
        await syncArcGrant(sql, row.user_id, false);
      } catch {
        /* 0018 */
      }
    }
  } catch {
    /* table may not exist until 0016 */
  }
  try {
    const legacy = await sql<{ user_id: string }>`
      update profiles
      set
        verify_kind = 'none',
        is_arc = true,
        is_verified = coalesce(is_premium, false),
        role = 'super_admin',
        updated_at = now()
      where verify_kind = 'arc'
        and user_id in (select user_id from mark_seats where kind = 'arc')
      returning user_id
    `;
    n += legacy.length;
  } catch {
    /* ignore */
  }
  return n;
}

let lastSweep = 0;
export async function maybeSweepMarks(sql: Sql): Promise<void> {
  if (Date.now() - lastSweep < 12_000) return;
  lastSweep = Date.now();
  await sweepUnauthorizedMarks(sql);
  try {
    const { stripArcOrdinaryVerify } = await import("./entitlements");
    await stripArcOrdinaryVerify(sql);
  } catch {
    /* 0018 */
  }
}

export async function reconcileProfile(sql: Sql, p: ProfileRow): Promise<ProfileRow> {
  let row = p;
  const seated = async (): Promise<boolean> => {
    try {
      const ok = await sql<{ n: number }>`
        select count(*)::int as n from mark_seats where kind = 'arc' and user_id = ${row.user_id}
      `;
      return (ok[0]?.n ?? 0) > 0;
    } catch {
      return false;
    }
  };

  if (asVerifyKind(row.verify_kind) === "arc") {
    const hasSeat = await seated();
    let ident: VerifyKind = "none";
    try {
      const prev = await sql<{ previous_kind: string }>`
        select previous_kind from badge_events
        where user_id = ${row.user_id} and badge = 'arc' and previous_kind in ('org', 'founder', 'developer')
        order by created_at desc limit 1
      `;
      ident = identityKind(prev[0]?.previous_kind);
    } catch {
      ident = "none";
    }
    try {
      await sql`
        update profiles set
          verify_kind = ${ident},
          is_arc = ${hasSeat},
          is_verified = ${ident !== "none"},
          role = ${hasSeat ? "super_admin" : roleForKind(ident)},
          updated_at = now()
        where user_id = ${row.user_id}
      `;
    } catch {
      /* ignore */
    }
    const next = await sql<ProfileRow>`select * from profiles where user_id = ${row.user_id} limit 1`;
    if (next[0]) row = next[0];
  }

  if (isArcFlag(row)) {
    const hasSeat = await seated();
    if (!hasSeat) {
      const ident = identityKind(row.verify_kind);
      try {
        await sql`
          update profiles set
            is_arc = false,
            role = ${roleForKind(ident)},
            is_verified = ${ident !== "none"},
            updated_at = now()
          where user_id = ${row.user_id}
        `;
      } catch {
        /* ignore */
      }
      const next = await sql<ProfileRow>`select * from profiles where user_id = ${row.user_id} limit 1`;
      if (next[0]) row = next[0];
    }
  }

  const kind = identityKind(row.verify_kind);
  if (kind === "founder") {
    try {
      const ok = await sql<{ n: number }>`
        select count(*)::int as n from mark_redemptions where kind = 'founder' and user_id = ${row.user_id}
      `;
      if ((ok[0]?.n ?? 0) === 0) {
        const keepArc = isArcFlag(row);
        await sql`
          update profiles set
            verify_kind = 'none',
            is_verified = ${Boolean(row.is_premium)},
            role = ${keepArc ? "super_admin" : row.role === "moderator" ? "moderator" : "user"},
            updated_at = now()
          where user_id = ${row.user_id}
        `;
        const next = await sql<ProfileRow>`select * from profiles where user_id = ${row.user_id} limit 1`;
        return next[0] ?? { ...row, verify_kind: "none", is_verified: Boolean(row.is_premium) };
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const { syncArcGrant } = await import("./entitlements");
    await syncArcGrant(sql, row.user_id, isArcFlag(row));
  } catch {
    /* 0018 */
  }
  return row;
}

export async function expireRestorations(sql: Sql, userId: string): Promise<void> {
  let due: {
    id: string;
    restore_kind: string;
    restore_role: string;
    restore_verified: boolean;
  }[] = [];
  try {
    due = await sql`
      update pending_restorations
      set status = 'applied'
      where user_id = ${userId} and status = 'pending' and ends_at <= now()
      returning id, restore_kind, restore_role, restore_verified
    `;
  } catch {
    return;
  }
  for (const r of due) {
    const kind = identityKind(r.restore_kind);
    let keepArc = false;
    try {
      const cur = await sql<{ is_arc: boolean }>`select is_arc from profiles where user_id = ${userId} limit 1`;
      keepArc = Boolean(cur[0]?.is_arc);
    } catch {
      keepArc = false;
    }
    const nextRole = keepArc ? "super_admin" : r.restore_role;
    await sql`
      update profiles set
        verify_kind = ${kind},
        role = ${nextRole},
        is_verified = ${kind !== "none"},
        updated_at = now()
      where user_id = ${userId}
    `;
    try {
      await sql`
        insert into badge_events (
          id, user_id, actor_id, action, badge, previous_kind, previous_role, new_kind, new_role, reason, status
        )
        values (
          ${newId("be")}, ${userId}, 'omni_support_system', 'restore', ${kind},
          'none', 'user', ${kind}, ${r.restore_role}, 'Timed restoration', 'applied'
        )
      `;
    } catch {
      /* ignore */
    }
    try {
      await sql`delete from mark_blocks where user_id = ${userId}`;
    } catch {
      /* ignore */
    }
  }
}

export async function revokeUserSessions(sql: Sql, userId: string): Promise<void> {
  try {
    await sql.query(`delete from "session" where "userId" = $1`, [userId]);
  } catch {
    /* auth table names may differ */
  }
}

export function assertCanPunishRank(actor: ProfileRow, target: ProfileRow): void {
  if (target.user_id === actor.user_id) {
    throw new Error("You cannot sanction your own account this way.");
  }
  if (
    !canPunishTarget({
      actorId: actor.user_id,
      actorRole: actor.role,
      actorVerifyKind: identityKind(actor.verify_kind),
      actorIsArc: isArcFlag(actor),
      target: {
        userId: target.user_id,
        role: target.role,
        verifyKind: identityKind(target.verify_kind),
        isArc: isArcFlag(target),
      },
    })
  ) {
    const t = adminRank(target.role, identityKind(target.verify_kind), target.user_id, isArcFlag(target));
    if (t >= RANK.arc) throw new Error("ARC administrators cannot be sanctioned.");
    throw new Error("Administrators cannot be sanctioned.");
  }
}

export function assertCanManageAdmin(actor: ProfileRow, target: ProfileRow): void {
  if (!isArcFlag(actor)) {
    throw new Error("ARC access required.");
  }
  if (target.user_id === actor.user_id) {
    throw new Error("You cannot change your own ARC account this way.");
  }
  if (
    !canManageAdministrator({
      actorId: actor.user_id,
      actorRole: actor.role,
      actorVerifyKind: identityKind(actor.verify_kind),
      actorIsArc: true,
      target: {
        userId: target.user_id,
        role: target.role,
        verifyKind: identityKind(target.verify_kind),
        isArc: isArcFlag(target),
      },
    })
  ) {
    if (isArcFlag(target)) throw new Error("ARC administrators cannot manage each other.");
    throw new Error("That account is not an administrator.");
  }
}

export async function isMarkBlocked(sql: Sql, userId: string, kind: string): Promise<boolean> {
  try {
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from mark_blocks
      where user_id = ${userId} and (kind = ${kind} or kind = 'all')
    `;
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function blockMarks(
  sql: Sql,
  userId: string,
  kinds: string[],
  actorId: string,
  reason: string,
): Promise<void> {
  for (const kind of kinds) {
    try {
      await sql`
        insert into mark_blocks (user_id, kind, actor_id, reason)
        values (${userId}, ${kind}, ${actorId}, ${reason.slice(0, 400)})
        on conflict (user_id, kind) do update set
          actor_id = excluded.actor_id,
          reason = excluded.reason,
          created_at = now()
      `;
    } catch {
      /* ignore */
    }
  }
}

export async function clearMarkBlocks(sql: Sql, userId: string): Promise<void> {
  try {
    await sql`delete from mark_blocks where user_id = ${userId}`;
  } catch {
    /* ignore */
  }
}

export async function logBadgeEvent(
  sql: Sql,
  opts: {
    userId: string;
    actorId: string;
    action: string;
    badge: string;
    previousKind: string;
    previousRole: string;
    newKind: string;
    newRole: string;
    reason: string;
    durationDays?: number | null;
    endsAt?: string | null;
    status?: string;
  },
): Promise<void> {
  try {
    await sql`
      insert into badge_events (
        id, user_id, actor_id, action, badge, previous_kind, previous_role, new_kind, new_role,
        reason, duration_days, ends_at, status
      )
      values (
        ${newId("be")}, ${opts.userId}, ${opts.actorId}, ${opts.action.slice(0, 40)}, ${opts.badge.slice(0, 40)},
        ${opts.previousKind}, ${opts.previousRole}, ${opts.newKind}, ${opts.newRole},
        ${opts.reason.slice(0, 400)}, ${opts.durationDays ?? null}, ${opts.endsAt ?? null},
        ${opts.status ?? "active"}
      )
    `;
  } catch {
    /* ignore */
  }
}

export async function applyAdminDemotion(
  sql: Sql,
  opts: {
    actor: ProfileRow;
    target: ProfileRow;
    action: "demote" | "revoke_badge" | "restore";
    badge?: "org" | "founder" | "developer" | "all";
    days?: number | null;
    reason: string;
  },
): Promise<{ ok: true; verifyKind: VerifyKind; role: string }> {
  const reason = opts.reason.trim();
  if (reason.length < 8) throw new Error("Explain why this change is needed.");
  const prevKind = identityKind(opts.target.verify_kind);
  const prevRole = opts.target.role;

  if (opts.action === "restore") {
    if (!isArcFlag(opts.actor)) {
      throw new Error("ARC access required.");
    }
    if (opts.target.user_id === opts.actor.user_id) {
      throw new Error("You cannot change your own ARC account this way.");
    }
    if (isArcFlag(opts.target)) {
      throw new Error("ARC administrators cannot manage each other.");
    }
    let kind: VerifyKind = "none";
    let role: "user" | "admin" | "super_admin" | "moderator" = "user";
    try {
      const pending = await sql<{
        id: string;
        restore_kind: string;
        restore_role: string;
        restore_verified: boolean;
      }>`
        select id, restore_kind, restore_role, restore_verified
        from pending_restorations
        where user_id = ${opts.target.user_id} and status = 'pending'
        order by created_at desc limit 1
      `;
      if (pending[0]) {
        kind = identityKind(pending[0].restore_kind);
        role = (["admin", "super_admin", "moderator"].includes(pending[0].restore_role)
          ? pending[0].restore_role
          : roleForKind(kind)) as typeof role;
        await sql`update pending_restorations set status = 'restored' where id = ${pending[0].id}`;
      }
    } catch {
      /* ignore */
    }
    if (kind === "none") {
      const badge = opts.badge && opts.badge !== "all" ? opts.badge : null;
      if (!badge) throw new Error("Nothing to restore.");
      kind = badge;
      role = roleForKind(kind);
    }
    const keepArc = isArcFlag(opts.target);
    const nextRole = keepArc ? "super_admin" : role;
    await clearMarkBlocks(sql, opts.target.user_id);
    await sql`
      update profiles set
        verify_kind = ${kind},
        role = ${nextRole},
        is_verified = true,
        updated_at = now()
      where user_id = ${opts.target.user_id}
    `;
    await logBadgeEvent(sql, {
      userId: opts.target.user_id,
      actorId: opts.actor.user_id,
      action: "restore",
      badge: kind,
      previousKind: prevKind,
      previousRole: prevRole,
      newKind: kind,
      newRole: role,
      reason,
      status: "restored",
    });
    return { ok: true, verifyKind: kind, role: nextRole };
  }

  assertCanManageAdmin(opts.actor, opts.target);

  const days = opts.days && opts.days > 0 ? Math.min(opts.days, 365) : null;
  const endsAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const keepArc = isArcFlag(opts.target);
  if (keepArc) {
    throw new Error("ARC administrators cannot manage each other.");
  }
  if (opts.action === "revoke_badge") {
    await sql`
      update profiles set
        verify_kind = 'none',
        is_verified = false,
        role = 'user',
        updated_at = now()
      where user_id = ${opts.target.user_id}
    `;
  } else {
    await sql`
      update profiles set
        verify_kind = 'none',
        is_verified = false,
        role = 'user',
        updated_at = now()
      where user_id = ${opts.target.user_id}
    `;
  }
  if (endsAt) {
    try {
      await sql`
        insert into pending_restorations (
          id, user_id, restore_kind, restore_role, restore_verified, ends_at, reason, actor_id, status
        )
        values (
          ${newId("pr")}, ${opts.target.user_id}, ${prevKind}, ${prevRole}, true,
          ${endsAt}, ${reason.slice(0, 400)}, ${opts.actor.user_id}, 'pending'
        )
      `;
    } catch {
      /* ignore */
    }
  }
  await logBadgeEvent(sql, {
    userId: opts.target.user_id,
    actorId: opts.actor.user_id,
    action: opts.action,
    badge: opts.badge ?? prevKind,
    previousKind: prevKind,
    previousRole: prevRole,
    newKind: "none",
    newRole: "user",
    reason,
    durationDays: days,
    endsAt,
    status: endsAt ? "timed" : "permanent",
  });
  await blockMarks(
    sql,
    opts.target.user_id,
    [prevKind === "none" ? "all" : prevKind, "all"],
    opts.actor.user_id,
    reason,
  );
  await revokeUserSessions(sql, opts.target.user_id);
  return { ok: true, verifyKind: "none", role: "user" };
}

export function isArcRow(p: ProfileRow): boolean {
  return isArcFlag(p);
}
