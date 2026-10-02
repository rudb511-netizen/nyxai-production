import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import type { CommentNode, FeedPost, MediaItem, PollState } from "../types";
import { extractHashtags, extractMentions } from "../usernames";
import {
  assertCapability,
  assertNotBanned,
  authorLite,
  canSee,
  ensureProfile,
  getProfileByUsername,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
  bumpScore,
} from "./helpers";
import { canDeleteComment, canDeleteOwned } from "../safety";
import { insertOmniCommentReply, omniMentionReply } from "./omniai-mention";

export type PostRow = {
  id: string;
  author_id: string;
  body: string;
  kind: FeedPost["kind"];
  quote_of_id: string | null;
  repost_of_id: string | null;
  location: string | null;
  comments_disabled: boolean;
  is_removed: boolean;
  poll_json: unknown;
  poll_ends_at: string | null;
  created_at: string;
  edited_at: string | null;
  view_count?: number | null;
};

export async function hydratePosts(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  viewerId: string,
  rows: PostRow[],
  depth = 0,
): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const authors = await loadAuthors(sql, rows.map((r) => r.author_id));
  const idList = ids;
  const mediaBy = new Map<string, MediaItem[]>();
  if (idList.length) {
    const ph = idList.map((_, i) => `$${i + 1}`).join(",");
    const media = await sql.query<{
      id: string;
      post_id: string;
      kind: MediaItem["kind"];
      url: string;
      thumb_url: string | null;
      width: number | null;
      height: number | null;
    }>(
      `select id, post_id, kind, url, thumb_url, width, height from post_media
       where post_id in (${ph}) order by sort_order`,
      idList,
    );
    for (const m of media) {
      const arr = mediaBy.get(m.post_id) ?? [];
      arr.push({
        id: m.id,
        kind: m.kind,
        url: m.url,
        thumbUrl: m.thumb_url,
        width: m.width,
        height: m.height,
      });
      mediaBy.set(m.post_id, arr);
    }
  }

  const counts = new Map<string, { likes: number; comments: number; reposts: number }>();
  const liked = new Set<string>();
  const saved = new Set<string>();
  const reposted = new Set<string>();
  const votes = new Map<string, string>();

  if (idList.length) {
    const ph = idList.map((_, i) => `$${i + 1}`).join(",");
    const likeRows = await sql.query<{ post_id: string; n: number }>(
      `select post_id, count(*)::int as n from post_likes where post_id in (${ph}) group by post_id`,
      idList,
    );
    const commentRows = await sql.query<{ post_id: string; n: number }>(
      `select post_id, count(*)::int as n from comments where post_id in (${ph}) and is_removed = false group by post_id`,
      idList,
    );
    const repostRows = await sql.query<{ post_id: string; n: number }>(
      `select repost_of_id as post_id, count(*)::int as n from posts where repost_of_id in (${ph}) group by repost_of_id`,
      idList,
    );
    for (const r of likeRows) {
      const c = counts.get(r.post_id) ?? { likes: 0, comments: 0, reposts: 0 };
      c.likes = r.n;
      counts.set(r.post_id, c);
    }
    for (const r of commentRows) {
      const c = counts.get(r.post_id) ?? { likes: 0, comments: 0, reposts: 0 };
      c.comments = r.n;
      counts.set(r.post_id, c);
    }
    for (const r of repostRows) {
      const c = counts.get(r.post_id) ?? { likes: 0, comments: 0, reposts: 0 };
      c.reposts = r.n;
      counts.set(r.post_id, c);
    }
    const myLikes = await sql.query<{ post_id: string }>(
      `select post_id from post_likes where user_id = $${idList.length + 1} and post_id in (${ph})`,
      [...idList, viewerId],
    );
    for (const r of myLikes) liked.add(r.post_id);
    const mySaves = await sql.query<{ post_id: string }>(
      `select post_id from bookmarks where user_id = $${idList.length + 1} and post_id in (${ph})`,
      [...idList, viewerId],
    );
    for (const r of mySaves) saved.add(r.post_id);
    const myReposts = await sql.query<{ repost_of_id: string }>(
      `select repost_of_id from posts where author_id = $${idList.length + 1} and repost_of_id in (${ph})`,
      [...idList, viewerId],
    );
    for (const r of myReposts) if (r.repost_of_id) reposted.add(r.repost_of_id);
    const myVotes = await sql.query<{ post_id: string; option_id: string }>(
      `select post_id, option_id from poll_votes where user_id = $${idList.length + 1} and post_id in (${ph})`,
      [...idList, viewerId],
    );
    for (const r of myVotes) votes.set(r.post_id, r.option_id);
  }

  const quoteIds = rows.map((r) => r.quote_of_id).filter((x): x is string => Boolean(x));
  let quotes = new Map<string, FeedPost>();
  if (quoteIds.length && depth < 1) {
    const ph = quoteIds.map((_, i) => `$${i + 1}`).join(",");
    const qrows = await sql.query<PostRow>(
      `select * from posts where id in (${ph}) and is_removed = false`,
      quoteIds,
    );
    const hydrated = await hydratePosts(sql, viewerId, qrows, depth + 1);
    quotes = new Map(hydrated.map((p) => [p.id, p]));
  }

  const out: FeedPost[] = [];
  for (const r of rows) {
    const author = authors.get(r.author_id);
    if (!author) continue;
    let poll: PollState | null = null;
    if (r.poll_json) {
      const raw =
        typeof r.poll_json === "string"
          ? (JSON.parse(r.poll_json) as { options: { id: string; text: string }[] })
          : (r.poll_json as { options: { id: string; text: string }[] });
      const voteCounts = await sql<{ option_id: string; n: number }>`
        select option_id, count(*)::int as n from poll_votes where post_id = ${r.id} group by option_id
      `;
      const vc = new Map(voteCounts.map((v) => [v.option_id, v.n]));
      const options = (raw.options ?? []).map((o: { id: string; text: string }) => ({
        id: o.id,
        text: o.text,
        votes: vc.get(o.id) ?? 0,
      }));
      poll = {
        options,
        endsAt: r.poll_ends_at,
        myVote: votes.get(r.id) ?? null,
        total: options.reduce((sum: number, o: { votes: number }) => sum + o.votes, 0),
      };
    }
    const c = counts.get(r.id) ?? { likes: 0, comments: 0, reposts: 0 };
    out.push({
      id: r.id,
      kind: r.kind,
      body: r.body,
      author: authorLite(author),
      media: mediaBy.get(r.id) ?? [],
      poll,
      location: r.location,
      likes: c.likes,
      comments: c.comments,
      reposts: c.reposts,
      liked: liked.has(r.id),
      saved: saved.has(r.id),
      reposted: reposted.has(r.id),
      commentsDisabled: r.comments_disabled,
      quoteOf: r.quote_of_id ? quotes.get(r.quote_of_id) ?? null : null,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      views: Number(r.view_count ?? 0),
    });
  }
  return out;
}

export const getFeed = createServerFn({ method: "GET" })
  .validator((d: { cursor?: string | null; tab?: "foryou" | "following" | "friends" | "trending" } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const cursor = data.cursor ?? null;
    const tab = data.tab ?? "foryou";
    const hideSql = `and not exists (
           select 1 from feed_hides h
           where h.user_id = $1
             and (
               (h.target_kind = 'post' and h.target_id = p.id)
               or (h.target_kind = 'author' and h.target_id = p.author_id)
             )
         )
         and not exists (
           select 1 from mutes mu where mu.user_id = $1 and mu.muted_id = p.author_id
         )`;
    const visibility = `p.is_removed = false
         and a.is_banned = false
         and a.deactivated_at is null
         and (p.published_at is null or p.published_at <= now())
         and not exists (
           select 1 from blocks b
           where (b.blocker_id = $1 and b.blocked_id = p.author_id)
              or (b.blocker_id = p.author_id and b.blocked_id = $1)
         )
         and (
           p.author_id = $1
           or a.is_private = false
           or exists (select 1 from follows f where f.follower_id = $1 and f.following_id = p.author_id)
           or exists (
             select 1 from friendships fr
             where fr.user_a = least($1, p.author_id) and fr.user_b = greatest($1, p.author_id)
           )
         )
         and ($2::timestamptz is null or p.created_at < $2)`;
    const tabFilter =
      tab === "following"
        ? `and exists (select 1 from follows f where f.follower_id = $1 and f.following_id = p.author_id)`
        : tab === "friends"
          ? `and exists (
               select 1 from friendships fr
               where fr.user_a = least($1, p.author_id) and fr.user_b = greatest($1, p.author_id)
             )`
          : "";
    const order =
      tab === "trending"
        ? `order by (
             (select count(*) from post_likes l where l.post_id = p.id and l.created_at > now() - interval '24 hours') * 2
             + (select count(*) from comments c where c.post_id = p.id and c.is_removed = false and c.created_at > now() - interval '24 hours') * 3
           ) desc, p.created_at desc`
        : tab === "foryou"
          ? `order by (
               (select count(*) from post_likes l where l.post_id = p.id) * 2
               + (select count(*) from comments c where c.post_id = p.id and c.is_removed = false) * 3
             ) * (1.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 3600.0 / 24.0))
             + case when exists (select 1 from follows f where f.follower_id = $1 and f.following_id = p.author_id) then 10 else 0 end
             + (
               select count(*) * 5 from post_hashtags ph
               join user_interests ui on ui.tag = ph.tag and ui.user_id = $1
               where ph.post_id = p.id
             )
           desc, p.created_at desc`
          : `order by p.created_at desc`;
    const sqlText = `select p.* from posts p
       join profiles a on a.user_id = p.author_id
       where ${visibility}
         ${tabFilter}
         ${hideSql}
       ${order}
       limit 24`;
    let rows: PostRow[];
    try {
      rows = await sql.query<PostRow>(sqlText, [context.userId, cursor]);
    } catch {
      rows = await sql.query<PostRow>(
        `select p.* from posts p
         join profiles a on a.user_id = p.author_id
         where ${visibility}
         order by
           (exists (select 1 from follows f where f.follower_id = $1 and f.following_id = p.author_id)) desc,
           p.created_at desc
         limit 24`,
        [context.userId, cursor],
      );
    }
    const items = await hydratePosts(sql, context.userId, rows);
    const nextCursor = rows.length === 24 ? rows[rows.length - 1]!.created_at : null;
    return { items, nextCursor, tab };
  });


export const createPost = createServerFn({ method: "POST" })
  .validator((d: {
    body: string;
    media?: { kind: MediaItem["kind"]; url: string; thumbUrl?: string | null; width?: number | null; height?: number | null }[];
    location?: string | null;
    commentsDisabled?: boolean;
    quoteOfId?: string | null;
    poll?: { options: string[]; hours: number } | null;
    scheduledAt?: string | null;
    visibility?: "everyone" | "followers" | "mentioned";
    threadItems?: string[];
    replyControl?: "everyone" | "following" | "mentioned";
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "post");
    const wait = takeToken(`post:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const body = data.body.trim().slice(0, 4000);
    const media = (data.media ?? []).slice(0, 4);
    const extras = (data.threadItems ?? []).map((t) => t.trim().slice(0, 4000)).filter(Boolean).slice(0, 8);
    if (!body && media.length === 0 && !data.poll && !data.quoteOfId) throw new Error("Write something or add media.");
    let scheduled: Date | null = null;
    if (data.scheduledAt) {
      const { parseScheduleAt } = await import("../graph");
      scheduled = parseScheduleAt(data.scheduledAt);
    }
    const vis = data.visibility && ["everyone", "followers", "mentioned"].includes(data.visibility)
      ? data.visibility
      : "everyone";
    const reply = data.replyControl && ["everyone", "following", "mentioned"].includes(data.replyControl)
      ? data.replyControl
      : "everyone";
    const id = newId("p");
    let pollJson: string | null = null;
    let pollEnds: string | null = null;
    if (data.poll && data.poll.options.filter((o) => o.trim()).length >= 2) {
      pollJson = JSON.stringify({
        options: data.poll.options
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4)
          .map((text) => ({ id: newId("op"), text })),
      });
      pollEnds = new Date(Date.now() + data.poll.hours * 3600_000).toISOString();
    }
    const publishedAt = scheduled ? scheduled.toISOString() : new Date().toISOString();
    try {
      await sql`
        insert into posts (id, author_id, body, kind, quote_of_id, location, comments_disabled, poll_json, poll_ends_at, published_at, scheduled_at, visibility, thread_id, thread_position, reply_control)
        values (
          ${id},
          ${context.userId},
          ${body},
          ${data.quoteOfId ? "quote" : "post"},
          ${data.quoteOfId ?? null},
          ${data.location ?? null},
          ${Boolean(data.commentsDisabled)},
          ${pollJson}::jsonb,
          ${pollEnds},
          ${publishedAt},
          ${scheduled ? scheduled.toISOString() : null},
          ${vis},
          ${extras.length ? id : null},
          ${0},
          ${reply}
        )
      `;
    } catch {
      await sql`
        insert into posts (id, author_id, body, kind, quote_of_id, location, comments_disabled, poll_json, poll_ends_at)
        values (
          ${id},
          ${context.userId},
          ${body},
          ${data.quoteOfId ? "quote" : "post"},
          ${data.quoteOfId ?? null},
          ${data.location ?? null},
          ${Boolean(data.commentsDisabled)},
          ${pollJson}::jsonb,
          ${pollEnds}
        )
      `;
    }
    for (let i = 0; i < media.length; i++) {
      const m = media[i]!;
      await sql`
        insert into post_media (id, post_id, kind, url, thumb_url, width, height, sort_order)
        values (${newId("md")}, ${id}, ${m.kind}, ${m.url}, ${m.thumbUrl ?? null}, ${m.width ?? null}, ${m.height ?? null}, ${i})
      `;
    }
    for (const tag of extractHashtags(body)) {
      await sql`
        insert into hashtags (tag, use_count) values (${tag}, 1)
        on conflict (tag) do update set use_count = hashtags.use_count + 1, updated_at = now()
      `;
      await sql`insert into post_hashtags (post_id, tag) values (${id}, ${tag}) on conflict do nothing`;
    }
    for (const name of extractMentions(body)) {
      const mentioned = await getProfileByUsername(sql, name);
      if (mentioned) {
        await notify(sql, {
          userId: mentioned.user_id,
          kind: "mention",
          body: `${me.display_name} mentioned you`,
          actorId: me.user_id,
          entityId: id,
          prefKey: "comments",
        });
      }
    }
    const threadIds = [id];
    for (let i = 0; i < extras.length; i++) {
      const tid = newId("p");
      threadIds.push(tid);
      try {
        await sql`
          insert into posts (id, author_id, body, kind, published_at, scheduled_at, visibility, thread_id, thread_position, reply_control)
          values (
            ${tid},
            ${context.userId},
            ${extras[i]!},
            'post',
            ${publishedAt},
            ${scheduled ? scheduled.toISOString() : null},
            ${vis},
            ${id},
            ${i + 1},
            ${reply}
          )
        `;
      } catch {
        await sql`
          insert into posts (id, author_id, body, kind)
          values (${tid}, ${context.userId}, ${extras[i]!}, 'post')
        `;
      }
      for (const tag of extractHashtags(extras[i]!)) {
        await sql`
          insert into hashtags (tag, use_count) values (${tag}, 1)
          on conflict (tag) do update set use_count = hashtags.use_count + 1, updated_at = now()
        `;
        await sql`insert into post_hashtags (post_id, tag) values (${tid}, ${tag}) on conflict do nothing`;
      }
    }
    if (data.quoteOfId) {
      const quoted = await sql<{ author_id: string }>`select author_id from posts where id = ${data.quoteOfId}`;
      if (quoted[0] && quoted[0].author_id !== context.userId) {
        await notify(sql, {
          userId: quoted[0].author_id,
          kind: "quote",
          body: `${me.display_name} quoted your post`,
          actorId: me.user_id,
          entityId: id,
          prefKey: "likes",
        });
      }
    }
    await bumpScore(sql, context.userId, 1);
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "post",
      targetId: id,
      text: body,
      username: me.username,
    }).catch(() => {});
    return { id, threadIds, scheduled: Boolean(scheduled) };
  });

export const editPost = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const body = data.body.trim().slice(0, 4000);
    const res = await sql`
      update posts set body = ${body}, edited_at = now(), updated_at = now()
      where id = ${data.id} and author_id = ${context.userId} and is_removed = false
    `;
    void res;
    return { ok: true as const };
  });

export const deletePost = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const post = await sql<{ id: string; author_id: string; is_removed: boolean }>`
      select id, author_id, is_removed from posts where id = ${data.id}
    `;
    if (!post[0] || post[0].is_removed) throw new Error("Post not found.");
    if (!canDeleteOwned(context.userId, post[0].author_id, me.role)) {
      throw new Error("You can only delete your own posts.");
    }
    await sql`update posts set is_removed = true, updated_at = now() where id = ${data.id}`;
    if (post[0].author_id !== context.userId) {
      await sql`
        insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
        values (${newId("ma")}, ${context.userId}, 'remove', 'post', ${data.id}, 'Deleted by staff')
      `;
    }
    return { ok: true as const };
  });

export const toggleLike = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const wait = takeToken(`like:${context.userId}`, 60, 60_000);
    if (wait) throw new Error(rateError(wait));
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from post_likes where post_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from post_likes where post_id = ${data.id} and user_id = ${context.userId}`;
      return { liked: false };
    }
    await sql`insert into post_likes (post_id, user_id) values (${data.id}, ${context.userId}) on conflict do nothing`;
    const post = await sql<{ author_id: string }>`select author_id from posts where id = ${data.id}`;
    if (post[0]) {
      await notify(sql, {
        userId: post[0].author_id,
        kind: "like",
        body: `${me.display_name} liked your post`,
        actorId: me.user_id,
        entityId: data.id,
        prefKey: "likes",
      });
    }
    return { liked: true };
  });

export const toggleSave = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from bookmarks where post_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from bookmarks where post_id = ${data.id} and user_id = ${context.userId}`;
      return { saved: false };
    }
    await sql`insert into bookmarks (user_id, post_id) values (${context.userId}, ${data.id}) on conflict do nothing`;
    return { saved: true };
  });

export const repostPost = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const existing = await sql<{ id: string }>`
      select id from posts where author_id = ${context.userId} and repost_of_id = ${data.id} limit 1
    `;
    if (existing[0]) {
      await sql`delete from posts where id = ${existing[0].id}`;
      return { reposted: false };
    }
    const id = newId("p");
    await sql`
      insert into posts (id, author_id, body, kind, repost_of_id, quote_of_id)
      values (${id}, ${context.userId}, '', 'repost', ${data.id}, ${data.id})
    `;
    const post = await sql<{ author_id: string }>`select author_id from posts where id = ${data.id}`;
    if (post[0]) {
      await notify(sql, {
        userId: post[0].author_id,
        kind: "repost",
        body: `${me.display_name} reposted you`,
        actorId: me.user_id,
        entityId: data.id,
        prefKey: "likes",
      });
    }
    return { reposted: true };
  });

export const votePoll = createServerFn({ method: "POST" })
  .validator((d: { postId: string; optionId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      insert into poll_votes (post_id, user_id, option_id)
      values (${data.postId}, ${context.userId}, ${data.optionId})
      on conflict (post_id, user_id) do update set option_id = excluded.option_id
    `;
    return { ok: true as const };
  });

export const recordPostView = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const post = await sql<{ id: string; is_removed: boolean; view_count: number | null }>`
      select id, is_removed, coalesce(view_count, 0) as view_count from posts where id = ${data.id}
    `.catch(async () => {
      const rows = await sql<{ id: string; is_removed: boolean }>`
        select id, is_removed from posts where id = ${data.id}
      `;
      return rows.map((r) => ({ ...r, view_count: 0 }));
    });
    if (!post[0] || post[0].is_removed) throw new Error("Post not found.");
    const inserted = await sql<{ post_id: string }>`
      insert into post_views (post_id, user_id)
      values (${data.id}, ${context.userId})
      on conflict do nothing
      returning post_id
    `.catch(() => [] as { post_id: string }[]);
    if (inserted[0]) {
      const updated = await sql<{ view_count: number }>`
        update posts set view_count = coalesce(view_count, 0) + 1 where id = ${data.id}
        returning view_count
      `.catch(() => [{ view_count: (post[0]!.view_count ?? 0) + 1 }]);
      return { ok: true as const, views: updated[0]?.view_count ?? (post[0].view_count ?? 0) + 1, counted: true };
    }
    return { ok: true as const, views: post[0].view_count ?? 0, counted: false };
  });

export const addComment = createServerFn({ method: "POST" })
  .validator((d: { postId: string; body: string; parentId?: string | null; stickerId?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "comment");
    const wait = takeToken(`comment:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const body = data.body.trim().slice(0, 1000);
    const stickerId = data.stickerId?.trim() || null;
    if (!body && !stickerId) throw new Error("Write a comment.");
    const post = await sql<{ author_id: string; comments_disabled: boolean }>`
      select author_id, comments_disabled from posts where id = ${data.postId} and is_removed = false
    `;
    if (!post[0]) throw new Error("Post not found.");
    if (post[0].comments_disabled) throw new Error("Comments are turned off.");
    const rel = await getRelation(sql, context.userId, post[0].author_id);
    if (rel.isBlocked || rel.isBlockedBy) throw new Error("You can't comment on this post.");
    if (stickerId) {
      const { findStickerById } = await import("../stickers");
      const def = findStickerById(stickerId);
      if (!def) {
        const row = await sql<{ id: string }>`
          select id from stickers where id = ${stickerId} and coalesce(is_removed, false) = false
        `.catch(() => []);
        if (!row[0]) throw new Error("Couldn't send that sticker.");
      }
    }
    const id = newId("c");
    await sql`
      insert into comments (id, post_id, author_id, parent_id, body, sticker_id)
      values (${id}, ${data.postId}, ${context.userId}, ${data.parentId ?? null}, ${body}, ${stickerId})
    `.catch(async () => {
      await sql`
        insert into comments (id, post_id, author_id, parent_id, body)
        values (${id}, ${data.postId}, ${context.userId}, ${data.parentId ?? null}, ${body})
      `;
    });
    await notify(sql, {
      userId: post[0].author_id,
      kind: "comment",
      body: `${me.display_name} commented on your post`,
      actorId: me.user_id,
      entityId: data.postId,
      prefKey: "comments",
    });
    for (const name of extractMentions(body)) {
      const mentioned = await getProfileByUsername(sql, name);
      if (mentioned) {
        await notify(sql, {
          userId: mentioned.user_id,
          kind: "mention",
          body: `${me.display_name} mentioned you in a comment`,
          actorId: me.user_id,
          entityId: data.postId,
          prefKey: "comments",
        });
      }
    }
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "comment",
      targetId: id,
      text: body,
      username: me.username,
    }).catch(() => {});
    const reply = await omniMentionReply({ sql, actorId: context.userId, text: body });
    if (reply) {
      await insertOmniCommentReply(sql, data.postId, id, reply);
    }
    return { id };
  });


export const deleteComment = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const row = await sql<{
      id: string;
      author_id: string;
      post_id: string;
      is_removed: boolean;
    }>`
      select id, author_id, post_id, is_removed from comments where id = ${data.id}
    `;
    if (!row[0] || row[0].is_removed) throw new Error("Comment not found.");
    const post = await sql<{ author_id: string }>`
      select author_id from posts where id = ${row[0].post_id}
    `;
    if (
      !canDeleteComment({
        viewerId: context.userId,
        commentAuthorId: row[0].author_id,
        postAuthorId: post[0]?.author_id ?? null,
        role: me.role,
      })
    ) {
      throw new Error("You can only delete your own comments.");
    }
    await sql`update comments set is_removed = true where id = ${data.id}`;
    if (row[0].author_id !== context.userId) {
      await sql`
        insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
        values (${newId("ma")}, ${context.userId}, 'remove', 'comment', ${data.id}, 'Deleted comment')
      `;
    }
    return { ok: true as const };
  });

export const listComments = createServerFn({ method: "GET" })
  .validator((d: { postId: string; sort?: "newest" | "liked" | "relevant" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<CommentNode[]> => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      author_id: string;
      parent_id: string | null;
      body: string;
      created_at: string;
      is_pinned?: boolean;
      edited_at?: string | null;
      sticker_id?: string | null;
    }>`
      select id, author_id, parent_id, body, created_at,
        coalesce(is_pinned, false) as is_pinned, edited_at, sticker_id
      from comments
      where post_id = ${data.postId} and is_removed = false
      order by created_at
    `.catch(async () =>
      sql<{
        id: string;
        author_id: string;
        parent_id: string | null;
        body: string;
        created_at: string;
      }>`
        select id, author_id, parent_id, body, created_at from comments
        where post_id = ${data.postId} and is_removed = false
        order by created_at
      `,
    );
    const { stickerViews } = await import("./stickers");
    const stickers = await stickerViews(
      sql,
      rows.map((r) => ("sticker_id" in r ? r.sticker_id : null)),
    );
    const authors = await loadAuthors(sql, rows.map((r) => r.author_id));
    const likes = await sql<{ comment_id: string; n: number }>`
      select comment_id, count(*)::int as n from comment_likes
      where comment_id in (select id from comments where post_id = ${data.postId})
      group by comment_id
    `;
    const mine = await sql<{ comment_id: string }>`
      select comment_id from comment_likes where user_id = ${context.userId}
    `;
    const likeMap = new Map(likes.map((l) => [l.comment_id, l.n]));
    const liked = new Set(mine.map((m) => m.comment_id));
    const nodes = new Map<string, CommentNode>();
    const roots: CommentNode[] = [];
    for (const r of rows) {
      const a = authors.get(r.author_id);
      if (!a) continue;
      const node: CommentNode = {
        id: r.id,
        body: r.body,
        author: authorLite(a),
        likes: likeMap.get(r.id) ?? 0,
        liked: liked.has(r.id),
        createdAt: r.created_at,
        replies: [],
        pinned: Boolean("is_pinned" in r ? r.is_pinned : false),
        editedAt: ("edited_at" in r ? r.edited_at : null) ?? null,
        sticker: ("sticker_id" in r && r.sticker_id ? stickers.get(r.sticker_id) ?? null : null),
      };
      nodes.set(r.id, node);
    }
    for (const r of rows) {
      const node = nodes.get(r.id);
      if (!node) continue;
      if (r.parent_id && nodes.has(r.parent_id)) nodes.get(r.parent_id)!.replies.push(node);
      else roots.push(node);
    }
    const sort = data.sort ?? "newest";
    const rank = (a: CommentNode, b: CommentNode) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (sort === "liked") return b.likes - a.likes;
      if (sort === "relevant") return b.likes * 2 + b.replies.length - (a.likes * 2 + a.replies.length);
      return a.createdAt < b.createdAt ? 1 : -1;
    };
    roots.sort(rank);
    for (const n of roots) n.replies.sort(rank);
    return roots;
  });

export const editComment = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const body = data.body.trim().slice(0, 1000);
    if (!body) throw new Error("Write a comment.");
    const res = await sql`
      update comments set body = ${body}, edited_at = now()
      where id = ${data.id} and author_id = ${context.userId} and is_removed = false
    `;
    void res;
    return { ok: true as const };
  });

export const pinComment = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ id: string; post_id: string; is_pinned: boolean }>`
      select id, post_id, coalesce(is_pinned, false) as is_pinned from comments where id = ${data.id} and is_removed = false
    `;
    if (!row[0]) throw new Error("Comment not found.");
    const post = await sql<{ author_id: string }>`select author_id from posts where id = ${row[0].post_id}`;
    if (!post[0] || post[0].author_id !== context.userId) throw new Error("Only the author can pin comments.");
    if (row[0].is_pinned) {
      await sql`update comments set is_pinned = false where id = ${data.id}`;
      return { pinned: false };
    }
    await sql`update comments set is_pinned = false where post_id = ${row[0].post_id}`;
    await sql`update comments set is_pinned = true where id = ${data.id}`;
    await sql`update posts set pinned_comment_id = ${data.id} where id = ${row[0].post_id}`.catch(() => {});
    return { pinned: true };
  });

export const getThread = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const root = await sql.query<PostRow>(`select * from posts where id = $1 and is_removed = false`, [data.id]);
    if (!root[0]) throw new Error("Post not found.");
    const threadId = (root[0] as PostRow & { thread_id?: string | null }).thread_id ?? root[0].id;
    const rows = await sql.query<PostRow>(
      `select * from posts where (id = $1 or thread_id = $1) and is_removed = false order by coalesce(thread_position, 0), created_at`,
      [threadId],
    ).catch(async () => root);
    return hydratePosts(sql, context.userId, rows.length ? rows : root);
  });

export const getPost = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql.query<PostRow>(`select * from posts where id = $1 and is_removed = false`, [
      data.id,
    ]);
    const items = await hydratePosts(sql, context.userId, rows);
    const post = items[0];
    if (!post) throw new Error("Post not found.");
    return post;
  });

export const userPosts = createServerFn({ method: "GET" })
  .validator((d: { username: string; tab?: "posts" | "media" | "likes" | "saved" | "reposts" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfileByUsername(sql, data.username);
    if (!p) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, p.user_id);
    if (!canSee(rel, p) && data.tab !== "posts") return { items: [] as FeedPost[] };
    if (!canSee(rel, p)) return { items: [] as FeedPost[] };
    const tab = data.tab ?? "posts";
    let rows: PostRow[] = [];
    if (tab === "likes") {
      if (!rel.isSelf) return { items: [] };
      rows = await sql.query<PostRow>(
        `select p.* from post_likes l join posts p on p.id = l.post_id
         where l.user_id = $1 and p.is_removed = false order by l.created_at desc limit 40`,
        [p.user_id],
      );
    } else if (tab === "saved") {
      if (!rel.isSelf) return { items: [] };
      rows = await sql.query<PostRow>(
        `select p.* from bookmarks b join posts p on p.id = b.post_id
         where b.user_id = $1 and p.is_removed = false order by b.created_at desc limit 40`,
        [p.user_id],
      );
    } else if (tab === "reposts") {
      try {
        rows = await sql.query<PostRow>(
          `select * from posts where author_id = $1 and kind = 'repost' and is_removed = false
           and (published_at is null or published_at <= now())
           order by created_at desc limit 40`,
          [p.user_id],
        );
      } catch {
        rows = await sql.query<PostRow>(
          `select * from posts where author_id = $1 and kind = 'repost' and is_removed = false
           order by created_at desc limit 40`,
          [p.user_id],
        );
      }
    } else if (tab === "media") {
      try {
        rows = await sql.query<PostRow>(
          `select distinct p.* from posts p join post_media m on m.post_id = p.id
           where p.author_id = $1 and p.is_removed = false
           and (p.published_at is null or p.published_at <= now())
           order by p.created_at desc limit 40`,
          [p.user_id],
        );
      } catch {
        rows = await sql.query<PostRow>(
          `select distinct p.* from posts p join post_media m on m.post_id = p.id
           where p.author_id = $1 and p.is_removed = false order by p.created_at desc limit 40`,
          [p.user_id],
        );
      }
    } else {
      try {
        rows = await sql.query<PostRow>(
          `select * from posts where author_id = $1 and is_removed = false and kind <> 'repost'
           and (published_at is null or published_at <= now())
           order by created_at desc limit 40`,
          [p.user_id],
        );
      } catch {
        rows = await sql.query<PostRow>(
          `select * from posts where author_id = $1 and is_removed = false and kind <> 'repost'
           order by created_at desc limit 40`,
          [p.user_id],
        );
      }
    }
    return { items: await hydratePosts(sql, context.userId, rows) };
  });

export const pinPost = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from posts where id = ${data.id} and author_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Post not found.");
    await sql`update profiles set pinned_post_id = ${data.id} where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const toggleCommentLike = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from comment_likes where comment_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from comment_likes where comment_id = ${data.id} and user_id = ${context.userId}`;
      return { liked: false };
    }
    await sql`insert into comment_likes (comment_id, user_id) values (${data.id}, ${context.userId}) on conflict do nothing`;
    return { liked: true };
  });
