import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import {
  liveKindOk,
  normalizeHighlightName,
  normalizeListName,
  normalizeTag,
  otpShapeOk,
  parseScheduleAt,
  sixDigitOtp,
  visibilityOk,
  websiteOk,
  isValidE164,
} from "../graph";
import { identityKind, isArcFlag, type AuthorLite } from "../types";
import {
  assertNotBanned,
  authorLite,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";

type AnyRow = Record<string, unknown>;
type Sql = Awaited<ReturnType<typeof sqlClient>>;

function hashOtp(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM?.trim(),
  );
}

function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

async function memberLite(sql: Sql, ids: string[]): Promise<AuthorLite[]> {
  const authors = await loadAuthors(sql, ids);
  return ids.map((id) => authors.get(id)).filter(Boolean).map((p) => authorLite(p!));
}

export async function publishDueScheduledPosts(sql: Sql): Promise<number> {
  try {
    const due = await sql<{ id: string; author_id: string; body: string }>`
      select id, author_id, body from posts
      where is_removed = false
        and scheduled_at is not null
        and scheduled_at <= now()
        and (published_at is null or published_at > now())
      order by scheduled_at
      limit 40
    `;
    for (const row of due) {
      await sql`update posts set published_at = now(), updated_at = now() where id = ${row.id}`;
      const followers = await sql<{ follower_id: string }>`
        select follower_id from follows where following_id = ${row.author_id} limit 80
      `;
      const author = await getProfile(sql, row.author_id);
      for (const f of followers) {
        await notify(sql, {
          userId: f.follower_id,
          kind: "post",
          body: `${author?.display_name ?? "Someone"} published a scheduled post`,
          actorId: row.author_id,
          entityId: row.id,
          prefKey: "comments",
        }).catch(() => {});
      }
    }
    return due.length;
  } catch {
    return 0;
  }
}

export const muteUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const target = await getProfileByUsername(sql, data.username);
    if (!target || target.user_id === context.userId) throw new Error("User not found.");
    await sql`
      insert into mutes (user_id, muted_id) values (${context.userId}, ${target.user_id})
      on conflict do nothing
    `;
    await sql`
      insert into feed_hides (user_id, target_kind, target_id, reason)
      values (${context.userId}, 'author', ${target.user_id}, 'mute')
      on conflict (user_id, target_kind, target_id) do update set reason = 'mute'
    `.catch(() => {});
    return { muted: true as const };
  });

export const unmuteUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const target = await getProfileByUsername(sql, data.username);
    if (!target) return { muted: false as const };
    await sql`delete from mutes where user_id = ${context.userId} and muted_id = ${target.user_id}`;
    await sql`
      delete from feed_hides
      where user_id = ${context.userId} and target_kind = 'author' and target_id = ${target.user_id} and reason = 'mute'
    `.catch(() => {});
    return { muted: false as const };
  });

export const listMuted = createServerFn({ method: "GET" })
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
      from mutes m join profiles p on p.user_id = m.muted_id
      where m.user_id = ${context.userId}
      order by m.created_at desc
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
    }));
  });

export const restrictUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const target = await getProfileByUsername(sql, data.username);
    if (!target || target.user_id === context.userId) throw new Error("User not found.");
    await sql`
      insert into restrictions (user_id, restricted_id) values (${context.userId}, ${target.user_id})
      on conflict do nothing
    `;
    return { restricted: true as const };
  });

export const unrestrictUser = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const target = await getProfileByUsername(sql, data.username);
    if (!target) return { restricted: false as const };
    await sql`delete from restrictions where user_id = ${context.userId} and restricted_id = ${target.user_id}`;
    return { restricted: false as const };
  });

export const listRestricted = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ user_id: string; username: string; display_name: string; avatar_url: string | null }>`
      select p.user_id, p.username, p.display_name, p.avatar_url
      from restrictions r join profiles p on p.user_id = r.restricted_id
      where r.user_id = ${context.userId}
      order by r.created_at desc
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
    }));
  });

export const createList = createServerFn({ method: "POST" })
  .validator((d: { name: string; description?: string; isPrivate?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`list:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const name = normalizeListName(data.name);
    if (name.length < 1) throw new Error("Name this list.");
    const n = await sql<{ n: number }>`select count(*)::int as n from user_lists where owner_id = ${context.userId}`;
    if ((n[0]?.n ?? 0) >= 50) throw new Error("You already have 50 lists.");
    const id = newId("ls");
    await sql`
      insert into user_lists (id, owner_id, name, description, is_private)
      values (${id}, ${context.userId}, ${name}, ${(data.description ?? "").slice(0, 160)}, ${data.isPrivate !== false})
    `;
    return { id };
  });

export const updateList = createServerFn({ method: "POST" })
  .validator((d: { id: string; name?: string; description?: string; isPrivate?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const name = data.name !== undefined ? normalizeListName(data.name) : null;
    if (name !== null && !name) throw new Error("Name this list.");
    await sql`
      update user_lists set
        name = coalesce(${name}, name),
        description = coalesce(${data.description?.slice(0, 160) ?? null}, description),
        is_private = coalesce(${data.isPrivate ?? null}, is_private),
        updated_at = now()
      where id = ${data.id} and owner_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const deleteList = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from user_lists where id = ${data.id} and owner_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listMyLists = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const owned = await sql<AnyRow>`
      select l.id, l.name, l.description, l.is_private, l.created_at,
        (select count(*)::int from user_list_members m where m.list_id = l.id) as members,
        (select count(*)::int from user_list_follows f where f.list_id = l.id) as followers
      from user_lists l
      where l.owner_id = ${context.userId}
      order by l.updated_at desc
    `;
    const following = await sql<AnyRow>`
      select l.id, l.name, l.description, l.is_private, l.created_at, p.username as owner_username,
        (select count(*)::int from user_list_members m where m.list_id = l.id) as members
      from user_list_follows f
      join user_lists l on l.id = f.list_id
      join profiles p on p.user_id = l.owner_id
      where f.user_id = ${context.userId} and l.owner_id <> ${context.userId}
      order by f.created_at desc
    `;
    return {
      owned: owned.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: String(r.description ?? ""),
        isPrivate: Boolean(r.is_private),
        memberCount: Number(r.members ?? 0),
        followerCount: Number(r.followers ?? 0),
        createdAt: String(r.created_at),
      })),
      following: following.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: String(r.description ?? ""),
        isPrivate: Boolean(r.is_private),
        memberCount: Number(r.members ?? 0),
        ownerUsername: String(r.owner_username ?? ""),
        createdAt: String(r.created_at),
      })),
    };
  });

export const getList = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql<AnyRow>`
      select l.*, p.username as owner_username, p.display_name as owner_name, p.avatar_url as owner_avatar
      from user_lists l join profiles p on p.user_id = l.owner_id
      where l.id = ${data.id}
    `;
    const list = rows[0];
    if (!list) throw new Error("List not found.");
    const isOwner = list.owner_id === context.userId;
    if (list.is_private && !isOwner) {
      const fol = await sql<{ n: number }>`
        select count(*)::int as n from user_list_follows where list_id = ${data.id} and user_id = ${context.userId}
      `;
      if ((fol[0]?.n ?? 0) === 0) throw new Error("This list is private.");
    }
    const members = await sql<{ user_id: string }>`
      select user_id from user_list_members where list_id = ${data.id} order by added_at
    `;
    const following = await sql<{ n: number }>`
      select count(*)::int as n from user_list_follows where list_id = ${data.id} and user_id = ${context.userId}
    `;
    return {
      id: String(list.id),
      name: String(list.name),
      description: String(list.description ?? ""),
      isPrivate: Boolean(list.is_private),
      isOwner,
      following: (following[0]?.n ?? 0) > 0,
      owner: {
        username: String(list.owner_username),
        displayName: String(list.owner_name),
        avatarUrl: (list.owner_avatar as string | null) ?? null,
      },
      members: await memberLite(sql, members.map((m) => m.user_id)),
    };
  });

export const addListMember = createServerFn({ method: "POST" })
  .validator((d: { listId: string; username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const list = await sql<{ owner_id: string }>`select owner_id from user_lists where id = ${data.listId}`;
    if (!list[0] || list[0].owner_id !== context.userId) throw new Error("You can only edit your lists.");
    const target = await getProfileByUsername(sql, data.username);
    if (!target) throw new Error("User not found.");
    const n = await sql<{ n: number }>`select count(*)::int as n from user_list_members where list_id = ${data.listId}`;
    if ((n[0]?.n ?? 0) >= 200) throw new Error("A list can hold 200 people.");
    await sql`
      insert into user_list_members (list_id, user_id) values (${data.listId}, ${target.user_id})
      on conflict do nothing
    `;
    await sql`update user_lists set updated_at = now() where id = ${data.listId}`;
    return { ok: true as const };
  });

export const removeListMember = createServerFn({ method: "POST" })
  .validator((d: { listId: string; username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const list = await sql<{ owner_id: string }>`select owner_id from user_lists where id = ${data.listId}`;
    if (!list[0] || list[0].owner_id !== context.userId) throw new Error("You can only edit your lists.");
    const target = await getProfileByUsername(sql, data.username);
    if (!target) return { ok: true as const };
    await sql`delete from user_list_members where list_id = ${data.listId} and user_id = ${target.user_id}`;
    return { ok: true as const };
  });

export const followList = createServerFn({ method: "POST" })
  .validator((d: { id: string; follow: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const list = await sql<{ owner_id: string; is_private: boolean }>`
      select owner_id, is_private from user_lists where id = ${data.id}
    `;
    if (!list[0]) throw new Error("List not found.");
    if (list[0].is_private && list[0].owner_id !== context.userId) {
      throw new Error("This list is private.");
    }
    if (data.follow) {
      await sql`
        insert into user_list_follows (list_id, user_id) values (${data.id}, ${context.userId})
        on conflict do nothing
      `;
    } else {
      await sql`delete from user_list_follows where list_id = ${data.id} and user_id = ${context.userId}`;
    }
    return { following: data.follow };
  });

export const listFeed = createServerFn({ method: "GET" })
  .validator((d: { id: string; cursor?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const list = await sql<{ owner_id: string; is_private: boolean }>`
      select owner_id, is_private from user_lists where id = ${data.id}
    `;
    if (!list[0]) throw new Error("List not found.");
    if (list[0].is_private && list[0].owner_id !== context.userId) {
      throw new Error("This list is private.");
    }
    const { hydratePosts } = await import("./posts");
    const cursor = data.cursor ?? null;
    let rows: Array<{ created_at: string } & Record<string, unknown>> = [];
    try {
      rows = await sql.query(
        `select p.* from posts p
         join user_list_members m on m.user_id = p.author_id
         join profiles a on a.user_id = p.author_id
         where m.list_id = $1
           and p.is_removed = false
           and a.deactivated_at is null
           and (p.published_at is null or p.published_at <= now())
           and ($2::timestamptz is null or p.created_at < $2)
         order by p.created_at desc
         limit 24`,
        [data.id, cursor],
      );
    } catch {
      rows = await sql.query(
        `select p.* from posts p
         join user_list_members m on m.user_id = p.author_id
         where m.list_id = $1 and p.is_removed = false
           and ($2::timestamptz is null or p.created_at < $2)
         order by p.created_at desc
         limit 24`,
        [data.id, cursor],
      );
    }
    const items = await hydratePosts(sql, context.userId, rows as never);
    return { items, nextCursor: rows.length === 24 ? rows[rows.length - 1]!.created_at : null };
  });

export const followHashtag = createServerFn({ method: "POST" })
  .validator((d: { tag: string; follow: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const tag = normalizeTag(data.tag);
    if (!tag) throw new Error("That hashtag is empty.");
    if (data.follow) {
      await sql`
        insert into hashtags (tag, use_count) values (${tag}, 0)
        on conflict (tag) do nothing
      `;
      await sql`
        insert into hashtag_follows (user_id, tag) values (${context.userId}, ${tag})
        on conflict do nothing
      `;
      await sql`
        insert into user_interests (user_id, tag) values (${context.userId}, ${tag})
        on conflict do nothing
      `.catch(() => {});
    } else {
      await sql`delete from hashtag_follows where user_id = ${context.userId} and tag = ${tag}`;
    }
    return { following: data.follow, tag };
  });

export const hashtagState = createServerFn({ method: "GET" })
  .validator((d: { tag: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const tag = normalizeTag(data.tag);
    const follow = await sql<{ n: number }>`
      select count(*)::int as n from hashtag_follows where user_id = ${context.userId} and tag = ${tag}
    `;
    const stats = await sql<{ use_count: number }>`select use_count from hashtags where tag = ${tag}`;
    const followers = await sql<{ n: number }>`select count(*)::int as n from hashtag_follows where tag = ${tag}`;
    return {
      tag,
      following: (follow[0]?.n ?? 0) > 0,
      useCount: stats[0]?.use_count ?? 0,
      followers: followers[0]?.n ?? 0,
    };
  });

export const listFollowedHashtags = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ tag: string; use_count: number }>`
      select h.tag, coalesce(t.use_count, 0)::int as use_count
      from hashtag_follows h
      left join hashtags t on t.tag = h.tag
      where h.user_id = ${context.userId}
      order by h.created_at desc
    `;
    return rows;
  });

export const createHighlight = createServerFn({ method: "POST" })
  .validator((d: { name: string; coverUrl?: string | null; storyIds?: string[] }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const name = normalizeHighlightName(data.name);
    if (!name) throw new Error("Name this highlight.");
    const n = await sql<{ n: number }>`select count(*)::int as n from story_highlights where user_id = ${context.userId}`;
    if ((n[0]?.n ?? 0) >= 30) throw new Error("You already have 30 highlights.");
    const id = newId("hl");
    const max = await sql<{ n: number }>`
      select coalesce(max(sort_order), -1)::int as n from story_highlights where user_id = ${context.userId}
    `;
    await sql`
      insert into story_highlights (id, user_id, name, cover_url, sort_order)
      values (${id}, ${context.userId}, ${name}, ${data.coverUrl ?? null}, ${(max[0]?.n ?? -1) + 1})
    `;
    for (const [i, storyId] of (data.storyIds ?? []).entries()) {
      const owned = await sql<{ n: number }>`
        select count(*)::int as n from stories where id = ${storyId} and author_id = ${context.userId}
      `;
      if ((owned[0]?.n ?? 0) === 0) continue;
      await sql`
        insert into story_highlight_items (highlight_id, story_id, sort_order)
        values (${id}, ${storyId}, ${i})
        on conflict do nothing
      `;
    }
    return { id };
  });

export const addHighlightStory = createServerFn({ method: "POST" })
  .validator((d: { highlightId: string; storyId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const hl = await sql<{ user_id: string }>`select user_id from story_highlights where id = ${data.highlightId}`;
    if (!hl[0] || hl[0].user_id !== context.userId) throw new Error("Highlight not found.");
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from stories where id = ${data.storyId} and author_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("You can only pin your own stories.");
    const max = await sql<{ n: number }>`
      select coalesce(max(sort_order), -1)::int as n from story_highlight_items where highlight_id = ${data.highlightId}
    `;
    await sql`
      insert into story_highlight_items (highlight_id, story_id, sort_order)
      values (${data.highlightId}, ${data.storyId}, ${(max[0]?.n ?? -1) + 1})
      on conflict do nothing
    `;
    return { ok: true as const };
  });

export const removeHighlightStory = createServerFn({ method: "POST" })
  .validator((d: { highlightId: string; storyId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const hl = await sql<{ user_id: string }>`select user_id from story_highlights where id = ${data.highlightId}`;
    if (!hl[0] || hl[0].user_id !== context.userId) throw new Error("Highlight not found.");
    await sql`
      delete from story_highlight_items where highlight_id = ${data.highlightId} and story_id = ${data.storyId}
    `;
    return { ok: true as const };
  });

export const deleteHighlight = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from story_highlights where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listHighlights = createServerFn({ method: "GET" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfileByUsername(sql, data.username);
    if (!p) throw new Error("User not found.");
    const rows = await sql<AnyRow>`
      select h.id, h.name, h.cover_url, h.sort_order, h.created_at,
        (select count(*)::int from story_highlight_items i where i.highlight_id = h.id) as items
      from story_highlights h
      where h.user_id = ${p.user_id}
      order by h.sort_order, h.created_at
    `;
    return {
      isSelf: p.user_id === context.userId,
      items: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        coverUrl: (r.cover_url as string | null) ?? null,
        count: Number(r.items ?? 0),
        createdAt: String(r.created_at),
      })),
    };
  });

export const getHighlight = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql<AnyRow>`select * from story_highlights where id = ${data.id}`;
    if (!rows[0]) throw new Error("Highlight not found.");
    const items = await sql<AnyRow>`
      select s.id, s.media_url, s.media_kind, s.text_body, s.background, s.created_at, s.expires_at
      from story_highlight_items i
      join stories s on s.id = i.story_id
      where i.highlight_id = ${data.id}
      order by i.sort_order, i.created_at
    `;
    return {
      id: String(rows[0].id),
      name: String(rows[0].name),
      coverUrl: (rows[0].cover_url as string | null) ?? null,
      isSelf: rows[0].user_id === context.userId,
      items: items.map((s) => ({
        id: String(s.id),
        mediaUrl: (s.media_url as string | null) ?? null,
        mediaKind: String(s.media_kind),
        textBody: (s.text_body as string | null) ?? null,
        background: (s.background as string | null) ?? null,
        createdAt: String(s.created_at),
      })),
    };
  });

export const listMyStoriesForHighlights = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      media_url: string | null;
      media_kind: string;
      text_body: string | null;
      created_at: string;
    }>`
      select id, media_url, media_kind, text_body, created_at
      from stories where author_id = ${context.userId}
      order by created_at desc limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      mediaUrl: r.media_url,
      mediaKind: r.media_kind,
      textBody: r.text_body,
      createdAt: r.created_at,
    }));
  });

export const listScheduledPosts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string; body: string; scheduled_at: string; created_at: string }>`
      select id, body, scheduled_at, created_at from posts
      where author_id = ${context.userId}
        and is_removed = false
        and scheduled_at is not null
        and (published_at is null or published_at > now())
      order by scheduled_at
    `;
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      scheduledAt: r.scheduled_at,
      createdAt: r.created_at,
    }));
  });

export const cancelScheduledPost = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      update posts set is_removed = true, updated_at = now()
      where id = ${data.id} and author_id = ${context.userId}
        and scheduled_at is not null
        and (published_at is null or published_at > now())
    `;
    return { ok: true as const };
  });

export const recordSearch = createServerFn({ method: "POST" })
  .validator((d: { query: string; kind?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const q = data.query.trim().slice(0, 80);
    if (q.length < 1) return { ok: false as const };
    await sql`
      insert into search_history (id, user_id, query, kind)
      values (${newId("sh")}, ${context.userId}, ${q}, ${(data.kind ?? "all").slice(0, 20)})
    `;
    await sql`
      delete from search_history where id in (
        select id from search_history where user_id = ${context.userId}
        order by created_at desc offset 40
      )
    `;
    return { ok: true as const };
  });

export const listSearchHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string; query: string; kind: string; created_at: string }>`
      select id, query, kind, created_at
      from search_history
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      const key = r.query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= 20) break;
    }
    return out;
  });

export const clearSearchHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await sql`delete from search_history where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const deactivateAccount = createServerFn({ method: "POST" })
  .validator((d: { confirm: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (data.confirm.trim().toUpperCase() !== "DEACTIVATE") {
      throw new Error("Type DEACTIVATE to hide your account.");
    }
    const sql = await sqlClient();
    await sql`update profiles set deactivated_at = now(), updated_at = now() where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const reactivateAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await sql`update profiles set deactivated_at = null, updated_at = now() where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const exportAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const wait = takeToken(`export:${context.userId}`, 2, 3_600_000);
    if (wait) throw new Error(rateError(wait));
    const posts = await sql<{ id: string; body: string; kind: string; location: string | null; created_at: string }>`
      select id, body, kind, location, created_at from posts
      where author_id = ${context.userId} and is_removed = false
      order by created_at desc limit 500
    `;
    const comments = await sql<{ id: string; post_id: string; body: string; created_at: string }>`
      select id, post_id, body, created_at from comments
      where author_id = ${context.userId} and is_removed = false
      order by created_at desc limit 500
    `;
    const follows = await sql<{ username: string }>`
      select p.username from follows f join profiles p on p.user_id = f.following_id
      where f.follower_id = ${context.userId} order by f.created_at desc limit 500
    `;
    const followers = await sql<{ username: string }>`
      select p.username from follows f join profiles p on p.user_id = f.follower_id
      where f.following_id = ${context.userId} order by f.created_at desc limit 500
    `;
    const friends = await sql<{ username: string }>`
      select p.username from friendships f
      join profiles p on p.user_id = case when f.user_a = ${context.userId} then f.user_b else f.user_a end
      where f.user_a = ${context.userId} or f.user_b = ${context.userId}
    `;
    const stories = await sql<{ id: string; media_kind: string; text_body: string | null; created_at: string; expires_at: string }>`
      select id, media_kind, text_body, created_at, expires_at from stories
      where author_id = ${context.userId} order by created_at desc limit 200
    `;
    const lists = await sql<{ id: string; name: string; description: string; is_private: boolean; created_at: string }>`
      select id, name, description, is_private, created_at from user_lists where owner_id = ${context.userId}
    `.catch(() => [] as { id: string; name: string; description: string; is_private: boolean; created_at: string }[]);
    const bookmarks = await sql<{ post_id: string; created_at: string }>`
      select post_id, created_at from bookmarks where user_id = ${context.userId} order by created_at desc limit 500
    `;
    const messages = await sql<{ id: string; conversation_id: string; kind: string; body: string; created_at: string }>`
      select id, conversation_id, kind, body, created_at from messages
      where sender_id = ${context.userId} and deleted_at is null
      order by created_at desc limit 500
    `.catch(() => [] as { id: string; conversation_id: string; kind: string; body: string; created_at: string }[]);
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        username: me.username,
        displayName: me.display_name,
        bio: me.bio,
        createdAt: me.created_at,
      },
      posts: posts.map((p) => ({
        id: p.id,
        body: p.body,
        kind: p.kind,
        location: p.location,
        createdAt: p.created_at,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        postId: c.post_id,
        body: c.body,
        createdAt: c.created_at,
      })),
      following: follows.map((f) => f.username),
      followers: followers.map((f) => f.username),
      friends: friends.map((f) => f.username),
      stories: stories.map((s) => ({
        id: s.id,
        mediaKind: s.media_kind,
        textBody: s.text_body,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
      })),
      lists: lists.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        isPrivate: l.is_private,
        createdAt: l.created_at,
      })),
      bookmarks: bookmarks.map((b) => ({ postId: b.post_id, createdAt: b.created_at })),
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        kind: m.kind,
        body: m.body,
        createdAt: m.created_at,
      })),
    };
  });

export const requestSpeak = createServerFn({ method: "POST" })
  .validator((d: { streamId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`join-live:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const live = await sql<{ host_id: string; status: string }>`
      select host_id, status from live_streams where id = ${data.streamId}
    `;
    if (!live[0] || live[0].status !== "live") throw new Error("This room has ended.");
    if (live[0].host_id === context.userId) return { role: "host" as const };
    const banned = await sql<{ n: number }>`
      select count(*)::int as n from live_bans where stream_id = ${data.streamId} and user_id = ${context.userId}
    `;
    if ((banned[0]?.n ?? 0) > 0) throw new Error("You were removed from this live.");
    const rel = await getRelation(sql, live[0].host_id, context.userId);
    if (rel.isBlocked || rel.isBlockedBy) throw new Error("You can't join this live.");
    await sql`
      insert into live_speakers (stream_id, user_id, role)
      values (${data.streamId}, ${context.userId}, 'requested')
      on conflict (stream_id, user_id) do update set role = 'requested', updated_at = now()
      where live_speakers.role in ('listener', 'requested', 'invited')
    `;
    await notify(sql, {
      userId: live[0].host_id,
      kind: "live_invite",
      body: `${me.display_name} wants to join your live`,
      actorId: me.user_id,
      entityId: data.streamId,
    });
    return { role: "requested" as const };
  });

export const setSpeakerRole = createServerFn({ method: "POST" })
  .validator((d: { streamId: string; userId: string; role: "speaker" | "listener" | "cohost"; muted?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const live = await sql<{ host_id: string; status: string; max_guests?: number }>`
      select host_id, status, max_guests from live_streams where id = ${data.streamId}
    `.catch(async () =>
      sql<{ host_id: string; status: string }>`select host_id, status from live_streams where id = ${data.streamId}`,
    );
    if (!live[0] || live[0].status !== "live") throw new Error("This live has ended.");
    if (live[0].host_id !== context.userId) {
      const co = await sql<{ n: number }>`
        select count(*)::int as n from live_speakers
        where stream_id = ${data.streamId} and user_id = ${context.userId} and role = 'cohost'
      `;
      if ((co[0]?.n ?? 0) === 0) throw new Error("Only the host can manage guests.");
    }
    if (data.userId === live[0].host_id) throw new Error("The host stays on this live.");
    const prev = await sql<{ role: string }>`
      select role from live_speakers where stream_id = ${data.streamId} and user_id = ${data.userId}
    `;
    if (data.role === "speaker" || data.role === "cohost") {
      const banned = await sql<{ n: number }>`
        select count(*)::int as n from live_bans where stream_id = ${data.streamId} and user_id = ${data.userId}
      `;
      if ((banned[0]?.n ?? 0) > 0) throw new Error("That person was removed from this live.");
      const row = live[0] as { max_guests?: number };
      const maxGuests = Math.max(1, Number(row.max_guests ?? 4) || 4);
      const seated = await sql<{ n: number }>`
        select count(*)::int as n from live_speakers
        where stream_id = ${data.streamId}
          and role in ('speaker', 'cohost')
          and user_id <> ${data.userId}
      `;
      if ((seated[0]?.n ?? 0) >= maxGuests) throw new Error("This live is full.");
    }
    await sql`
      insert into live_speakers (stream_id, user_id, role, muted)
      values (${data.streamId}, ${data.userId}, ${data.role}, ${Boolean(data.muted)})
      on conflict (stream_id, user_id) do update set role = excluded.role, muted = excluded.muted, updated_at = now()
    `;
    const wasGuest = prev[0]?.role === "speaker" || prev[0]?.role === "cohost";
    const host = await getProfile(sql, live[0].host_id);
    if ((data.role === "speaker" || data.role === "cohost") && !wasGuest) {
      await notify(sql, {
        userId: data.userId,
        kind: "live_invite",
        body: `${host?.display_name ?? "The host"} accepted your request to join the live`,
        actorId: live[0].host_id,
        entityId: data.streamId,
      });
    } else if (data.role === "listener" && prev[0]?.role === "requested") {
      await notify(sql, {
        userId: data.userId,
        kind: "live_invite",
        body: `${host?.display_name ?? "The host"} declined your request to join the live`,
        actorId: live[0].host_id,
        entityId: data.streamId,
      });
    } else if (data.role === "listener" && wasGuest) {
      await notify(sql, {
        userId: data.userId,
        kind: "live_invite",
        body: `${host?.display_name ?? "The host"} removed you from the live`,
        actorId: live[0].host_id,
        entityId: data.streamId,
      });
    }
    return { ok: true as const };
  });

export const listSpeakers = createServerFn({ method: "GET" })
  .validator((d: { streamId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    void context;
    await sql`
      update live_speakers set role = 'listener', updated_at = now()
      where stream_id = ${data.streamId}
        and role = 'requested'
        and updated_at < now() - interval '90 seconds'
    `.catch(() => undefined);
    const rows = await sql<{ user_id: string; role: string; muted: boolean }>`
      select user_id, role, muted from live_speakers where stream_id = ${data.streamId}
    `;
    const authors = await loadAuthors(sql, rows.map((r) => r.user_id));
    return rows
      .map((r) => {
        const a = authors.get(r.user_id);
        if (!a) return null;
        return { ...authorLite(a), role: r.role, muted: r.muted };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  });

export const requestPhoneOtp = createServerFn({ method: "POST" })
  .validator((d: { phone: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (!twilioConfigured()) {
      throw new Error("Phone verification is not configured on this NYX server. Add Twilio credentials to enable SMS.");
    }
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const wait = takeToken(`phone:${context.userId}`, 3, 3_600_000);
    if (wait) throw new Error(rateError(wait));
    const phone = data.phone.trim();
    if (!isValidE164(phone)) throw new Error("Use an international number like +2348012345678.");
    const taken = await sql<{ n: number }>`
      select count(*)::int as n from profiles
      where phone_e164 = ${phone} and user_id <> ${context.userId} and phone_verified_at is not null
    `;
    if ((taken[0]?.n ?? 0) > 0) throw new Error("That number is already on another account.");
    const code = sixDigitOtp(randomBytes(4));
    await sql`
      insert into phone_otp_codes (id, user_id, phone_e164, code_hash, expires_at)
      values (${newId("otp")}, ${context.userId}, ${phone}, ${hashOtp(code)}, now() + interval '10 minutes')
    `;
    const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
    const token = process.env.TWILIO_AUTH_TOKEN!.trim();
    const from = process.env.TWILIO_FROM!.trim();
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: phone,
        From: from,
        Body: `NYX code: ${code}. Expires in 10 minutes.`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body.slice(0, 180) || "Could not send the SMS. Check Twilio credentials.");
    }
    return { ok: true as const, sent: true as const };
  });

export const confirmPhoneOtp = createServerFn({ method: "POST" })
  .validator((d: { phone: string; code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!otpShapeOk(data.code)) throw new Error("Enter the 6-digit code from SMS.");
    const phone = data.phone.trim();
    const row = await sql<{ id: string; code_hash: string; attempts: number; expires_at: string }>`
      select id, code_hash, attempts, expires_at from phone_otp_codes
      where user_id = ${context.userId} and phone_e164 = ${phone} and verified_at is null
      order by created_at desc limit 1
    `;
    if (!row[0]) throw new Error("Request a new code.");
    if (new Date(row[0].expires_at).getTime() < Date.now()) throw new Error("That code expired.");
    if (row[0].attempts >= 5) throw new Error("Too many attempts. Request a new code.");
    if (row[0].code_hash !== hashOtp(data.code)) {
      await sql`update phone_otp_codes set attempts = attempts + 1 where id = ${row[0].id}`;
      throw new Error("That code did not match.");
    }
    await sql`update phone_otp_codes set verified_at = now() where id = ${row[0].id}`;
    await sql`
      update profiles set phone_e164 = ${phone}, phone_verified_at = now(), updated_at = now()
      where user_id = ${context.userId}
    `;
    return { ok: true as const, verified: true as const };
  });

export const requestEmailVerify = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const wait = takeToken(`emailv:${context.userId}`, 4, 3_600_000);
    if (wait) throw new Error(rateError(wait));
    const auth = await sql.query<{ email: string | null; emailVerified: boolean | null }>(
      `select email, "emailVerified" as "emailVerified" from "user" where id = $1`,
      [context.userId],
    );
    const email = auth[0]?.email;
    if (!email) throw new Error("This account has no email.");
    if (auth[0]?.emailVerified) return { ok: true as const, already: true as const };
    const { getNyxTransport } = await import("./mail");
    const transport = getNyxTransport();
    if (!transport) throw new Error("Email is not configured on this NYX server.");
    const code = sixDigitOtp(randomBytes(4));
    await sql`
      insert into email_verify_codes (id, user_id, email, code_hash, expires_at)
      values (${newId("evc")}, ${context.userId}, ${email}, ${hashOtp(code)}, now() + interval '30 minutes')
    `;
    await transport.sendMail({
      from: process.env.MAIL_FROM?.trim() || "NYX <nyx.officialsupport@gmail.com>",
      to: email,
      subject: "Verify your NYX email",
      text: `Hi ${me.display_name},\n\nYour NYX verification code is ${code}. It expires in 30 minutes.\n`,
    });
    await sql`update profiles set email_verify_sent_at = now() where user_id = ${context.userId}`.catch(() => {});
    return { ok: true as const, sent: true as const };
  });

export const confirmEmailVerify = createServerFn({ method: "POST" })
  .validator((d: { code: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!otpShapeOk(data.code)) throw new Error("Enter the 6-digit code from email.");
    const row = await sql<{ id: string; code_hash: string; attempts: number; expires_at: string }>`
      select id, code_hash, attempts, expires_at from email_verify_codes
      where user_id = ${context.userId} and verified_at is null
      order by created_at desc limit 1
    `;
    if (!row[0]) throw new Error("Request a new code.");
    if (new Date(row[0].expires_at).getTime() < Date.now()) throw new Error("That code expired.");
    if (row[0].attempts >= 5) throw new Error("Too many attempts. Request a new code.");
    if (row[0].code_hash !== hashOtp(data.code)) {
      await sql`update email_verify_codes set attempts = attempts + 1 where id = ${row[0].id}`;
      throw new Error("That code did not match.");
    }
    await sql`update email_verify_codes set verified_at = now() where id = ${row[0].id}`;
    await sql.query(`update "user" set "emailVerified" = true where id = $1`, [context.userId]);
    return { ok: true as const, verified: true as const };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .validator((d: { endpoint: string; p256dh: string; auth: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const endpoint = data.endpoint.trim().slice(0, 2000);
    if (!endpoint.startsWith("https://")) throw new Error("Invalid push endpoint.");
    await sql`
      insert into web_push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${newId("wp")}, ${context.userId}, ${endpoint}, ${data.p256dh.slice(0, 200)}, ${data.auth.slice(0, 200)})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
    `;
    return { ok: true as const, configured: vapidConfigured() };
  });

export const pushStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const n = await sql<{ n: number }>`
      select count(*)::int as n from web_push_subscriptions where user_id = ${context.userId}
    `.catch(() => [{ n: 0 }]);
    return {
      vapidPublic: process.env.VITE_VAPID_PUBLIC_KEY?.trim() || process.env.VAPID_PUBLIC_KEY?.trim() || null,
      configured: vapidConfigured(),
      subscribed: (n[0]?.n ?? 0) > 0,
    };
  });

export const saveDevicePushToken = createServerFn({ method: "POST" })
  .validator((d: { token: string; platform: "ios" | "android"; appVersion?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const token = data.token.trim().slice(0, 4096);
    if (token.length < 16) throw new Error("Invalid device token.");
    const version = (data.appVersion ?? "").trim().slice(0, 32) || null;
    try {
      await sql`
        insert into device_push_tokens (id, user_id, token, platform, app_version, last_seen_at, status, updated_at)
        values (${newId("dt")}, ${context.userId}, ${token}, ${data.platform}, ${version}, now(), ${"active"}, now())
        on conflict (token) do update set
          user_id = excluded.user_id,
          platform = excluded.platform,
          app_version = excluded.app_version,
          last_seen_at = now(),
          status = 'active',
          updated_at = now()
      `;
    } catch {
      await sql`
        insert into device_push_tokens (id, user_id, token, platform, updated_at)
        values (${newId("dt")}, ${context.userId}, ${token}, ${data.platform}, now())
        on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()
      `;
    }
    return { ok: true as const };
  });

export const phoneStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const p = await ensureProfile(sql, { id: context.userId });
    const row = await sql<{ phone_e164: string | null; phone_verified_at: string | null }>`
      select phone_e164, phone_verified_at from profiles where user_id = ${context.userId}
    `.catch(() => [{ phone_e164: null, phone_verified_at: null }]);
    return {
      configured: twilioConfigured(),
      phone: row[0]?.phone_e164 ?? (p as { phone_e164?: string | null }).phone_e164 ?? null,
      verifiedAt: row[0]?.phone_verified_at ?? null,
    };
  });

export const updateProfileExtras = createServerFn({ method: "POST" })
  .validator((d: { website?: string | null; location?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const site = data.website === undefined ? undefined : websiteOk(data.website ?? "") ?? null;
    const loc = data.location === undefined ? undefined : (data.location ?? "").trim().slice(0, 80) || null;
    await sql`
      update profiles set
        website = coalesce(${site ?? null}, website),
        location_name = coalesce(${loc ?? null}, location_name),
        updated_at = now()
      where user_id = ${context.userId}
    `;
    if (data.website !== undefined) {
      await sql`update profiles set website = ${site ?? null}, updated_at = now() where user_id = ${context.userId}`;
    }
    if (data.location !== undefined) {
      await sql`update profiles set location_name = ${loc}, updated_at = now() where user_id = ${context.userId}`;
    }
    return { ok: true as const, website: site ?? null, location: loc ?? null };
  });

export const savePlayback = createServerFn({ method: "POST" })
  .validator((d: { entityKind: string; entityId: string; positionMs: number }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      insert into playback_history (user_id, entity_kind, entity_id, position_ms, updated_at)
      values (${context.userId}, ${data.entityKind.slice(0, 20)}, ${data.entityId.slice(0, 64)}, ${Math.max(0, data.positionMs | 0)}, now())
      on conflict (user_id, entity_kind, entity_id) do update set position_ms = excluded.position_ms, updated_at = now()
    `;
    return { ok: true as const };
  });

export { liveKindOk, visibilityOk, identityKind, isArcFlag };
