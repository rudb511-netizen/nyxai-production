import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { canFollow, canFriendRequest } from "../privacy";
import { takeToken, rateError } from "../rate-limit";
import { identityKind, isArcFlag } from "../types";
import {
  assertCapability,
  assertNotBanned,
  ensureProfile,
  friendPair,
  getProfile,
  getProfileByUsername,
  getRelation,
  notify,
  sqlClient,
} from "./helpers";

export const followUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`follow:${context.userId}`, 40, 60_000);
    if (wait) throw new Error(rateError(wait));
    const target = await getProfileByUsername(sql, data.username);
    if (!target || target.is_banned) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, target.user_id);
    if (!canFollow(rel, target.who_can_follow)) {
      throw new Error("You cannot follow this account.");
    }
    await sql`
      insert into follows (follower_id, following_id)
      values (${context.userId}, ${target.user_id})
      on conflict do nothing
    `;
    await notify(sql, {
      userId: target.user_id,
      kind: "follow",
      body: `${me.display_name} followed you`,
      actorId: me.user_id,
      prefKey: "followers",
    });
    return { ok: true as const };
  });

export const unfollowUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const target = await getProfileByUsername(sql, data.username);
    if (!target) return { ok: true as const };
    await sql`
      delete from follows where follower_id = ${context.userId} and following_id = ${target.user_id}
    `;
    return { ok: true as const };
  });

export const removeFollower = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const target = await getProfileByUsername(sql, data.username);
    if (!target) return { ok: true as const };
    await sql`
      delete from follows where follower_id = ${target.user_id} and following_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const sendFriendRequest = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "friend");
    const target = await getProfileByUsername(sql, data.username);
    if (!target || target.is_banned) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, target.user_id);
    if (!canFriendRequest(rel, target.who_can_friend)) {
      throw new Error("You cannot send this person a friend request.");
    }
    await sql`
      insert into friend_requests (id, from_id, to_id, status)
      values (${newId("fr")}, ${context.userId}, ${target.user_id}, 'pending')
      on conflict (from_id, to_id) do update set status = 'pending', updated_at = now()
    `;
    await notify(sql, {
      userId: target.user_id,
      kind: "friend_request",
      body: `${me.display_name} sent you a friend request`,
      actorId: me.user_id,
      prefKey: "friends",
    });
    return { ok: true as const };
  });

export const respondFriendRequest = createServerFn({ method: "POST" })
  .validator((d: { username: string; accept: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const other = await getProfileByUsername(sql, data.username);
    if (!other) throw new Error("User not found.");
    const req = await sql<{ id: string }>`
      select id from friend_requests
      where from_id = ${other.user_id} and to_id = ${context.userId} and status = 'pending'
      limit 1
    `;
    if (!req[0]) throw new Error("No pending request.");
    if (data.accept) {
      const [a, b] = friendPair(context.userId, other.user_id);
      await sql`update friend_requests set status = 'accepted', updated_at = now() where id = ${req[0].id}`;
      await sql`
        insert into friendships (user_a, user_b) values (${a}, ${b})
        on conflict do nothing
      `;
      await notify(sql, {
        userId: other.user_id,
        kind: "friend_accept",
        body: `${me.display_name} accepted your friend request`,
        actorId: me.user_id,
        prefKey: "friends",
      });
    } else {
      await sql`update friend_requests set status = 'declined', updated_at = now() where id = ${req[0].id}`;
    }
    return { ok: true as const };
  });

export const cancelFriendRequest = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const other = await getProfileByUsername(sql, data.username);
    if (!other) return { ok: true as const };
    await sql`
      update friend_requests set status = 'cancelled', updated_at = now()
      where from_id = ${context.userId} and to_id = ${other.user_id} and status = 'pending'
    `;
    return { ok: true as const };
  });

export const removeFriend = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const other = await getProfileByUsername(sql, data.username);
    if (!other) return { ok: true as const };
    const [a, b] = friendPair(context.userId, other.user_id);
    await sql`delete from friendships where user_a = ${a} and user_b = ${b}`;
    return { ok: true as const };
  });

export const blockUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const other = await getProfileByUsername(sql, data.username);
    if (!other) throw new Error("User not found.");
    if (other.user_id === context.userId) throw new Error("You cannot block yourself.");
    await sql`
      insert into blocks (blocker_id, blocked_id) values (${context.userId}, ${other.user_id})
      on conflict do nothing
    `;
    await sql`delete from follows where (follower_id = ${context.userId} and following_id = ${other.user_id})
      or (follower_id = ${other.user_id} and following_id = ${context.userId})`;
    const [a, b] = friendPair(context.userId, other.user_id);
    await sql`delete from friendships where user_a = ${a} and user_b = ${b}`;
    return { ok: true as const };
  });

export const unblockUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const other = await getProfileByUsername(sql, data.username);
    if (!other) return { ok: true as const };
    await sql`delete from blocks where blocker_id = ${context.userId} and blocked_id = ${other.user_id}`;
    return { ok: true as const };
  });

export const listFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      verify_kind: string | null;
      is_arc?: boolean;
      is_close?: boolean;
    }>`
      select p.user_id, p.username, p.display_name, p.avatar_url, p.verify_kind, p.is_arc,
        exists (
          select 1 from close_friends c
          where c.user_id = ${context.userId} and c.friend_id = p.user_id
        ) as is_close
      from friendships f
      join profiles p on p.user_id = case when f.user_a = ${context.userId} then f.user_b else f.user_a end
      where f.user_a = ${context.userId} or f.user_b = ${context.userId}
      order by p.display_name
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      verifyKind: identityKind(r.verify_kind),
      isArc: isArcFlag(r),
      isClose: Boolean(r.is_close),
    }));
  });

export const listFriendRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const incoming = await sql<{
      username: string;
      display_name: string;
      avatar_url: string | null;
      user_id: string;
      verify_kind: string | null;
      is_arc?: boolean;
    }>`
      select p.username, p.display_name, p.avatar_url, p.user_id, p.verify_kind, p.is_arc
      from friend_requests r
      join profiles p on p.user_id = r.from_id
      where r.to_id = ${context.userId} and r.status = 'pending'
      order by r.created_at desc
    `;
    const outgoing = await sql<{
      username: string;
      display_name: string;
      avatar_url: string | null;
      user_id: string;
      verify_kind: string | null;
      is_arc?: boolean;
    }>`
      select p.username, p.display_name, p.avatar_url, p.user_id, p.verify_kind, p.is_arc
      from friend_requests r
      join profiles p on p.user_id = r.to_id
      where r.from_id = ${context.userId} and r.status = 'pending'
      order by r.created_at desc
    `;
    const map = (r: (typeof incoming)[number]) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      verifyKind: identityKind(r.verify_kind),
      isArc: isArcFlag(r),
    });
    return { incoming: incoming.map(map), outgoing: outgoing.map(map) };
  });

export const suggestedFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const rows = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      verify_kind: string | null;
      is_arc?: boolean;
      mutual: number;
    }>`
      select p.user_id, p.username, p.display_name, p.avatar_url, p.verify_kind, p.is_arc,
        count(f2.*)::int as mutual
      from profiles p
      left join friendships f2
        on (f2.user_a = p.user_id or f2.user_b = p.user_id)
        and (f2.user_a = ${context.userId} or f2.user_b = ${context.userId})
      where p.user_id <> ${context.userId}
        and p.onboarded = true
        and p.is_banned = false
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = ${context.userId} and b.blocked_id = p.user_id)
             or (b.blocker_id = p.user_id and b.blocked_id = ${context.userId})
        )
        and not exists (
          select 1 from friendships fr
          where (fr.user_a = least(${context.userId}, p.user_id)
             and fr.user_b = greatest(${context.userId}, p.user_id))
        )
      group by p.user_id, p.username, p.display_name, p.avatar_url, p.verify_kind, p.is_arc, p.created_at
      order by mutual desc, p.created_at desc
      limit 20
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      verifyKind: identityKind(r.verify_kind),
      isArc: isArcFlag(r),
      mutual: r.mutual,
    }));
  });

export const listFollowGraph = createServerFn({ method: "GET" })
  .validator((d: { username: string; kind: "followers" | "following" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfileByUsername(sql, data.username);
    if (!p) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, p.user_id);
    if (!rel.isSelf && p.is_private && !rel.isFriend && !rel.isFollowing) {
      throw new Error("This account is private.");
    }
    const rows =
      data.kind === "followers"
        ? await sql`
            select p.user_id, p.username, p.display_name, p.avatar_url
            from follows f join profiles p on p.user_id = f.follower_id
            where f.following_id = ${p.user_id}
            order by f.created_at desc limit 80
          `
        : await sql`
            select p.user_id, p.username, p.display_name, p.avatar_url
            from follows f join profiles p on p.user_id = f.following_id
            where f.follower_id = ${p.user_id}
            order by f.created_at desc limit 80
          `;
    return rows.map((r) => ({
      userId: (r as { user_id: string }).user_id,
      username: (r as { username: string }).username,
      displayName: (r as { display_name: string }).display_name,
      avatarUrl: (r as { avatar_url: string | null }).avatar_url,
    }));
  });

export const listBlocked = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }>`
      select p.user_id, p.username, p.display_name, p.avatar_url
      from blocks b join profiles p on p.user_id = b.blocked_id
      where b.blocker_id = ${context.userId}
      order by b.created_at desc
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
    }));
  });
