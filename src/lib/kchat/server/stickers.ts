import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { assertDataUrl, assertMediaRef } from "../upload-guard";
import {
  DEFAULT_INSTALLED_PACK_IDS,
  NYX_STICKER_PACKS,
  isOfficialPackId,
  stickerMarkup,
} from "../stickers";
import { isArcFlag } from "../types";
import { assertNotBanned, ensureProfile, sqlClient } from "./helpers";

const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`;
const CUSTOM_IMAGE_MAX = 700_000;
const CUSTOM_VIDEO_MAX = 2_400_000;

type Sql = Awaited<ReturnType<typeof sqlClient>>;

let seedOnce: Promise<void> | null = null;

export async function seedStickers(sql: Sql) {
  if (seedOnce) return seedOnce;
  seedOnce = seedStickersInner(sql).catch((e) => {
    seedOnce = null;
    throw e;
  });
  return seedOnce;
}

async function seedStickersInner(sql: Sql) {
  for (const pack of NYX_STICKER_PACKS) {
    const animated = pack.stickers.some((s) => s.animated);
    await sql`
      insert into sticker_packs (id, title, author_name, slug, description, category, kind, published, sticker_count, animated)
      values (
        ${pack.id}, ${pack.title}, ${pack.authorName}, ${pack.id.replace(/^pack_/, "")},
        ${pack.description}, ${pack.category}, ${"official"}, ${true}, ${pack.stickers.length}, ${animated}
      )
      on conflict (id) do update set
        title = excluded.title,
        description = excluded.description,
        category = excluded.category,
        sticker_count = excluded.sticker_count,
        animated = excluded.animated,
        kind = 'official',
        published = true
    `.catch(async () => {
      await sql`
        insert into sticker_packs (id, title, author_name)
        values (${pack.id}, ${pack.title}, ${pack.authorName})
        on conflict (id) do update set title = excluded.title
      `;
    });
    for (const [i, s] of pack.stickers.entries()) {
      const markup = stickerMarkup(s);
      const tags = s.tags.join(" ");
      await sql`
        insert into stickers (id, pack_id, emoji, svg, sort_order, name, tags, animated, media_kind, is_official)
        values (${s.id}, ${pack.id}, ${s.emoji}, ${markup}, ${i}, ${s.name}, ${tags}, ${Boolean(s.animated)}, ${"svg"}, ${true})
        on conflict (id) do update set
          svg = excluded.svg,
          emoji = excluded.emoji,
          sort_order = excluded.sort_order,
          name = excluded.name,
          tags = excluded.tags,
          animated = excluded.animated,
          is_official = true
      `.catch(async () => {
        await sql`
          insert into stickers (id, pack_id, emoji, svg, sort_order)
          values (${s.id}, ${pack.id}, ${s.emoji}, ${markup}, ${i})
          on conflict (id) do update set svg = excluded.svg, emoji = excluded.emoji, sort_order = excluded.sort_order
        `;
      });
    }
  }
}

export async function ensureDefaultPacks(sql: Sql, userId: string) {
  for (const packId of DEFAULT_INSTALLED_PACK_IDS) {
    await sql`
      insert into user_sticker_packs (user_id, pack_id)
      values (${userId}, ${packId})
      on conflict do nothing
    `.catch(() => undefined);
  }
}

export async function stickerViews(
  sql: Sql,
  ids: Array<string | null | undefined>,
): Promise<Map<string, { id: string; name: string; url: string | null; mediaKind: string; packId: string }>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, { id: string; name: string; url: string | null; mediaKind: string; packId: string }>();
  if (!unique.length) return map;
  const { findStickerById, stickerRenderUrl } = await import("../stickers");
  for (const id of unique) {
    const def = findStickerById(id);
    if (def) {
      map.set(id, {
        id,
        name: def.name,
        url: stickerRenderUrl({ packId: def.packId, stickerId: def.id }),
        mediaKind: def.animated ? "svg" : "svg",
        packId: def.packId,
      });
    }
  }
  const missing = unique.filter((id) => !map.has(id));
  if (!missing.length) return map;
  const rows = await sql.query<{
    id: string;
    name: string;
    pack_id: string;
    media_url: string | null;
    media_kind: string;
  }>(
    `select id, name, pack_id, media_url, coalesce(media_kind, 'image') as media_kind
     from stickers where id = any($1::text[])`,
    [missing],
  ).catch(() => []);
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.name,
      url: r.media_url,
      mediaKind: r.media_kind,
      packId: r.pack_id,
    });
  }
  return map;
}

function assertCustomMedia(opts: { mediaUrl: string; mediaKind: string; durationMs?: number | null }) {
  const kind = opts.mediaKind;
  if (kind !== "image" && kind !== "video" && kind !== "gif") {
    throw new Error("That sticker format isn’t supported.");
  }
  if (opts.mediaUrl.startsWith("data:image/svg")) {
    throw new Error("That file type isn’t allowed.");
  }
  const max = kind === "image" ? CUSTOM_IMAGE_MAX * 1.4 : CUSTOM_VIDEO_MAX * 1.4;
  try {
    assertMediaRef(opts.mediaUrl, max);
  } catch {
    assertDataUrl(opts.mediaUrl, max);
  }
  if (kind === "video" || kind === "gif") {
    const dur = opts.durationMs ?? 0;
    if (dur > 4000) throw new Error("Keep animated stickers under 3 seconds.");
  }
}

export const createStickerPack = createServerFn({ method: "POST" })
  .validator((d: { title: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`sticker-pack:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const title = data.title.trim().slice(0, 40);
    if (title.length < 2) throw new Error("Give the pack a name.");
    const id = newId("pk");
    await sql`
      insert into sticker_packs (id, title, author_name, slug, description, category, kind, published, creator_id, sticker_count)
      values (${id}, ${title}, ${me.display_name}, ${id}, ${""}, ${"custom"}, ${"custom"}, ${false}, ${context.userId}, ${0})
    `;
    await sql`
      insert into user_sticker_packs (user_id, pack_id)
      values (${context.userId}, ${id})
      on conflict do nothing
    `;
    return { id, title };
  });

export const renameStickerPack = createServerFn({ method: "POST" })
  .validator((d: { packId: string; title: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (isOfficialPackId(data.packId)) throw new Error("Official packs can’t be renamed.");
    const title = data.title.trim().slice(0, 40);
    if (title.length < 2) throw new Error("Give the pack a name.");
    const row = await sql<{ id: string }>`
      select id from sticker_packs where id = ${data.packId} and creator_id = ${context.userId} and kind = 'custom'
    `;
    if (!row[0]) throw new Error("Pack not found.");
    await sql`update sticker_packs set title = ${title} where id = ${data.packId}`;
    return { ok: true as const, title };
  });

export const deleteStickerPack = createServerFn({ method: "POST" })
  .validator((d: { packId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (isOfficialPackId(data.packId)) throw new Error("Official packs can’t be deleted.");
    const row = await sql<{ id: string }>`
      select id from sticker_packs where id = ${data.packId} and creator_id = ${context.userId} and kind = 'custom'
    `;
    if (!row[0]) throw new Error("Pack not found.");
    await sql`update stickers set is_removed = true where pack_id = ${data.packId}`;
    await sql`delete from user_sticker_packs where pack_id = ${data.packId}`;
    await sql`update sticker_packs set published = false where id = ${data.packId}`;
    return { ok: true as const };
  });

export const addCustomSticker = createServerFn({ method: "POST" })
  .validator(
    (d: {
      packId?: string | null;
      name: string;
      mediaUrl: string;
      mediaKind: "image" | "video" | "gif";
      thumbUrl?: string | null;
      width?: number | null;
      height?: number | null;
      durationMs?: number | null;
      tags?: string;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`sticker-add:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    assertCustomMedia({ mediaUrl: data.mediaUrl, mediaKind: data.mediaKind, durationMs: data.durationMs });
    const name = data.name.trim().slice(0, 48) || "Custom sticker";
    let packId = data.packId ?? null;
    if (packId) {
      if (isOfficialPackId(packId)) throw new Error("Add custom stickers to your own pack.");
      const own = await sql<{ id: string }>`
        select id from sticker_packs where id = ${packId} and creator_id = ${context.userId}
      `;
      if (!own[0]) throw new Error("Pack not found.");
    } else {
      const existing = await sql<{ id: string }>`
        select id from sticker_packs
        where creator_id = ${context.userId} and kind = 'custom'
        order by created_at asc
        limit 1
      `;
      if (existing[0]) packId = existing[0].id;
      else {
        packId = newId("pk");
        await sql`
          insert into sticker_packs (id, title, author_name, slug, description, category, kind, published, creator_id, sticker_count)
          values (${packId}, ${"My Stickers"}, ${me.display_name}, ${packId}, ${""}, ${"custom"}, ${"custom"}, ${false}, ${context.userId}, ${0})
        `;
        await sql`
          insert into user_sticker_packs (user_id, pack_id)
          values (${context.userId}, ${packId})
          on conflict do nothing
        `;
      }
    }
    const count = await sql<{ n: number }>`
      select count(*)::int as n from stickers where pack_id = ${packId} and coalesce(is_removed, false) = false
    `;
    if ((count[0]?.n ?? 0) >= 80) throw new Error("This pack is full (80 stickers).");
    const id = newId("st");
    const tags = (data.tags ?? name).slice(0, 160);
    await sql`
      insert into stickers (
        id, pack_id, emoji, svg, sort_order, name, tags, animated, media_url, thumb_url,
        media_kind, created_by, is_official, width, height, duration_ms
      ) values (
        ${id}, ${packId}, ${name.slice(0, 2)}, ${EMPTY_SVG}, ${count[0]?.n ?? 0}, ${name}, ${tags},
        ${data.mediaKind === "video" || data.mediaKind === "gif"}, ${data.mediaUrl}, ${data.thumbUrl ?? null},
        ${data.mediaKind}, ${context.userId}, ${false}, ${data.width ?? null}, ${data.height ?? null}, ${data.durationMs ?? null}
      )
    `;
    await sql`
      update sticker_packs set sticker_count = sticker_count + 1, animated = animated or ${data.mediaKind === "video" || data.mediaKind === "gif"}
      where id = ${packId}
    `.catch(() => undefined);
    await sql`
      insert into user_sticker_packs (user_id, pack_id)
      values (${context.userId}, ${packId})
      on conflict do nothing
    `;
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "sticker",
      targetId: id,
      text: name,
      username: me.username,
    }).catch(() => {});
    return { id, packId, name };
  });

export const deleteCustomSticker = createServerFn({ method: "POST" })
  .validator((d: { stickerId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const row = await sql<{ id: string; created_by: string | null; pack_id: string; is_official: boolean }>`
      select id, created_by, pack_id, coalesce(is_official, false) as is_official
      from stickers where id = ${data.stickerId}
    `;
    if (!row[0]) throw new Error("Sticker not found.");
    if (row[0].is_official) throw new Error("Official stickers can’t be deleted.");
    const pack = await sql<{ creator_id: string | null }>`
      select creator_id from sticker_packs where id = ${row[0].pack_id}
    `;
    const owner = row[0].created_by === context.userId || pack[0]?.creator_id === context.userId;
    if (!owner && !isArcFlag(me)) throw new Error("You can only delete your own stickers.");
    await sql`update stickers set is_removed = true where id = ${data.stickerId}`;
    await sql`
      delete from sticker_favorites where sticker_id = ${data.stickerId}
    `.catch(() => undefined);
    await sql`
      update sticker_packs set sticker_count = greatest(sticker_count - 1, 0) where id = ${row[0].pack_id}
    `.catch(() => undefined);
    return { ok: true as const };
  });

export const reportSticker = createServerFn({ method: "POST" })
  .validator((d: { stickerId: string; reason: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`sticker-report:${context.userId}`, 8, 3_600_000);
    if (wait) throw new Error(rateError(wait));
    const row = await sql<{ id: string }>`select id from stickers where id = ${data.stickerId}`;
    if (!row[0]) throw new Error("Sticker not found.");
    await sql`
      insert into sticker_reports (id, sticker_id, reporter_id, reason)
      values (${newId("sr")}, ${data.stickerId}, ${context.userId}, ${data.reason.slice(0, 280)})
    `;
    return { ok: true as const };
  });

export const exportStickerPack = createServerFn({ method: "GET" })
  .validator((d: { packId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await seedStickers(sql).catch(() => undefined);
    const pack = await sql<{
      id: string;
      title: string;
      author_name: string;
      kind: string;
      description: string;
    }>`
      select id, title, author_name, coalesce(kind, 'official') as kind, coalesce(description, '') as description
      from sticker_packs where id = ${data.packId}
    `;
    if (!pack[0]) throw new Error("Pack not found.");
    const installed = await sql<{ n: number }>`
      select count(*)::int as n from user_sticker_packs
      where user_id = ${context.userId} and pack_id = ${data.packId}
    `;
    if ((installed[0]?.n ?? 0) === 0 && pack[0].kind !== "official") {
      throw new Error("Download this pack first.");
    }
    const stickers = await sql<{
      id: string;
      name: string;
      emoji: string;
      media_url: string | null;
      media_kind: string;
      animated: boolean;
    }>`
      select id, name, emoji, media_url, coalesce(media_kind, 'svg') as media_kind, coalesce(animated, false) as animated
      from stickers
      where pack_id = ${data.packId} and coalesce(is_removed, false) = false
      order by sort_order
    `;
    return {
      v: 1 as const,
      packId: pack[0].id,
      title: pack[0].title,
      authorName: pack[0].author_name,
      kind: pack[0].kind,
      description: pack[0].description,
      stickers: stickers.map((s) => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        mediaKind: s.media_kind,
        animated: s.animated,
        mediaUrl: s.media_kind === "svg" ? null : s.media_url,
      })),
    };
  });

export const importStickerPack = createServerFn({ method: "POST" })
  .validator((d: { payload: { title?: string; stickers?: Array<{ name?: string; mediaUrl?: string | null; mediaKind?: string }> } }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`sticker-import:${context.userId}`, 6, 60_000);
    if (wait) throw new Error(rateError(wait));
    const items = (data.payload.stickers ?? []).filter((s) => s.mediaUrl).slice(0, 40);
    if (!items.length) throw new Error("Nothing to import.");
    const title = (data.payload.title ?? "Imported pack").trim().slice(0, 40) || "Imported pack";
    const packId = newId("pk");
    await sql`
      insert into sticker_packs (id, title, author_name, slug, description, category, kind, published, creator_id, sticker_count)
      values (${packId}, ${title}, ${me.display_name}, ${packId}, ${""}, ${"custom"}, ${"custom"}, ${false}, ${context.userId}, ${items.length})
    `;
    await sql`
      insert into user_sticker_packs (user_id, pack_id) values (${context.userId}, ${packId}) on conflict do nothing
    `;
    let i = 0;
    for (const s of items) {
      const kind = s.mediaKind === "video" || s.mediaKind === "gif" ? s.mediaKind : "image";
      assertCustomMedia({ mediaUrl: s.mediaUrl!, mediaKind: kind });
      const id = newId("st");
      const name = (s.name ?? "Sticker").slice(0, 48);
      await sql`
        insert into stickers (
          id, pack_id, emoji, svg, sort_order, name, tags, animated, media_url, media_kind, created_by, is_official
        ) values (
          ${id}, ${packId}, ${name.slice(0, 2)}, ${EMPTY_SVG}, ${i}, ${name}, ${name}, ${kind !== "image"},
          ${s.mediaUrl!}, ${kind}, ${context.userId}, ${false}
        )
      `;
      i += 1;
    }
    return { id: packId, title, count: i };
  });
