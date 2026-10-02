import { getSql, type Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  canViewPrivateAccount,
  type Relation,
} from "../privacy";
import { DEFAULT_NOTIF_PREFS, type AuthorLite, type NotificationPrefs, identityKind, isArcFlag } from "../types";
import { parseRestrict, denyIfRestricted, type RestrictCaps, type RestrictKey } from "../restrict";
import { normalizeUsername, slugifyName, validateUsername } from "../usernames";
import { adminRank, canPunishTarget, RANK } from "../safety";

export type ProfileRow = {
  user_id: string;
  username: string;
  username_lc: string;
  display_name: string;
  bio: string;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  is_private: boolean;
  is_verified: boolean;
  verify_kind?: "none" | "org" | "founder" | "developer" | "arc";
  is_arc?: boolean;
  is_premium?: boolean;
  billing_country?: string | null;
  role: "user" | "moderator" | "admin" | "super_admin";
  is_suspended: boolean;
  is_banned: boolean;
  last_seen_at: string | null;
  show_online: boolean;
  show_last_seen: boolean;
  read_receipts: boolean;
  who_can_message: "everyone" | "friends" | "nobody";
  who_can_friend: "everyone" | "friends" | "nobody";
  who_can_follow: "everyone" | "friends" | "nobody";
  story_visibility: "everyone" | "friends" | "close";
  who_can_call?: "everyone" | "friends" | "nobody";
  status_privacy?: "friends" | "except" | "only";
  allow_status_reshare?: boolean;
  restrict_json?: unknown;
  sanction_until?: string | null;
  totp_enabled: boolean;
  totp_secret: string | null;
  totp_backup_hashes: string | null;
  totp_pending: boolean;
  theme: "light" | "dark" | "system";
  notif_prefs: NotificationPrefs | Record<string, unknown> | string;
  onboarded: boolean;
  pinned_post_id: string | null;
  created_at: string;
  score: number;
  ghost_mode: boolean;
  sound_prefs?: unknown;
  biometric_enabled?: boolean;
  voice_enhance?: string;
  last_lat: number | null;
  last_lng: number | null;
  last_geo_at: string | null;
  safe_mode?: boolean;
  focus_mode?: boolean;
  interests_set?: boolean;
  website?: string | null;
  location_name?: string | null;
  deactivated_at?: string | null;
  phone_e164?: string | null;
  phone_verified_at?: string | null;
};

export async function bumpScore(
  sql: Sql,
  userId: string,
  amount: number,
): Promise<void> {
  await sql`update profiles set score = score + ${amount} where user_id = ${userId}`;
}

export async function sqlClient(): Promise<Sql> {
  return getSql();
}

export function parsePrefs(raw: unknown): NotificationPrefs {
  const obj =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);
  return {
    messages: obj.messages !== false,
    friends: obj.friends !== false,
    followers: obj.followers !== false,
    likes: obj.likes !== false,
    comments: obj.comments !== false,
    live: obj.live !== false,
    stories: obj.stories !== false,
    streaks: obj.streaks !== false,
    messagePopup: obj.messagePopup !== false,
    messageReminders: obj.messageReminders !== false,
    mentions: obj.mentions !== false,
  };
}

export async function getProfile(
  sql: Sql,
  userId: string,
): Promise<ProfileRow | null> {
  await expireSanctions(sql, userId).catch(() => {});
  try {
    const { expireRestorations, maybeSweepMarks } = await import("./arc");
    await maybeSweepMarks(sql);
    await expireRestorations(sql, userId);
  } catch {
    /* 0014 may not exist yet */
  }
  const rows = await sql<ProfileRow>`
    select * from profiles where user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  try {
    const { reconcileProfile } = await import("./arc");
    return await reconcileProfile(sql, row);
  } catch {
    return row;
  }
}

export async function getProfileByUsername(
  sql: Sql,
  username: string,
): Promise<ProfileRow | null> {
  const lc = normalizeUsername(username);
  const found = await sql<{ user_id: string }>`
    select user_id from profiles where username_lc = ${lc} limit 1
  `;
  if (!found[0]) return null;
  return getProfile(sql, found[0].user_id);
}

async function uniqueUsername(sql: Sql, base: string): Promise<string> {
  let candidate = slugifyName(base);
  for (let i = 0; i < 12; i++) {
    const issue = validateUsername(candidate);
    if (!issue) {
      const exists = await sql<{ n: number }>`
        select count(*)::int as n from profiles where username_lc = ${candidate}
      `;
      if ((exists[0]?.n ?? 0) === 0) return candidate;
    }
    candidate = `${slugifyName(base).slice(0, 10)}${Math.floor(Math.random() * 90 + 10)}`;
  }
  return `user${Math.floor(Math.random() * 90000 + 10000)}`;
}

const profileCreates = new Map<string, Promise<ProfileRow>>();

export async function ensureProfile(
  sql: Sql,
  user: { id: string; displayName?: string | null; email?: string | null },
): Promise<ProfileRow> {
  const existing = await getProfile(sql, user.id);
  if (existing) {
    return existing;
  }

  const inflight = profileCreates.get(user.id);
  if (inflight) return inflight;

  const job = (async () => {
    try {
      const raced = await getProfile(sql, user.id);
      if (raced) return raced;

      const display = (user.displayName ?? user.email?.split("@")[0] ?? "Member").slice(0, 40);
      const username = await uniqueUsername(sql, display);

      await sql`
        insert into profiles (user_id, username, username_lc, display_name, role, notif_prefs)
        values (
          ${user.id},
          ${username},
          ${username},
          ${display},
          ${"user"},
          ${JSON.stringify(DEFAULT_NOTIF_PREFS)}::jsonb
        )
        on conflict (user_id) do nothing
      `;
      const created = await getProfile(sql, user.id);
      if (!created) throw new Error("Could not create profile");
      return created;
    } finally {
      profileCreates.delete(user.id);
    }
  })();

  profileCreates.set(user.id, job);
  return job;
}

export async function touchPresence(sql: Sql, userId: string): Promise<void> {
  await sql`update profiles set last_seen_at = now() where user_id = ${userId}`;
}

export async function getRelation(
  sql: Sql,
  viewerId: string,
  targetId: string,
): Promise<Relation> {
  if (viewerId === targetId) {
    return {
      isSelf: true,
      isBlocked: false,
      isBlockedBy: false,
      isFriend: true,
      isFollowing: false,
      isFollower: false,
      isCloseFriend: false,
      isContact: true,
      isMutualFollow: false,
    };
  }
  const [a, b] = friendPair(viewerId, targetId);
  const blocked = await sql<{ n: number }>`
    select count(*)::int as n from blocks where blocker_id = ${viewerId} and blocked_id = ${targetId}
  `;
  const blockedBy = await sql<{ n: number }>`
    select count(*)::int as n from blocks where blocker_id = ${targetId} and blocked_id = ${viewerId}
  `;
  const friend = await sql<{ n: number }>`
    select count(*)::int as n from friendships where user_a = ${a} and user_b = ${b}
  `;
  const follow = await sql<{ n: number }>`
    select count(*)::int as n from follows where follower_id = ${viewerId} and following_id = ${targetId}
  `;
  const follower = await sql<{ n: number }>`
    select count(*)::int as n from follows where follower_id = ${targetId} and following_id = ${viewerId}
  `;
  const close = await sql<{ n: number }>`
    select count(*)::int as n from close_friends where user_id = ${targetId} and friend_id = ${viewerId}
  `;
  let accepted = 0;
  try {
    const acc = await sql<{ n: number }>`
      select count(*)::int as n from friend_requests
      where status = 'accepted'
        and (
          (from_id = ${viewerId} and to_id = ${targetId})
          or (from_id = ${targetId} and to_id = ${viewerId})
        )
    `;
    accepted = acc[0]?.n ?? 0;
  } catch {
    accepted = 0;
  }
  let contact = 0;
  try {
    const shared = await sql<{ n: number }>`
      select count(*)::int as n
      from conversation_members a
      join conversation_members b on a.conversation_id = b.conversation_id
      where a.user_id = ${viewerId} and b.user_id = ${targetId}
    `;
    contact = shared[0]?.n ?? 0;
  } catch {
    contact = 0;
  }
  const isFollowing = (follow[0]?.n ?? 0) > 0;
  const isFollower = (follower[0]?.n ?? 0) > 0;
  return {
    isSelf: false,
    isBlocked: (blocked[0]?.n ?? 0) > 0,
    isBlockedBy: (blockedBy[0]?.n ?? 0) > 0,
    isFriend: (friend[0]?.n ?? 0) > 0 || accepted > 0,
    isFollowing,
    isFollower,
    isCloseFriend: (close[0]?.n ?? 0) > 0,
    isContact: contact > 0,
    isMutualFollow: isFollowing && isFollower,
  };
}

export function assertNotBanned(p: ProfileRow): void {
  if (p.is_banned) throw new Error("This account has been banned.");
  if (p.is_suspended) {
    const until = p.sanction_until ? new Date(p.sanction_until).getTime() : 0;
    if (!until || until > Date.now()) throw new Error("This account is suspended.");
  }
}

export function assertCapability(p: ProfileRow, key: RestrictKey): void {
  assertNotBanned(p);
  denyIfRestricted(parseRestrict(p.restrict_json), key);
}

export async function expireSanctions(sql: Sql, userId: string): Promise<void> {
  const expired = await sql<{ id: string }>`
    update sanctions set status = 'expired'
    where user_id = ${userId}
      and status = 'active'
      and ends_at is not null
      and ends_at < now()
    returning id
  `;
  if (expired.length === 0) return;
  const active = await sql<{ kind: string; capabilities: unknown; ends_at: string | null }>`
    select kind, capabilities, ends_at from sanctions
    where user_id = ${userId} and status = 'active'
    order by created_at desc
  `;
  const caps: RestrictCaps = {};
  let until: string | null = null;
  let suspended = false;
  for (const row of active) {
    if (row.kind === "restriction") Object.assign(caps, parseRestrict(row.capabilities));
    if (row.kind === "suspension") {
      suspended = true;
      until = row.ends_at;
    }
  }
  await sql`
    update profiles set
      restrict_json = ${JSON.stringify(caps)}::jsonb,
      is_suspended = ${suspended},
      sanction_until = ${until}
    where user_id = ${userId}
  `;
}

export function canSee(rel: Relation, target: ProfileRow): boolean {
  return canViewPrivateAccount(rel, target.is_private);
}

export function notificationPath(kind: string, entityId?: string | null): string {
  const id = (entityId ?? "").trim();
  if (kind === "friend_request" || kind === "friend_accept") return "/friends";
  if (kind === "follow") return "/alerts";
  if (kind === "gift") {
    if (id.startsWith("ls_") || id.startsWith("lv_")) return `/live/${id}`;
    if (id.startsWith("cv_")) return `/inbox/${id}`;
    return "/coins";
  }
  if (kind === "coins" || kind === "billing" || kind === "refund") return "/coins";
  if (kind === "call") return id ? `/call/${id}` : "/inbox";
  if (kind === "report") return "/alerts";
  if (kind === "sanction" || kind === "warning" || kind === "appeal" || kind === "security") return "/settings";
  if (kind.startsWith("live")) return id ? `/live/${id}` : "/live";
  if (
    kind === "message" ||
    kind === "message_reminder" ||
    kind === "group" ||
    kind === "support" ||
    kind === "story_reply" ||
    kind === "story_react"
  ) {
    return id ? `/inbox/${id}` : "/inbox";
  }
  if (id.startsWith("v_")) return `/watch?v=${encodeURIComponent(id)}`;
  if (id.startsWith("p_")) return `/p/${id}`;
  if (id.startsWith("cv_")) return `/inbox/${id}`;
  if (id.startsWith("fl_")) return `/flash/${id}`;
  if (kind === "like" || kind === "comment" || kind === "repost" || kind === "quote") {
    return id ? `/p/${id}` : "/alerts";
  }
  if (
    kind === "video_like" ||
    kind === "video_comment" ||
    kind === "video_share" ||
    kind === "comment_reply" ||
    kind === "comment_like" ||
    kind === "mention"
  ) {
    return id ? `/watch?v=${encodeURIComponent(id)}` : "/watch";
  }
  return "/alerts";
}

export async function notify(
  sql: Sql,
  opts: {
    userId: string;
    kind: string;
    body: string;
    actorId?: string | null;
    entityId?: string | null;
    prefKey?: keyof NotificationPrefs;
  },
): Promise<void> {
  if (opts.userId === opts.actorId) return;
  if (opts.actorId) {
    const rel = await getRelation(sql, opts.userId, opts.actorId);
    if (rel.isBlocked || rel.isBlockedBy) return;
  }
  const target = await getProfile(sql, opts.userId);
  if (!target) return;
  const prefs = parsePrefs(target.notif_prefs);
  if (opts.prefKey && prefs[opts.prefKey] === false) return;
  if (target.focus_mode && opts.kind !== "message" && opts.kind !== "call" && opts.kind !== "security") {
    if (opts.kind === "like" || opts.kind === "comment" || opts.kind === "follow" || opts.kind === "repost" || opts.kind === "live" || opts.kind === "story" || opts.kind === "streak") return;
  }
  await sql`
    insert into notifications (id, user_id, kind, actor_id, entity_id, body)
    values (
      ${newId("nt")},
      ${opts.userId},
      ${opts.kind},
      ${opts.actorId ?? null},
      ${opts.entityId ?? null},
      ${opts.body}
    )
  `;
  const path = notificationPath(opts.kind, opts.entityId);
  void import("./device-push")
    .then((m) =>
      m.pushDeviceNotification(sql, {
        userId: opts.userId,
        title: "NYX",
        body: opts.body,
        path,
      }),
    )
    .catch(() => undefined);
}

export function authorLite(p: ProfileRow): AuthorLite {
  return {
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    verifyKind: identityKind(p.verify_kind),
    isArc: isArcFlag(p),
    isPremium: Boolean(p.is_premium),
  };
}

export function isOnline(p: ProfileRow, viewerCanSee: boolean): boolean {
  if (!viewerCanSee || !p.show_online || !p.last_seen_at) return false;
  return Date.now() - new Date(p.last_seen_at).getTime() < 90_000;
}

export async function loadAuthors(sql: Sql, ids: string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, ProfileRow>();
  if (unique.length === 0) return map;
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(",");
  const rows = await sql.query<ProfileRow>(
    `select * from profiles where user_id in (${placeholders})`,
    unique,
  );
  for (const r of rows) map.set(r.user_id, r);
  return map;
}

export function requireStaff(p: ProfileRow): void {
  if (!["moderator", "admin", "super_admin"].includes(p.role)) {
    throw new Error("Moderator access required.");
  }
}

export function requireAdmin(p: ProfileRow): void {
  if (!["admin", "super_admin"].includes(p.role)) {
    throw new Error("Admin access required.");
  }
}

export function canAccessSafetyDesk(p: ProfileRow): boolean {
  if (p.user_id === "omni_ai_system" || p.user_id === "omni_support_system") return false;
  const kind = identityKind(p.verify_kind);
  return (
    ["moderator", "admin", "super_admin"].includes(p.role) ||
    isArcFlag(p) ||
    kind === "org" ||
    kind === "founder" ||
    kind === "developer"
  );
}

export function requireSafety(p: ProfileRow): void {
  if (!canAccessSafetyDesk(p)) {
    throw new Error("Safety access required.");
  }
}

export function requireArc(p: ProfileRow): void {
  if (!isArcFlag(p)) {
    throw new Error("ARC access required.");
  }
}

export function assertCanPunish(actor: ProfileRow, target: ProfileRow): void {
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
    const t = adminRank(
      target.role,
      identityKind(target.verify_kind),
      target.user_id,
      isArcFlag(target),
    );
    if (t >= RANK.arc) throw new Error("ARC administrators cannot be sanctioned.");
    throw new Error("Administrators cannot be sanctioned.");
  }
}

export async function notifySafetyTeam(
  sql: Sql,
  opts: { body: string; actorId: string; entityId?: string | null },
): Promise<void> {
  const people = await sql<{ user_id: string }>`
    select user_id from profiles
    where is_banned = false
      and (
        role in ('moderator', 'admin', 'super_admin')
        or verify_kind in ('org', 'founder', 'developer', 'arc')
        or is_arc = true
      )
  `;
  for (const p of people) {
    if (p.user_id === opts.actorId) continue;
    if (p.user_id === "omni_ai_system" || p.user_id === "omni_support_system") continue;
    await notify(sql, {
      userId: p.user_id,
      kind: "report",
      body: opts.body,
      actorId: opts.actorId,
      entityId: opts.entityId ?? null,
    });
  }
}

export function friendPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
