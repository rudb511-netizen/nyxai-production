import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import { scanText } from "../moderation";
import {
  OMNI_SUPPORT_DISPLAY,
  OMNI_SUPPORT_USER_ID,
  OMNI_SUPPORT_USERNAME,
} from "../omni-support-ids";
import { canAccessSafety, isProtectedAccount } from "../safety";
import { asVerifyKind } from "../types";
import { authorLite, canAccessSafetyDesk, getProfile, notify, notifySafetyTeam, type ProfileRow } from "./helpers";

export { OMNI_SUPPORT_USER_ID, OMNI_SUPPORT_USERNAME, OMNI_SUPPORT_DISPLAY };

const WELCOME =
  "Welcome to NYX — glad you’re here. This is your space for posts, stories, Flashes, and friends. Be kind, keep it real, and if something feels off you can report it. Have a good first day.";

export async function ensureOmniSupportUser(sql: Sql): Promise<ProfileRow> {
  const existing = await sql<ProfileRow>`
    select * from profiles where user_id = ${OMNI_SUPPORT_USER_ID} limit 1
  `;
  if (existing[0]) {
    if ((existing[0].bio ?? "").includes("cannot reply")) {
      await sql`
        update profiles set bio = ${"Official NYX Support. Message us anytime — ARC Admins read and reply here."}
        where user_id = ${OMNI_SUPPORT_USER_ID}
      `.catch(() => undefined);
    }
    return existing[0];
  }
  await sql.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())
     on conflict (id) do nothing`,
    [OMNI_SUPPORT_USER_ID, OMNI_SUPPORT_DISPLAY, "omnisupport@omnifeed.local"],
  );
  await sql`
    insert into profiles (
      user_id, username, username_lc, display_name, bio, onboarded, is_verified, verify_kind, role,
      who_can_message, who_can_friend, who_can_follow, ghost_mode
    )
    values (
      ${OMNI_SUPPORT_USER_ID}, ${OMNI_SUPPORT_USERNAME}, ${OMNI_SUPPORT_USERNAME}, ${OMNI_SUPPORT_DISPLAY},
      'Official NYX Support. Message us anytime — ARC Admins read and reply here.',
      true, true, 'none', 'user',
      'everyone', 'nobody', 'everyone', true
    )
    on conflict (user_id) do nothing
  `;
  const row = await sql<ProfileRow>`select * from profiles where user_id = ${OMNI_SUPPORT_USER_ID} limit 1`;
  if (!row[0]) throw new Error("NYX Support is not available.");
  return row[0];
}

export async function insertSupportMessage(sql: Sql, conversationId: string, text: string) {
  const id = newId("m");
  await sql`
    insert into messages (id, conversation_id, sender_id, kind, body)
    values (${id}, ${conversationId}, ${OMNI_SUPPORT_USER_ID}, 'text', ${text})
  `;
  await sql`
    update conversations
    set last_message_at = now(), last_message_body = ${`NYX Support: ${text.slice(0, 60)}`}
    where id = ${conversationId}
  `;
  return id;
}

export async function sendSupportDm(sql: Sql, userId: string, text: string) {
  if (userId === OMNI_SUPPORT_USER_ID) return;
  await ensureOmniSupportUser(sql);
  const { ensureDm } = await import("./messages");
  const convoId = await ensureDm(sql, OMNI_SUPPORT_USER_ID, userId);
  await insertSupportMessage(sql, convoId, text);
  await notify(sql, {
    userId,
    kind: "message",
    body: `NYX Support: ${text.slice(0, 80)}`,
    actorId: OMNI_SUPPORT_USER_ID,
    entityId: convoId,
    prefKey: "messages",
  });
}

export async function sendWelcome(sql: Sql, userId: string) {
  await sendSupportDm(sql, userId, WELCOME);
}

export function canMessageOmniSupport(actor: ProfileRow): boolean {
  return canAccessSafetyDesk(actor) || canAccessSafety(actor.role, asVerifyKind(actor.verify_kind));
}

export async function listArcAdmins(sql: Sql): Promise<ProfileRow[]> {
  const rows = await sql<ProfileRow>`
    select * from profiles
    where coalesce(is_arc, false) = true or verify_kind = 'arc'
  `.catch(async () =>
    sql<ProfileRow>`select * from profiles where verify_kind = 'arc'`,
  );
  return rows.filter((p) => p.user_id !== OMNI_SUPPORT_USER_ID);
}

export async function notifySupportAdmins(
  sql: Sql,
  opts: { conversationId: string; fromUserId: string; preview: string },
): Promise<void> {
  const from = await getProfile(sql, opts.fromUserId);
  const admins = await listArcAdmins(sql);
  const body = `${from?.display_name ?? "A member"} wrote NYX Support: ${opts.preview.slice(0, 80)}`;
  for (const admin of admins) {
    await notify(sql, {
      userId: admin.user_id,
      kind: "support",
      body,
      actorId: opts.fromUserId,
      entityId: opts.conversationId,
      prefKey: "messages",
    });
  }
}

export async function handleSupportCommand(sql: Sql, text: string): Promise<string> {
  const q = text.trim().toLowerCase();
  if (q === "help" || q === "/help" || q === "status" || q === "/status") {
    const open = await sql<{ n: number }>`select count(*)::int as n from reports where status = 'open'`;
    let warns = 0;
    try {
      const w = await sql<{ n: number }>`select count(*)::int as n from user_warnings where created_at > now() - interval '7 days'`;
      warns = w[0]?.n ?? 0;
    } catch {
      warns = 0;
    }
    return `NYX Support desk. Open reports: ${open[0]?.n ?? 0}. Warnings (7d): ${warns}. Review them in Safety. I never ban on my own.`;
  }
  if (q === "reports" || q === "/reports") {
    const rows = await sql<{ category: string; n: number }>`
      select category, count(*)::int as n from reports where status = 'open' group by category order by n desc limit 8
    `;
    if (!rows.length) return "No open reports.";
    return `Open reports:\n${rows.map((r) => `• ${r.category}: ${r.n}`).join("\n")}`;
  }
  return "Commands: help, status, reports. Punishments stay with administrators — I only warn and file reports.";
}

async function warningCount(sql: Sql, userId: string): Promise<number> {
  try {
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from user_warnings where user_id = ${userId}
    `;
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function moderateContent(
  sql: Sql,
  opts: {
    actorId: string;
    targetKind: "user" | "post" | "comment" | "video" | "video_comment" | "story" | "status" | "flash" | "sticker";
    targetId: string;
    text: string;
    username?: string;
  },
): Promise<void> {
  const hit = scanText(opts.text);
  if (!hit) return;
  const actor = await getProfile(sql, opts.actorId);
  if (!actor) return;
  if (
    isProtectedAccount({
      userId: actor.user_id,
      role: actor.role,
      verifyKind: asVerifyKind(actor.verify_kind),
      isArc: Boolean(actor.is_arc) || actor.verify_kind === "arc",
    })
  ) {
    return;
  }
  let inserted: { id: string }[] = [];
  try {
    inserted = await sql<{ id: string }>`
      insert into moderation_events (id, user_id, target_kind, target_id, category, evidence)
      values (
        ${newId("me")}, ${opts.actorId}, ${opts.targetKind}, ${opts.targetId}, ${hit.category}, ${hit.evidence}
      )
      on conflict (target_kind, target_id) do nothing
      returning id
    `;
  } catch {
    return;
  }
  if (!inserted[0]) return;

  await ensureOmniSupportUser(sql);
  const prior = await warningCount(sql, opts.actorId);
  const next = prior + 1;
  const warnBody =
    next === 1
      ? `Warning 1 of 3 — this looks like it may break NYX rules (${hit.reason}) We don’t punish on a first look. Please review the guidelines.`
      : next === 2
        ? `Warning 2 of 3 — another suspected violation (${hit.reason}) A third confirmed issue is sent to administrators.`
        : `Warning 3 of 3 — repeated suspected violations. Administrators have a priority report with your history. They decide any restriction.`;

  const reportId = newId("rp");
  const priority = next >= 3 || hit.severity === "high" ? "high" : "normal";
  try {
    await sql`
      insert into reports (id, reporter_id, target_kind, target_id, category, details, priority, source, evidence_json)
      values (
        ${reportId}, ${OMNI_SUPPORT_USER_ID}, ${opts.targetKind}, ${opts.targetId}, ${hit.category},
        ${`${hit.reason} @${opts.username ?? actor.username}`},
        ${priority}, 'omnisupport', ${JSON.stringify({ evidence: hit.evidence, warnings: next })}::jsonb
      )
    `;
  } catch {
    await sql`
      insert into reports (id, reporter_id, target_kind, target_id, category, details)
      values (
        ${reportId}, ${OMNI_SUPPORT_USER_ID}, ${opts.targetKind}, ${opts.targetId}, ${hit.category},
        ${`${hit.reason} @${opts.username ?? actor.username}`}
      )
    `;
  }
  try {
    await sql`
      insert into user_warnings (id, user_id, actor_id, category, body, evidence, target_kind, target_id, report_id)
      values (
        ${newId("uw")}, ${opts.actorId}, ${OMNI_SUPPORT_USER_ID}, ${hit.category}, ${warnBody},
        ${hit.evidence}, ${opts.targetKind}, ${opts.targetId}, ${reportId}
      )
    `;
  } catch {
    /* table may not exist until migrate */
  }
  await sendSupportDm(sql, opts.actorId, warnBody);
  const adminBody =
    next >= 3
      ? `Priority: @${actor.username} has 3+ warnings (${hit.category}). Review in Safety.`
      : `NYX Support flagged @${actor.username} for ${hit.category}.`;
  await notifySafetyTeam(sql, {
    body: adminBody,
    actorId: OMNI_SUPPORT_USER_ID,
    entityId: reportId,
  });
}

export async function getWarningStatus(sql: Sql, userId: string) {
  try {
    const rows = await sql<{
      id: string;
      category: string;
      body: string;
      created_at: string;
    }>`
      select id, category, body, created_at from user_warnings
      where user_id = ${userId}
      order by created_at desc limit 12
    `;
    return { count: rows.length, items: rows };
  } catch {
    return { count: 0, items: [] as { id: string; category: string; body: string; created_at: string }[] };
  }
}

export function supportAuthorLite() {
  return authorLite({
    user_id: OMNI_SUPPORT_USER_ID,
    username: OMNI_SUPPORT_USERNAME,
    username_lc: OMNI_SUPPORT_USERNAME,
    display_name: OMNI_SUPPORT_DISPLAY,
    bio: "",
    gender: null,
    date_of_birth: null,
    avatar_url: null,
    cover_url: null,
    is_private: false,
    is_verified: true,
    verify_kind: "none",
    role: "user",
    is_suspended: false,
    is_banned: false,
    last_seen_at: null,
    show_online: true,
    show_last_seen: false,
    read_receipts: true,
    who_can_message: "everyone",
    who_can_friend: "nobody",
    who_can_follow: "everyone",
    story_visibility: "friends",
    totp_enabled: false,
    totp_secret: null,
    totp_backup_hashes: null,
    totp_pending: false,
    theme: "system",
    notif_prefs: {},
    onboarded: true,
    pinned_post_id: null,
    created_at: new Date().toISOString(),
    score: 0,
    ghost_mode: true,
    last_lat: null,
    last_lng: null,
    last_geo_at: null,
  });
}
