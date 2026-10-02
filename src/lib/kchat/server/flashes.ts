import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { canMessage } from "../privacy";
import { takeToken, rateError } from "../rate-limit";
import {
  assertNotBanned,
  authorLite,
  bumpScore,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";
import { ensureDm } from "./messages";

export const sendFlash = createServerFn({ method: "POST" })
  .validator((d: {
    mediaUrl: string;
    mediaKind: "photo" | "video";
    caption?: string;
    filterName?: string;
    durationSec?: number;
    usernames: string[];
    keepMemory?: boolean;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`flash:${context.userId}`, 30, 60_000);
    if (wait) throw new Error(rateError(wait));
    if (!data.mediaUrl) throw new Error("Capture something first.");
    const id = newId("fl");
    const duration = Math.min(10, Math.max(3, data.durationSec ?? 5));
    await sql`
      insert into flashes (id, author_id, media_url, media_kind, caption, filter_name, duration_sec)
      values (
        ${id}, ${context.userId}, ${data.mediaUrl}, ${data.mediaKind},
        ${(data.caption ?? "").slice(0, 120)}, ${data.filterName ?? "none"}, ${duration}
      )
    `;
    const unique = [...new Set(data.usernames.map((u) => u.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    let sent = 0;
    for (const name of unique) {
      const p = await getProfileByUsername(sql, name);
      if (!p || p.user_id === context.userId || p.is_banned) continue;
      const rel = await getRelation(sql, context.userId, p.user_id);
      if (!canMessage(rel, p.who_can_message)) continue;
      const dmId = await ensureDm(sql, context.userId, p.user_id);
      await sql`
        insert into flash_sends (flash_id, recipient_id, conversation_id)
        values (${id}, ${p.user_id}, ${dmId})
        on conflict do nothing
      `;
      await sql`
        insert into messages (id, conversation_id, sender_id, kind, body, media_url)
        values (${newId("m")}, ${dmId}, ${context.userId}, 'flash', ${id}, ${null})
      `;
      await sql`
        update conversations set last_message_at = now(), last_message_body = ${"Flash"}
        where id = ${dmId}
      `;
      await notify(sql, {
        userId: p.user_id,
        kind: "flash",
        body: `${me.display_name} sent you a Flash`,
        actorId: me.user_id,
        entityId: id,
        prefKey: "stories",
      });
      sent += 1;
    }
    if (data.keepMemory) {
      await sql`
        insert into memories (id, user_id, media_url, media_kind, caption)
        values (${newId("mm")}, ${context.userId}, ${data.mediaUrl}, ${data.mediaKind}, ${(data.caption ?? "").slice(0, 120)})
      `;
    }
    await bumpScore(sql, context.userId, 2 + sent);
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "flash",
      targetId: id,
      text: data.caption ?? "",
      username: me.username,
    }).catch(() => {});
    return { id, sent };
  });

export const openFlash = createServerFn({ method: "POST" })
  .validator((d: { flashId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      author_id: string;
      media_url: string;
      media_kind: "photo" | "video";
      caption: string;
      filter_name: string;
      duration_sec: number;
      opened_at: string | null;
    }>`
      select f.id, f.author_id, f.media_url, f.media_kind, f.caption, f.filter_name, f.duration_sec, s.opened_at
      from flashes f
      join flash_sends s on s.flash_id = f.id
      where f.id = ${data.flashId} and s.recipient_id = ${context.userId}
        and f.expires_at > now()
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("This Flash is gone.");
    if (row.opened_at) throw new Error("Already opened — Flashes play once.");
    await sql`
      update flash_sends set opened_at = now()
      where flash_id = ${data.flashId} and recipient_id = ${context.userId}
    `;
    await bumpScore(sql, context.userId, 1);
    const author = await getProfile(sql, row.author_id);
    return {
      id: row.id,
      mediaUrl: row.media_url,
      mediaKind: row.media_kind,
      caption: row.caption,
      filterName: row.filter_name,
      durationSec: row.duration_sec,
      author: author ? authorLite(author) : { userId: row.author_id, username: "user", displayName: "Someone", avatarUrl: null, verifyKind: "none" as const, isArc: false },
    };
  });

export const peekFlash = createServerFn({ method: "GET" })
  .validator((d: { flashId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      author_id: string;
      caption: string;
      media_kind: string;
      expires_at: string;
    }>`
      select id, author_id, caption, media_kind, expires_at
      from flashes where id = ${data.flashId} limit 1
    `;
    const row = rows[0];
    if (!row) return { role: "none" as const };
    const expired = new Date(row.expires_at).getTime() < Date.now();
    if (row.author_id === context.userId) {
      return { role: "author" as const, expired, caption: row.caption, mediaKind: row.media_kind };
    }
    const send = await sql<{ opened_at: string | null }>`
      select opened_at from flash_sends
      where flash_id = ${data.flashId} and recipient_id = ${context.userId}
      limit 1
    `;
    if (!send[0]) return { role: "none" as const };
    return {
      role: "recipient" as const,
      opened: Boolean(send[0].opened_at),
      expired,
    };
  });

export const listMemories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    return sql<{ id: string; media_url: string; media_kind: string; caption: string; created_at: string }>`
      select id, media_url, media_kind, caption, created_at
      from memories where user_id = ${context.userId}
      order by created_at desc limit 80
    `;
  });

export const saveMemory = createServerFn({ method: "POST" })
  .validator((d: { mediaUrl: string; mediaKind?: string; caption?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      insert into memories (id, user_id, media_url, media_kind, caption)
      values (${newId("mm")}, ${context.userId}, ${data.mediaUrl}, ${data.mediaKind ?? "photo"}, ${(data.caption ?? "").slice(0, 120)})
    `;
    return { ok: true as const };
  });

export const pingAtlas = createServerFn({ method: "POST" })
  .validator((d: { lat: number; lng: number; ghost?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const lat = Math.max(-90, Math.min(90, data.lat));
    const lng = Math.max(-180, Math.min(180, data.lng));
    if (typeof data.ghost === "boolean") {
      await sql`update profiles set ghost_mode = ${data.ghost} where user_id = ${context.userId}`;
    }
    await sql`
      update profiles set last_lat = ${lat}, last_lng = ${lng}, last_geo_at = now()
      where user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const setGhost = createServerFn({ method: "POST" })
  .validator((d: { ghost: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`update profiles set ghost_mode = ${data.ghost} where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const atlasFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const rows = await sql<{
      user_id: string;
      last_lat: number;
      last_lng: number;
      last_geo_at: string;
    }>`
      select p.user_id, p.last_lat, p.last_lng, p.last_geo_at
      from friendships f
      join profiles p on p.user_id = case when f.user_a = ${context.userId} then f.user_b else f.user_a end
      where (f.user_a = ${context.userId} or f.user_b = ${context.userId})
        and p.ghost_mode = false
        and p.last_lat is not null and p.last_lng is not null
        and p.last_geo_at > now() - interval '24 hours'
        and p.is_banned = false
    `;
    const authors = await loadAuthors(sql, rows.map((r) => r.user_id));
    return {
      me: {
        ghost: me.ghost_mode !== false,
        lat: me.last_lat,
        lng: me.last_lng,
      },
      friends: rows
        .map((r) => {
          const a = authors.get(r.user_id);
          if (!a) return null;
          return {
            ...authorLite(a),
            lat: r.last_lat,
            lng: r.last_lng,
            at: r.last_geo_at,
          };
        })
        .filter(Boolean),
    };
  });
