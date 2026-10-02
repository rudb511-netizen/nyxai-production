import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { canViewStatus, type StatusAudience } from "../privacy";
import type { StatusCard } from "../types";
import {
  assertCapability,
  authorLite,
  bumpScore,
  ensureProfile,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";
import { ensureDm } from "./messages";
import { canReshareStatus } from "../status-reshare";

const ACTIVE_LIMIT = 100;

async function audienceFor(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  statusId: string,
  audience: StatusAudience,
): Promise<{ mode: "except" | "only"; userIds: string[] } | undefined> {
  if (audience === "friends") return undefined;
  const rows = await sql<{ user_id: string; mode: "except" | "only" }>`
    select user_id, mode from status_audience where status_id = ${statusId}
  `;
  return { mode: audience, userIds: rows.map((r) => r.user_id) };
}

export const createStatus = createServerFn({ method: "POST" })
  .validator((d: {
    mediaUrl?: string | null;
    mediaKind: "photo" | "video" | "text";
    textBody?: string | null;
    background?: string | null;
    audience?: StatusAudience;
    exceptUserIds?: string[];
    onlyUserIds?: string[];
    viewOnce?: boolean;
    uploadId?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "status");
    if (data.mediaKind !== "text" && !data.mediaUrl && !data.uploadId) throw new Error("Add a photo or video.");
    const { isMediaApiUrl } = await import("../media-pipeline");
    const { getOwnedUpload, markUploadPublished } = await import("./media-upload");
    let mediaUrl = data.mediaUrl ?? null;
    if (data.uploadId) {
      const owned = await getOwnedUpload(sql, context.userId, data.uploadId);
      if (!owned) throw new Error("Upload session not found.");
      if (owned.status === "published" && owned.published_id) {
        return { id: owned.published_id };
      }
      const already = await sql<{ id: string }>`
        select id from statuses where upload_id = ${data.uploadId} limit 1
      `.catch(() => []);
      if (already[0]) {
        await markUploadPublished(sql, data.uploadId, already[0].id);
        return { id: already[0].id };
      }
      if (owned.status === "processing" || owned.status === "uploading" || owned.status === "upload_complete") {
        throw new Error("Video uploaded. Processing is still in progress.");
      }
      if (owned.status !== "ready" && owned.status !== "publishing") {
        throw new Error(owned.fail_reason || "Video processing failed. Retry processing.");
      }
      mediaUrl = owned.media_url || `/api/media/${owned.id}`;
      await sql`update media_uploads set status = 'publishing', updated_at = now() where id = ${data.uploadId}`;
    } else if (data.mediaKind === "video" && mediaUrl && !isMediaApiUrl(mediaUrl) && mediaUrl.length > 18_000_000) {
      throw new Error("Status video is still too large after compression. Keep it under 2 minutes.");
    }
    if (data.viewOnce && data.mediaKind === "text") {
      throw new Error("View once is for photos and videos.");
    }
    const n = await sql<{ n: number }>`
      select count(*)::int as n from statuses where author_id = ${context.userId} and expires_at > now()
    `;
    if ((n[0]?.n ?? 0) >= ACTIVE_LIMIT) {
      throw new Error("You already have 100 active statuses. Wait for older ones to expire.");
    }
    const audience: StatusAudience = data.audience ?? (me.status_privacy as StatusAudience) ?? "friends";
    const id = newId("ss");
    try {
      await sql`
      insert into statuses (id, author_id, media_url, media_kind, text_body, background, expires_at, audience, view_once, upload_id)
      values (
        ${id},
        ${context.userId},
        ${mediaUrl},
        ${data.mediaKind},
        ${(data.textBody ?? "").slice(0, 280)},
        ${data.background ?? "#1e1b4b"},
        now() + interval '24 hours',
        ${audience},
        ${Boolean(data.viewOnce)},
        ${data.uploadId ?? null}
      )
    `;
    } catch {
      await sql`
      insert into statuses (id, author_id, media_url, media_kind, text_body, background, expires_at, audience, view_once)
      values (
        ${id},
        ${context.userId},
        ${mediaUrl},
        ${data.mediaKind},
        ${(data.textBody ?? "").slice(0, 280)},
        ${data.background ?? "#1e1b4b"},
        now() + interval '24 hours',
        ${audience},
        ${Boolean(data.viewOnce)}
      )
    `;
    }
    if (data.uploadId) {
      await markUploadPublished(sql, data.uploadId, id);
    }
    const listed =
      audience === "except" ? data.exceptUserIds ?? [] : audience === "only" ? data.onlyUserIds ?? [] : [];
    for (const uid of listed.slice(0, 200)) {
      if (uid === context.userId) continue;
      await sql`
        insert into status_audience (status_id, user_id, mode)
        values (${id}, ${uid}, ${audience === "except" ? "except" : "only"})
        on conflict do nothing
      `;
    }
    await sql`update profiles set status_privacy = ${audience} where user_id = ${context.userId}`;
    await bumpScore(sql, context.userId, 1);
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "status",
      targetId: id,
      text: data.textBody ?? "",
      username: me.username,
    }).catch(() => {});
    return { id };
  });

export const listStatuses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StatusCard[]> => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const rows = await sql<{
      id: string;
      author_id: string;
      media_url: string | null;
      media_kind: StatusCard["mediaKind"];
      text_body: string | null;
      background: string | null;
      created_at: string;
      expires_at: string;
      audience: StatusAudience;
      view_once: boolean;
      reshare_of_id: string | null;
      original_author_id: string | null;
    }>`
      select id, author_id, media_url, media_kind, text_body, background, created_at, expires_at,
             coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once,
             reshare_of_id, original_author_id
      from statuses
      where expires_at > now()
      order by created_at desc
      limit 80
    `.catch(async () =>
      (await sql<{
        id: string;
        author_id: string;
        media_url: string | null;
        media_kind: StatusCard["mediaKind"];
        text_body: string | null;
        background: string | null;
        created_at: string;
        expires_at: string;
        audience: StatusAudience;
        view_once: boolean;
      }>`
        select id, author_id, media_url, media_kind, text_body, background, created_at, expires_at,
               coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once
        from statuses
        where expires_at > now()
        order by created_at desc
        limit 80
      `).map((r) => ({ ...r, reshare_of_id: null, original_author_id: null })),
    );
    const authors = await loadAuthors(
      sql,
      rows.flatMap((r) => [r.author_id, r.original_author_id].filter((x): x is string => Boolean(x))),
    );
    const seen = await sql<{ status_id: string }>`
      select status_id from status_views where user_id = ${context.userId}
    `;
    const seenSet = new Set(seen.map((s) => s.status_id));
    const counts = await sql<{ status_id: string; n: number }>`
      select status_id, count(*)::int as n from status_views group by status_id
    `;
    const countMap = new Map(counts.map((c) => [c.status_id, c.n]));
    const out: StatusCard[] = [];
    for (const r of rows) {
      const author = authors.get(r.author_id);
      if (!author) continue;
      const rel = await getRelation(sql, context.userId, r.author_id);
      const listed = await audienceFor(sql, r.id, r.audience);
      if (!canViewStatus(rel, r.audience, listed, context.userId)) continue;
      const opened = seenSet.has(r.id) && !rel.isSelf;
      const hideMedia = r.view_once && opened;
      const originalId = r.original_author_id || r.author_id;
      const orig = originalId !== r.author_id ? authors.get(originalId) : null;
      const ownerAllow = (orig ?? author).allow_status_reshare !== false;
      const origRel =
        originalId === r.author_id ? rel : await getRelation(sql, context.userId, originalId);
      const reshare = canReshareStatus({
        allowReshare: ownerAllow,
        expired: false,
        viewOnce: r.view_once,
        isSelf: origRel.isSelf || rel.isSelf,
        isBlocked: origRel.isBlocked || rel.isBlocked,
        isBlockedBy: origRel.isBlockedBy || rel.isBlockedBy,
        canView: true,
      });
      out.push({
        id: r.id,
        author: authorLite(author),
        mediaUrl: hideMedia ? null : rel.isSelf || !r.view_once ? r.media_url : null,
        mediaKind: r.media_kind,
        textBody: r.text_body,
        background: r.background,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        seen: opened,
        viewerCount: rel.isSelf ? (countMap.get(r.id) ?? 0) : 0,
        audience: r.audience,
        viewOnce: r.view_once,
        opened,
        reshareOfId: r.reshare_of_id,
        originalAuthor: orig ? authorLite(orig) : r.reshare_of_id ? authorLite(author) : null,
        allowReshare: reshare.ok,
      });
    }
    out.sort((a, b) => {
      if (a.author.userId === context.userId) return -1;
      if (b.author.userId === context.userId) return 1;
      return Number(a.seen) - Number(b.seen);
    });
    return out;
  });

export const getStatus = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{
      id: string;
      author_id: string;
      media_url: string | null;
      media_kind: StatusCard["mediaKind"];
      text_body: string | null;
      background: string | null;
      created_at: string;
      expires_at: string;
      audience: StatusAudience;
      view_once: boolean;
      reshare_of_id: string | null;
      original_author_id: string | null;
    }>`
      select id, author_id, media_url, media_kind, text_body, background, created_at, expires_at,
             coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once,
             reshare_of_id, original_author_id
      from statuses where id = ${data.id} and expires_at > now()
    `.catch(async () =>
      (await sql<{
        id: string;
        author_id: string;
        media_url: string | null;
        media_kind: StatusCard["mediaKind"];
        text_body: string | null;
        background: string | null;
        created_at: string;
        expires_at: string;
        audience: StatusAudience;
        view_once: boolean;
      }>`
        select id, author_id, media_url, media_kind, text_body, background, created_at, expires_at,
               coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once
        from statuses where id = ${data.id} and expires_at > now()
      `).map((row) => ({ ...row, reshare_of_id: null, original_author_id: null })),
    );
    if (!row[0]) throw new Error("Status expired.");
    const r = row[0];
    const rel = await getRelation(sql, context.userId, r.author_id);
    const listed = await audienceFor(sql, r.id, r.audience);
    if (!canViewStatus(rel, r.audience, listed, context.userId)) {
      throw new Error("This status is not available.");
    }
    const authors = await loadAuthors(
      sql,
      [r.author_id, r.original_author_id].filter((x): x is string => Boolean(x)),
    );
    const author = authors.get(r.author_id)!;
    const orig = r.original_author_id ? authors.get(r.original_author_id) ?? null : null;
    const origRel =
      r.original_author_id && r.original_author_id !== r.author_id
        ? await getRelation(sql, context.userId, r.original_author_id)
        : rel;
    const ownerAllow = (orig ?? author).allow_status_reshare !== false;
    const reshare = canReshareStatus({
      allowReshare: ownerAllow,
      expired: false,
      viewOnce: r.view_once,
      isSelf: origRel.isSelf || rel.isSelf,
      isBlocked: origRel.isBlocked || rel.isBlocked,
      isBlockedBy: origRel.isBlockedBy || rel.isBlockedBy,
      canView: true,
    });
    const extra = {
      reshareOfId: r.reshare_of_id,
      originalAuthor: orig ? authorLite(orig) : null,
      allowReshare: reshare.ok,
    };
    if (rel.isSelf) {
      const views = await sql<{ n: number }>`
        select count(*)::int as n from status_views where status_id = ${r.id}
      `;
      return {
        id: r.id,
        author: authorLite(author),
        mediaUrl: r.media_url,
        mediaKind: r.media_kind,
        textBody: r.text_body,
        background: r.background,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        seen: false,
        viewerCount: views[0]?.n ?? 0,
        audience: r.audience,
        viewOnce: r.view_once,
        opened: false,
        ...extra,
      } satisfies StatusCard;
    }
    if (r.view_once) {
      const inserted = await sql<{ status_id: string }>`
        insert into status_views (status_id, user_id) values (${r.id}, ${context.userId})
        on conflict do nothing
        returning status_id
      `;
      if (!inserted[0]) {
        return {
          id: r.id,
          author: authorLite(author),
          mediaUrl: null,
          mediaKind: r.media_kind,
          textBody: r.text_body,
          background: r.background,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          seen: true,
          viewerCount: 0,
          audience: r.audience,
          viewOnce: true,
          opened: true,
          ...extra,
        } satisfies StatusCard;
      }
      return {
        id: r.id,
        author: authorLite(author),
        mediaUrl: r.media_url,
        mediaKind: r.media_kind,
        textBody: r.text_body,
        background: r.background,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        seen: true,
        viewerCount: 0,
        audience: r.audience,
        viewOnce: true,
        opened: true,
        ...extra,
      } satisfies StatusCard;
    }
    await sql`
      insert into status_views (status_id, user_id) values (${r.id}, ${context.userId})
      on conflict do nothing
    `;
    return {
      id: r.id,
      author: authorLite(author),
      mediaUrl: r.media_url,
      mediaKind: r.media_kind,
      textBody: r.text_body,
      background: r.background,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      seen: true,
      viewerCount: 0,
      audience: r.audience,
      viewOnce: false,
      opened: false,
      ...extra,
    } satisfies StatusCard;
  });

export const viewStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ author_id: string; audience: StatusAudience; view_once: boolean }>`
      select author_id, coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once
      from statuses where id = ${data.id} and expires_at > now()
    `;
    if (!row[0]) throw new Error("Status expired.");
    const rel = await getRelation(sql, context.userId, row[0].author_id);
    const listed = await audienceFor(sql, data.id, row[0].audience);
    if (!canViewStatus(rel, row[0].audience, listed, context.userId)) {
      throw new Error("This status is not available.");
    }
    if (row[0].view_once && !rel.isSelf) {
      return getStatus({ data: { id: data.id } });
    }
    await sql`
      insert into status_views (status_id, user_id) values (${data.id}, ${context.userId})
      on conflict do nothing
    `;
    return { ok: true as const };
  });

export const reactStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string; emoji: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "react");
    const emoji = data.emoji.slice(0, 8);
    const row = await sql<{
      author_id: string;
      text_body: string | null;
      media_kind: string;
      audience: StatusAudience;
    }>`
      select author_id, text_body, media_kind, coalesce(audience, 'friends') as audience
      from statuses where id = ${data.id} and expires_at > now()
    `;
    if (!row[0]) throw new Error("Status expired.");
    if (row[0].author_id === context.userId) throw new Error("You cannot react to your own status.");
    const rel = await getRelation(sql, context.userId, row[0].author_id);
    const listed = await audienceFor(sql, data.id, row[0].audience);
    if (!canViewStatus(rel, row[0].audience, listed, context.userId)) {
      throw new Error("This status is not available.");
    }
    await sql`
      insert into status_reactions (status_id, user_id, emoji)
      values (${data.id}, ${context.userId}, ${emoji})
      on conflict (status_id, user_id) do update set emoji = excluded.emoji
    `;
    const cid = await ensureDm(sql, context.userId, row[0].author_id);
    const preview = row[0].text_body?.slice(0, 40) || row[0].media_kind;
    await sql`
      insert into messages (id, conversation_id, sender_id, kind, body)
      values (
        ${newId("m")},
        ${cid},
        ${context.userId},
        'text',
        ${`reacted ${emoji} to your status: ${preview}`}
      )
    `;
    await sql`
      update conversations set last_message_at = now(), last_message_body = ${`${me.display_name} reacted ${emoji}`}
      where id = ${cid}
    `;
    await notify(sql, {
      userId: row[0].author_id,
      kind: "status_react",
      body: `${me.display_name} reacted ${emoji} to your status`,
      actorId: me.user_id,
      entityId: cid,
      prefKey: "stories",
    });
    return { ok: true as const };
  });

export const replyStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "message");
    const body = data.body.trim().slice(0, 280);
    if (!body) throw new Error("Write a reply.");
    const row = await sql<{ author_id: string; audience: StatusAudience }>`
      select author_id, coalesce(audience, 'friends') as audience
      from statuses where id = ${data.id} and expires_at > now()
    `;
    if (!row[0]) throw new Error("Status expired.");
    const rel = await getRelation(sql, context.userId, row[0].author_id);
    const listed = await audienceFor(sql, data.id, row[0].audience);
    if (!canViewStatus(rel, row[0].audience, listed, context.userId)) {
      throw new Error("This status is not available.");
    }
    const cid = await ensureDm(sql, context.userId, row[0].author_id);
    await sql`
      insert into messages (id, conversation_id, sender_id, kind, body)
      values (${newId("m")}, ${cid}, ${context.userId}, 'text', ${`Status reply: ${body}`})
    `;
    await sql`
      update conversations set last_message_at = now(), last_message_body = ${body.slice(0, 80)}
      where id = ${cid}
    `;
    await notify(sql, {
      userId: row[0].author_id,
      kind: "status_reply",
      body: `${me.display_name} replied to your status`,
      actorId: me.user_id,
      entityId: cid,
      prefKey: "stories",
    });
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "comment",
      targetId: data.id,
      text: body,
      username: me.username,
    }).catch(() => {});
    return { conversationId: cid };
  });

export const statusViewers = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from statuses where id = ${data.id} and author_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Status not found.");
    const rows = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }>`
      select p.user_id, p.username, p.display_name, p.avatar_url
      from status_views v join profiles p on p.user_id = v.user_id
      where v.status_id = ${data.id}
      order by v.created_at desc
    `;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
    }));
  });

export const reshareStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string; textBody?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "status");
    const row = await sql<{
      id: string;
      author_id: string;
      media_url: string | null;
      media_kind: StatusCard["mediaKind"];
      text_body: string | null;
      background: string | null;
      audience: StatusAudience;
      view_once: boolean;
      reshare_of_id: string | null;
      original_author_id: string | null;
    }>`
      select id, author_id, media_url, media_kind, text_body, background,
             coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once,
             reshare_of_id, original_author_id
      from statuses where id = ${data.id} and expires_at > now()
    `.catch(async () =>
      (await sql<{
        id: string;
        author_id: string;
        media_url: string | null;
        media_kind: StatusCard["mediaKind"];
        text_body: string | null;
        background: string | null;
        audience: StatusAudience;
        view_once: boolean;
      }>`
        select id, author_id, media_url, media_kind, text_body, background,
               coalesce(audience, 'friends') as audience, coalesce(view_once, false) as view_once
        from statuses where id = ${data.id} and expires_at > now()
      `).map((r) => ({ ...r, reshare_of_id: null, original_author_id: null })),
    );
    if (!row[0]) throw new Error("This status expired.");
    const src = row[0];
    const originalAuthorId = src.original_author_id || src.author_id;
    const orig = await sql<{
      user_id: string;
      allow_status_reshare: boolean | null;
      display_name: string;
    }>`
      select user_id, allow_status_reshare, display_name from profiles where user_id = ${originalAuthorId} limit 1
    `.catch(async () =>
      (await sql<{ user_id: string; display_name: string }>`
        select user_id, display_name from profiles where user_id = ${originalAuthorId} limit 1
      `).map((p) => ({ ...p, allow_status_reshare: true })),
    );
    if (!orig[0]) throw new Error("This status isn’t available.");
    const rel = await getRelation(sql, context.userId, src.author_id);
    const origRel =
      originalAuthorId === src.author_id ? rel : await getRelation(sql, context.userId, originalAuthorId);
    const listed = await audienceFor(sql, src.id, src.audience);
    const canView = canViewStatus(rel, src.audience, listed, context.userId);
    const check = canReshareStatus({
      allowReshare: orig[0].allow_status_reshare !== false,
      expired: false,
      viewOnce: src.view_once,
      isSelf: origRel.isSelf,
      isBlocked: origRel.isBlocked || rel.isBlocked,
      isBlockedBy: origRel.isBlockedBy || rel.isBlockedBy,
      canView,
    });
    if (!check.ok) throw new Error(check.reason);
    const n = await sql<{ n: number }>`
      select count(*)::int as n from statuses where author_id = ${context.userId} and expires_at > now()
    `;
    if ((n[0]?.n ?? 0) >= ACTIVE_LIMIT) {
      throw new Error("You already have 100 active statuses. Wait for older ones to expire.");
    }
    const audience: StatusAudience = (me.status_privacy as StatusAudience) ?? "friends";
    const id = newId("ss");
    const caption = (data.textBody ?? src.text_body ?? "").slice(0, 280);
    await sql`
      insert into statuses (
        id, author_id, media_url, media_kind, text_body, background, expires_at, audience, view_once,
        reshare_of_id, original_author_id
      )
      values (
        ${id}, ${context.userId}, ${src.media_url}, ${src.media_kind}, ${caption},
        ${src.background ?? "#1e1b4b"}, now() + interval '24 hours', ${audience}, false,
        ${src.id}, ${originalAuthorId}
      )
    `;
    await bumpScore(sql, context.userId, 1);
    await notify(sql, {
      userId: originalAuthorId,
      kind: "status",
      body: `${me.display_name} reshared your status`,
      actorId: me.user_id,
      entityId: id,
      prefKey: "stories",
    });
    return { id };
  });
