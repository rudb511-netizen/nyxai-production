import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { canViewStory } from "../privacy";
import type { StoryCard } from "../types";
import {
  assertCapability,
  assertNotBanned,
  authorLite,
  bumpScore,
  ensureProfile,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";
import { ensureDm } from "./messages";

export const createStory = createServerFn({ method: "POST" })
  .validator((d: {
    mediaUrl?: string | null;
    mediaKind: "photo" | "video" | "text";
    textBody?: string | null;
    background?: string | null;
    privacy?: "everyone" | "friends" | "close";
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "story");
    if (data.mediaKind !== "text" && !data.mediaUrl) throw new Error("Add a photo or video.");
    const n = await sql<{ n: number }>`
      select count(*)::int as n from stories where author_id = ${context.userId} and expires_at > now()
    `;
    if ((n[0]?.n ?? 0) >= 100) {
      throw new Error("You already have 100 active stories. Wait for older ones to expire.");
    }
    const id = newId("st");
    await sql`
      insert into stories (id, author_id, media_url, media_kind, text_body, background, privacy, expires_at)
      values (
        ${id},
        ${context.userId},
        ${data.mediaUrl ?? null},
        ${data.mediaKind},
        ${(data.textBody ?? "").slice(0, 200)},
        ${data.background ?? "#121214"},
        ${data.privacy ?? me.story_visibility},
        now() + interval '24 hours'
      )
    `;
    await bumpScore(sql, context.userId, 1);
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "story",
      targetId: id,
      text: data.textBody ?? "",
      username: me.username,
    }).catch(() => {});
    return { id };
  });

export const listStories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StoryCard[]> => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const rows = await sql<{
      id: string;
      author_id: string;
      media_url: string | null;
      media_kind: StoryCard["mediaKind"];
      text_body: string | null;
      background: string | null;
      privacy: "everyone" | "friends" | "close";
      created_at: string;
      expires_at: string;
    }>`
      select * from stories
      where expires_at > now()
      order by created_at desc
      limit 80
    `;
    const authors = await loadAuthors(sql, rows.map((r) => r.author_id));
    const seen = await sql<{ story_id: string }>`
      select story_id from story_views where user_id = ${context.userId}
    `;
    const seenSet = new Set(seen.map((s) => s.story_id));
    const counts = await sql<{ story_id: string; n: number }>`
      select story_id, count(*)::int as n from story_views group by story_id
    `;
    const countMap = new Map(counts.map((c) => [c.story_id, c.n]));
    const out: StoryCard[] = [];
    for (const r of rows) {
      const author = authors.get(r.author_id);
      if (!author) continue;
      const rel = await getRelation(sql, context.userId, r.author_id);
      if (!canViewStory(rel, r.privacy)) continue;
      out.push({
        id: r.id,
        author: authorLite(author),
        mediaUrl: r.media_url,
        mediaKind: r.media_kind,
        textBody: r.text_body,
        background: r.background,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        seen: seenSet.has(r.id) && !rel.isSelf,
        viewerCount: rel.isSelf ? (countMap.get(r.id) ?? 0) : 0,
      });
    }
    out.sort((a, b) => {
      if (a.author.userId === context.userId) return -1;
      if (b.author.userId === context.userId) return 1;
      return Number(a.seen) - Number(b.seen);
    });
    return out;
  });

export const viewStory = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      insert into story_views (story_id, user_id) values (${data.id}, ${context.userId})
      on conflict do nothing
    `;
    return { ok: true as const };
  });

export const replyStory = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const body = data.body.trim().slice(0, 280);
    if (!body) throw new Error("Write a reply.");
    await sql`
      insert into story_replies (id, story_id, user_id, body)
      values (${newId("sr")}, ${data.id}, ${context.userId}, ${body})
    `;
    const story = await sql<{ author_id: string }>`select author_id from stories where id = ${data.id}`;
    if (story[0]) {
      const cid = await ensureDm(sql, context.userId, story[0].author_id);
      await sql`
        insert into messages (id, conversation_id, sender_id, kind, body)
        values (${newId("m")}, ${cid}, ${context.userId}, 'text', ${`Story reply: ${body}`})
      `;
      await sql`
        update conversations set last_message_at = now(), last_message_body = ${body.slice(0, 80)}
        where id = ${cid}
      `;
      await notify(sql, {
        userId: story[0].author_id,
        kind: "story_reply",
        body: `${me.display_name} replied to your story`,
        actorId: me.user_id,
        entityId: cid,
        prefKey: "stories",
      });
    }
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "comment",
      targetId: data.id,
      text: body,
      username: me.username,
    }).catch(() => {});
    return { ok: true as const };
  });

export const reactStory = createServerFn({ method: "POST" })
  .validator((d: { id: string; emoji: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "react");
    const emoji = data.emoji.slice(0, 8);
    const story = await sql<{ author_id: string; privacy: "everyone" | "friends" | "close"; text_body: string | null; media_kind: string }>`
      select author_id, privacy, text_body, media_kind from stories where id = ${data.id} and expires_at > now()
    `;
    if (!story[0]) throw new Error("Story expired.");
    if (story[0].author_id === context.userId) throw new Error("You cannot react to your own story.");
    const rel = await getRelation(sql, context.userId, story[0].author_id);
    if (!canViewStory(rel, story[0].privacy)) throw new Error("You cannot view this story.");
    await sql`
      insert into story_reactions (story_id, user_id, emoji)
      values (${data.id}, ${context.userId}, ${emoji})
      on conflict (story_id, user_id) do update set emoji = excluded.emoji
    `;
    const cid = await ensureDm(sql, context.userId, story[0].author_id);
    const preview = story[0].text_body?.slice(0, 40) || story[0].media_kind;
    await sql`
      insert into messages (id, conversation_id, sender_id, kind, body)
      values (
        ${newId("m")}, ${cid}, ${context.userId}, 'text',
        ${`reacted ${emoji} to your story: ${preview}`}
      )
    `;
    await sql`
      update conversations set last_message_at = now(), last_message_body = ${`${me.display_name} reacted ${emoji}`}
      where id = ${cid}
    `;
    await notify(sql, {
      userId: story[0].author_id,
      kind: "story_react",
      body: `${me.display_name} reacted ${emoji} to your story`,
      actorId: me.user_id,
      entityId: cid,
      prefKey: "stories",
    });
    return { conversationId: cid };
  });

export const storyViewers = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from stories where id = ${data.id} and author_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Story not found.");
    const rows = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }>`
      select p.user_id, p.username, p.display_name, p.avatar_url
      from story_views v join profiles p on p.user_id = v.user_id
      where v.story_id = ${data.id}
      order by v.created_at desc
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
    }));
  });
