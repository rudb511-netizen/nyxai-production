import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canFollow, canFriendRequest, canMessage, canViewStory } from "../privacy";
import {
  identityKind,
  isArcFlag,
  isOfficialKind,
  type MeProfile,
  type NotificationPrefs,
  type PublicProfile,
  type ThemePref,
} from "../types";
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  totpOtpauthUrl,
  verifyTotp,
} from "../totp";
import {
  normalizeUsername,
  usernameError,
  validateUsername,
} from "../usernames";
import { takeToken, rateError } from "../rate-limit";
import { parseRestrict } from "../restrict";
import { DEFAULT_SOUND_PREFS, parseSoundPrefs } from "../sounds";
import {
  assertNotBanned,
  authorLite,
  canSee,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  getRelation,
  isOnline,
  parsePrefs,
  sqlClient,
  touchPresence,
  type ProfileRow,
} from "./helpers";

function toPublic(
  p: ProfileRow,
  stats: { followers: number; following: number; friends: number; posts: number },
  viewer: {
    isSelf: boolean;
    isFollowing: boolean;
    isFollower: boolean;
    isFriend: boolean;
    friendRequest: PublicProfile["friendRequest"];
    isBlocked: boolean;
    canSeePresence: boolean;
  },
): PublicProfile {
  return {
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    bio: p.bio,
    gender: p.gender,
    avatarUrl: p.avatar_url,
    coverUrl: p.cover_url,
    isPrivate: p.is_private,
    isVerified: isOfficialKind(identityKind(p.verify_kind)) || Boolean(p.is_premium),
    verifyKind: identityKind(p.verify_kind),
    isArc: isArcFlag(p),
    isPremium: Boolean(p.is_premium),
    followers: stats.followers,
    following: stats.following,
    friends: stats.friends,
    posts: stats.posts,
    isSelf: viewer.isSelf,
    isFollowing: viewer.isFollowing,
    isFollower: viewer.isFollower,
    isFriend: viewer.isFriend,
    friendRequest: viewer.friendRequest,
    isBlocked: viewer.isBlocked,
    isOnline: isOnline(p, viewer.canSeePresence),
    lastSeenAt:
      viewer.canSeePresence && p.show_last_seen ? p.last_seen_at : null,
    createdAt: p.created_at,
    website: p.website ?? null,
    location: p.location_name ?? null,
    isDeactivated: Boolean(p.deactivated_at),
  };
}

async function statsFor(sql: Awaited<ReturnType<typeof sqlClient>>, userId: string) {
  const [followers, following, friends, posts] = await Promise.all([
    sql<{ n: number }>`select count(*)::int as n from follows where following_id = ${userId}`,
    sql<{ n: number }>`select count(*)::int as n from follows where follower_id = ${userId}`,
    sql<{ n: number }>`select count(*)::int as n from friendships where user_a = ${userId} or user_b = ${userId}`,
    sql<{ n: number }>`select count(*)::int as n from posts where author_id = ${userId} and is_removed = false`,
  ]);
  return {
    followers: followers[0]?.n ?? 0,
    following: following[0]?.n ?? 0,
    friends: friends[0]?.n ?? 0,
    posts: posts[0]?.n ?? 0,
  };
}

async function friendRequestState(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  viewerId: string,
  targetId: string,
): Promise<PublicProfile["friendRequest"]> {
  const r = (
    await sql<{ from_id: string; status: string }>`
      select from_id, status from friend_requests
      where status = 'pending' and (
        (from_id = ${viewerId} and to_id = ${targetId}) or
        (from_id = ${targetId} and to_id = ${viewerId})
      )
      limit 1
    `
  )[0];
  if (!r) return "none";
  return r.from_id === viewerId ? "outgoing" : "incoming";
}

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    await touchPresence(sql, context.userId);
    let superOmniActive = false;
    let isPremium = Boolean(me.is_premium);
    try {
      const { loadSuperOmni } = await import("./billing");
      const so = await loadSuperOmni(sql, context.userId);
      superOmniActive = so.nyxaiPlus;
      isPremium = so.premiumVerify;
    } catch {
      /* billing tables may not exist yet */
    }
    try {
      const recent = await sql<{ n: number }>`
        select count(*)::int as n from login_events
        where user_id = ${context.userId} and created_at > now() - interval '12 hours'
      `;
      if ((recent[0]?.n ?? 0) === 0) {
        const { recordLoginEvent } = await import("./security-log.server");
        await recordLoginEvent(sql, context.userId, "success");
      }
    } catch {
      /* ignore */
    }
    try {
      const { expireChatMessages, sweepMessageReminders } = await import("./chat-custom");
      await expireChatMessages(sql);
      await sweepMessageReminders(sql, context.userId);
    } catch {
      /* 0026 may not be applied yet */
    }
    try {
      const { publishDueScheduledPosts } = await import("./graph");
      await publishDueScheduledPosts(sql);
    } catch {
      /* 0028 */
    }
    return {
      ok: true as const,
      verifyKind: identityKind(me.verify_kind),
      role: me.role,
      isArc: isArcFlag(me),
      isPremium,
      superOmniActive,
    };
  });

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MeProfile> => {
    const sql = await sqlClient();
    const p = await ensureProfile(sql, { id: context.userId });
    await touchPresence(sql, context.userId);
    const st = await statsFor(sql, p.user_id);
    const authRows = await sql.query<{ email: string | null; emailVerified: boolean | null }>(
      `select email, "emailVerified" as "emailVerified" from "user" where id = $1`,
      [context.userId],
    );
    let superOmni: MeProfile["superOmni"] = { active: false, status: "none", plan: null, renewsAt: null };
    let nyxaiPlus: MeProfile["nyxaiPlus"] = { active: false, source: "none" };
    let premiumVerify: MeProfile["premiumVerify"] = { active: false, source: "none" };
    let isPremium = Boolean(p.is_premium);
    try {
      const { loadSuperOmni } = await import("./billing");
      const so = await loadSuperOmni(sql, context.userId);
      superOmni = { active: so.nyxaiPlus, status: so.status, plan: so.plan, renewsAt: so.renewsAt };
      nyxaiPlus = { active: so.nyxaiPlus, source: so.plus.source };
      premiumVerify = { active: so.premiumVerify, source: so.verify.source };
      isPremium = so.premiumVerify;
    } catch {
      /* billing tables may not exist yet */
    }
    return {
      ...toPublic(p, st, {
        isSelf: true,
        isFollowing: false,
        isFollower: false,
        isFriend: false,
        friendRequest: "none",
        isBlocked: false,
        canSeePresence: true,
      }),
      isPremium,
      email: authRows[0]?.email ?? null,
      emailVerified: Boolean(authRows[0]?.emailVerified),
      dateOfBirth: p.date_of_birth,
      role: p.role,
      onboarded: p.onboarded && Boolean(p.gender) && Boolean(p.date_of_birth),
      totpEnabled: p.totp_enabled,
      theme: p.theme,
      showOnline: p.show_online,
      showLastSeen: p.show_last_seen,
      readReceipts: p.read_receipts,
      whoCanMessage: p.who_can_message,
      whoCanFriend: p.who_can_friend,
      whoCanFollow: p.who_can_follow,
      whoCanCall: p.who_can_call ?? "friends",
      storyVisibility: p.story_visibility,
      statusPrivacy: (p.status_privacy as MeProfile["statusPrivacy"]) ?? "friends",
      allowStatusReshare: p.allow_status_reshare !== false,
      isSuspended: p.is_suspended,
      isBanned: p.is_banned,
      restrict: parseRestrict(p.restrict_json) as Record<string, boolean>,
      sanctionUntil: p.sanction_until ?? null,
      notifPrefs: parsePrefs(p.notif_prefs),
      score: p.score ?? 0,
      ghostMode: p.ghost_mode !== false,
      soundPrefs: parseSoundPrefs(p.sound_prefs),
      biometricEnabled: Boolean(p.biometric_enabled),
      safeMode: Boolean(p.safe_mode),
      focusMode: Boolean(p.focus_mode),
      interestsSet: Boolean(p.interests_set),
      website: p.website ?? null,
      location: p.location_name ?? null,
      deactivatedAt: p.deactivated_at ?? null,
      phone: p.phone_e164 ?? null,
      phoneVerified: Boolean(p.phone_verified_at),
      nyxaiPlus,
      premiumVerify,
      superOmni,
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .validator((d: {
    username: string;
    displayName: string;
    gender: "male" | "female";
    dateOfBirth: string;
    bio?: string;
    avatarUrl?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`onboard:${context.userId}`, 8, 60 * 60 * 1000);
    if (wait) throw new Error(rateError(wait));
    const p = await ensureProfile(sql, {
      id: context.userId,
      displayName: data.displayName,
    });
    const uname = normalizeUsername(data.username);
    const issue = validateUsername(uname);
    if (issue) throw new Error(usernameError(issue));
    if (
      ((
        await sql<{ n: number }>`
          select count(*)::int as n from profiles
          where username_lc = ${uname} and user_id <> ${context.userId}
        `
      )[0]?.n ?? 0) > 0
    ) {
      throw new Error(usernameError("taken"));
    }
    const dob = new Date(data.dateOfBirth);
    if (Number.isNaN(dob.getTime())) throw new Error("Enter a valid date of birth.");
    if ((Date.now() - dob.getTime()) / 31_557_600_000 < 13) {
      throw new Error("You must be at least 13 to use NYX.");
    }
    if (data.gender !== "male" && data.gender !== "female") {
      throw new Error("Please select Male or Female.");
    }
    const display = data.displayName.trim().slice(0, 40);
    if (display.length < 2) throw new Error("Display name is too short.");
    await sql`
      update profiles set
        username = ${uname},
        username_lc = ${uname},
        display_name = ${display},
        gender = ${data.gender},
        date_of_birth = ${data.dateOfBirth},
        bio = ${(data.bio ?? "").slice(0, 160)},
        avatar_url = ${data.avatarUrl ?? p.avatar_url},
        onboarded = true,
        updated_at = now()
      where user_id = ${context.userId}
    `;
    try {
      const { sendWelcome } = await import("./omni-support");
      await Promise.race([
        sendWelcome(sql, context.userId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("welcome-timeout")), 4000)),
      ]);
    } catch {
      /* welcome is best-effort and must not block signup */
    }
    return { ok: true as const };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .validator((d: {
    username?: string;
    displayName?: string;
    bio?: string;
    avatarUrl?: string | null;
    coverUrl?: string | null;
    website?: string | null;
    location?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p) throw new Error("Profile not found.");
    assertNotBanned(p);
    let username = p.username;
    let usernameLc = p.username_lc;
    if (data.username && normalizeUsername(data.username) !== p.username_lc) {
      const uname = normalizeUsername(data.username);
      const issue = validateUsername(uname);
      if (issue) throw new Error(usernameError(issue));
      if (
        ((
          await sql<{ n: number }>`
            select count(*)::int as n from profiles
            where username_lc = ${uname} and user_id <> ${context.userId}
          `
        )[0]?.n ?? 0) > 0
      ) {
        throw new Error(usernameError("taken"));
      }
      username = uname;
      usernameLc = uname;
    }
    const display = (data.displayName ?? p.display_name).trim().slice(0, 40);
    const bio = (data.bio ?? p.bio).slice(0, 160);
    await sql`
      update profiles set
        username = ${username},
        username_lc = ${usernameLc},
        display_name = ${display},
        bio = ${bio},
        avatar_url = ${data.avatarUrl === undefined ? p.avatar_url : data.avatarUrl},
        cover_url = ${data.coverUrl === undefined ? p.cover_url : data.coverUrl},
        updated_at = now()
      where user_id = ${context.userId}
    `;
    if (data.website !== undefined || data.location !== undefined) {
      try {
        const { websiteOk } = await import("../graph");
        const site = data.website === undefined ? undefined : websiteOk(data.website ?? "") ?? null;
        const loc = data.location === undefined ? undefined : (data.location ?? "").trim().slice(0, 80) || null;
        if (data.website !== undefined) {
          await sql`update profiles set website = ${site}, updated_at = now() where user_id = ${context.userId}`;
        }
        if (data.location !== undefined) {
          await sql`update profiles set location_name = ${loc}, updated_at = now() where user_id = ${context.userId}`;
        }
      } catch {
        /* 0028 */
      }
    }
    if (bio && bio !== p.bio) {
      const { moderateContent } = await import("./omni-support");
      await moderateContent(sql, {
        actorId: context.userId,
        targetKind: "user",
        targetId: context.userId,
        text: bio,
        username,
      }).catch(() => {});
    }
    return { ok: true as const };
  });

export const updatePrivacy = createServerFn({ method: "POST" })
  .validator((d: {
    isPrivate?: boolean;
    showOnline?: boolean;
    showLastSeen?: boolean;
    readReceipts?: boolean;
    whoCanMessage?: "everyone" | "friends" | "nobody";
    whoCanFriend?: "everyone" | "friends" | "nobody";
    whoCanFollow?: "everyone" | "friends" | "nobody";
    whoCanCall?: "everyone" | "friends" | "nobody";
    storyVisibility?: "everyone" | "friends" | "close";
    statusPrivacy?: "friends" | "except" | "only";
    allowStatusReshare?: boolean;
    theme?: ThemePref;
    notifPrefs?: NotificationPrefs;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p) throw new Error("Profile not found.");
    try {
      await sql`
      update profiles set
        is_private = ${data.isPrivate ?? p.is_private},
        show_online = ${data.showOnline ?? p.show_online},
        show_last_seen = ${data.showLastSeen ?? p.show_last_seen},
        read_receipts = ${data.readReceipts ?? p.read_receipts},
        who_can_message = ${data.whoCanMessage ?? p.who_can_message},
        who_can_friend = ${data.whoCanFriend ?? p.who_can_friend},
        who_can_follow = ${data.whoCanFollow ?? p.who_can_follow},
        who_can_call = ${data.whoCanCall ?? p.who_can_call ?? "friends"},
        story_visibility = ${data.storyVisibility ?? p.story_visibility},
        status_privacy = ${data.statusPrivacy ?? p.status_privacy ?? "friends"},
        allow_status_reshare = ${data.allowStatusReshare ?? p.allow_status_reshare ?? true},
        theme = ${data.theme ?? p.theme},
        notif_prefs = ${JSON.stringify(data.notifPrefs ?? parsePrefs(p.notif_prefs))}::jsonb,
        updated_at = now()
      where user_id = ${context.userId}
    `;
    } catch {
      await sql`
      update profiles set
        is_private = ${data.isPrivate ?? p.is_private},
        show_online = ${data.showOnline ?? p.show_online},
        show_last_seen = ${data.showLastSeen ?? p.show_last_seen},
        read_receipts = ${data.readReceipts ?? p.read_receipts},
        who_can_message = ${data.whoCanMessage ?? p.who_can_message},
        who_can_friend = ${data.whoCanFriend ?? p.who_can_friend},
        who_can_follow = ${data.whoCanFollow ?? p.who_can_follow},
        who_can_call = ${data.whoCanCall ?? p.who_can_call ?? "friends"},
        story_visibility = ${data.storyVisibility ?? p.story_visibility},
        status_privacy = ${data.statusPrivacy ?? p.status_privacy ?? "friends"},
        theme = ${data.theme ?? p.theme},
        notif_prefs = ${JSON.stringify(data.notifPrefs ?? parsePrefs(p.notif_prefs))}::jsonb,
        updated_at = now()
      where user_id = ${context.userId}
    `;
    }
    return { ok: true as const };
  });

export const updateSoundPrefs = createServerFn({ method: "POST" })
  .validator((d: {
    messages?: boolean;
    typing?: boolean;
    calls?: boolean;
    notifications?: boolean;
    vibration?: boolean;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p) throw new Error("Profile not found.");
    const current = parseSoundPrefs(p.sound_prefs) ?? DEFAULT_SOUND_PREFS;
    const next = {
      messages: data.messages ?? current.messages,
      typing: data.typing ?? current.typing,
      calls: data.calls ?? current.calls,
      notifications: data.notifications ?? current.notifications,
      vibration: data.vibration ?? current.vibration,
    };
    try {
      await sql`
        update profiles set sound_prefs = ${JSON.stringify(next)}::jsonb, updated_at = now()
        where user_id = ${context.userId}
      `;
    } catch {
      throw new Error("Sound settings are not available on this deployment yet.");
    }
    return { ok: true as const, soundPrefs: next };
  });

export const getUserProfile = createServerFn({ method: "GET" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const p = await getProfileByUsername(sql, data.username);
    if (!p || p.is_banned) throw new Error("User not found.");
    if (p.deactivated_at && p.user_id !== context.userId) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, p.user_id);
    if (rel.isBlockedBy) throw new Error("User not found.");
    const st = await statsFor(sql, p.user_id);
    const visible = canSee(rel, p);
    const muted = await sql<{ n: number }>`
      select count(*)::int as n from mutes where user_id = ${context.userId} and muted_id = ${p.user_id}
    `.catch(() => [{ n: 0 }]);
    const restricted = await sql<{ n: number }>`
      select count(*)::int as n from restrictions where user_id = ${context.userId} and restricted_id = ${p.user_id}
    `.catch(() => [{ n: 0 }]);
    const pub = toPublic(
      visible
        ? p
        : {
            ...p,
            bio: "",
            avatar_url: p.avatar_url,
            cover_url: null,
          },
      visible
        ? st
        : {
            followers: st.followers,
            following: 0,
            friends: 0,
            posts: 0,
          },
      {
        isSelf: rel.isSelf,
        isFollowing: rel.isFollowing,
        isFollower: rel.isFollower,
        isFriend: rel.isFriend,
        friendRequest: await friendRequestState(sql, context.userId, p.user_id),
        isBlocked: rel.isBlocked,
        canSeePresence: rel.isSelf || (!rel.isBlocked && p.show_online),
      },
    );
    return { ...pub, isMuted: (muted[0]?.n ?? 0) > 0, isRestricted: (restricted[0]?.n ?? 0) > 0 };
  });

export const beginTotp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p) throw new Error("Profile not found.");
    const secret = generateTotpSecret();
    await sql`
      update profiles set totp_secret = ${secret}, totp_pending = true, totp_enabled = false
      where user_id = ${context.userId}
    `;
    return {
      secret,
      url: totpOtpauthUrl(secret, p.username),
    };
  });

export const confirmTotp = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p?.totp_secret) throw new Error("Start 2FA setup first.");
    if (!(await verifyTotp(p.totp_secret, data.code))) throw new Error("That code is not valid.");
    const codes = generateBackupCodes();
    const hashes = await Promise.all(codes.map(hashBackupCode));
    await sql`
      update profiles set totp_enabled = true, totp_pending = false,
        totp_backup_hashes = ${JSON.stringify(hashes)}
      where user_id = ${context.userId}
    `;
    await sql`
      insert into twofa_ok (user_id, session_ok_until) values (${context.userId}, now() + interval '12 hours')
      on conflict (user_id) do update set session_ok_until = excluded.session_ok_until
    `;
    return { backupCodes: codes };
  });

export const disableTotp = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p?.totp_secret) return { ok: true as const };
    if (!(await verifyTotp(p.totp_secret, data.code))) throw new Error("That code is not valid.");
    await sql`
      update profiles set totp_enabled = false, totp_secret = null, totp_backup_hashes = null, totp_pending = false
      where user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const verifyTwoFactor = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p?.totp_enabled || !p.totp_secret) return { ok: true as const };
    let ok = await verifyTotp(p.totp_secret, data.code);
    if (!ok && p.totp_backup_hashes) {
      const hashes = JSON.parse(p.totp_backup_hashes) as string[];
      const incoming = await hashBackupCode(data.code);
      const idx = hashes.indexOf(incoming);
      if (idx >= 0) {
        hashes.splice(idx, 1);
        await sql`update profiles set totp_backup_hashes = ${JSON.stringify(hashes)} where user_id = ${context.userId}`;
        ok = true;
      }
    }
    if (!ok) throw new Error("That code is not valid.");
    await sql`
      insert into twofa_ok (user_id, session_ok_until) values (${context.userId}, now() + interval '12 hours')
      on conflict (user_id) do update set session_ok_until = excluded.session_ok_until
    `;
    return { ok: true as const };
  });

export const twoFactorStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    if (!(await getProfile(sql, context.userId))?.totp_enabled) return { required: false };
    return {
      required:
        ((
          await sql<{ n: number }>`
            select count(*)::int as n from twofa_ok
            where user_id = ${context.userId} and session_ok_until > now()
          `
        )[0]?.n ?? 0) === 0,
    };
  });

export const loginHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    try {
      return await sql<{ id: string; created_at: string; user_agent: string | null; kind: string | null }>`
        select id, created_at, user_agent, kind from login_events
        where user_id = ${context.userId}
        order by created_at desc limit 20
      `;
    } catch {
      return await sql<{ id: string; created_at: string; user_agent: string | null }>`
        select id, created_at, user_agent from login_events
        where user_id = ${context.userId}
        order by created_at desc limit 20
      `;
    }
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .validator((d: { confirm: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (data.confirm !== "DELETE") throw new Error("Type DELETE to confirm.");
    const sql = await sqlClient();
    await sql`delete from profiles where user_id = ${context.userId}`;
    try {
      await sql.query(`delete from "session" where "userId" = $1`, [context.userId]);
      await sql.query(`delete from "account" where "userId" = $1`, [context.userId]);
      await sql.query(`delete from "user" where id = $1`, [context.userId]);
    } catch {
      /* auth tables may differ in preview */
    }
    return { ok: true as const };
  });

export const redeemMark = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { matchMarkCode, markLabel, roleForKind } = await import("./mark-code");
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`mark:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const kind = matchMarkCode(data.code ?? "");
    if (!kind) throw new Error("That code didn’t work.");
    const identity = identityKind(me.verify_kind);
    const alreadyArc = isArcFlag(me);
    const { isMarkBlocked, claimArcSeat, logBadgeEvent } = await import("./arc");
    if (kind === "arc") {
      if (alreadyArc) {
        try {
          const { syncArcGrant } = await import("./entitlements");
          await syncArcGrant(sql, context.userId, true);
        } catch {
          /* 0018 */
        }
        return { ok: true as const, verifyKind: identity, isArc: true, label: markLabel("arc") };
      }
      if (await isMarkBlocked(sql, context.userId, "arc")) {
        throw new Error("That code didn’t work.");
      }
      try {
        await claimArcSeat(sql, context.userId);
      } catch (e) {
        if (e instanceof Error && /didn’t work/.test(e.message)) throw e;
        throw new Error("That code didn’t work.");
      }
      await sql`
        update profiles set
          is_arc = true,
          is_verified = true,
          role = 'super_admin',
          updated_at = now()
        where user_id = ${context.userId}
      `;
      await logBadgeEvent(sql, {
        userId: context.userId,
        actorId: context.userId,
        action: "grant",
        badge: "arc",
        previousKind: identity,
        previousRole: me.role,
        newKind: identity,
        newRole: "super_admin",
        reason: "Authorized ARC seat",
        status: "active",
      });
      try {
        const { syncArcGrant } = await import("./entitlements");
        await syncArcGrant(sql, context.userId, true);
      } catch {
        /* 0018 */
      }
      const { writeAdminAudit } = await import("./security-log.server");
      await writeAdminAudit(sql, {
        actorId: context.userId,
        action: "mark_arc",
        targetId: context.userId,
        detail: markLabel("arc") ?? "arc",
      });
      return { ok: true as const, verifyKind: identity, isArc: true, label: markLabel("arc") };
    }
    if (identity === kind) {
      return { ok: true as const, verifyKind: kind, isArc: alreadyArc, label: markLabel(kind) };
    }
    if (await isMarkBlocked(sql, context.userId, kind)) {
      throw new Error("That code didn’t work.");
    }
    if (kind === "founder") {
      try {
        await sql`
          insert into mark_redemptions (kind, user_id)
          values ('founder', ${context.userId})
          on conflict (kind) do nothing
        `;
        const existing = await sql<{ user_id: string }>`
          select user_id from mark_redemptions where kind = 'founder' limit 1
        `;
        if (!existing[0] || existing[0].user_id !== context.userId) {
          throw new Error("That code didn’t work.");
        }
      } catch (e) {
        if (e instanceof Error && /didn’t work/.test(e.message)) throw e;
        throw new Error("That code didn’t work.");
      }
    }
    const role = alreadyArc ? "super_admin" : roleForKind(kind);
    await sql`
      update profiles set
        verify_kind = ${kind},
        is_verified = true,
        role = ${role},
        updated_at = now()
      where user_id = ${context.userId}
    `;
    const { writeAdminAudit } = await import("./security-log.server");
    await writeAdminAudit(sql, {
      actorId: context.userId,
      action: `mark_${kind}`,
      targetId: context.userId,
      detail: markLabel(kind) ?? kind,
    });
    return { ok: true as const, verifyKind: kind, isArc: alreadyArc, label: markLabel(kind) };
  });

export { canFollow, canFriendRequest, canMessage, canViewStory, authorLite };
