import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { clampHeartBurst } from "../live-session";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { extractMentions } from "../usernames";
import {
  assertNotBanned,
  authorLite,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";

type AnyRow = Record<string, unknown>;

async function assertWatching(sql: Awaited<ReturnType<typeof sqlClient>>, streamId: string, userId: string) {
  const rows = await sql<AnyRow>`select id, host_id, status, room_code, started_at from live_streams where id = ${streamId} limit 1`;
  const live = rows[0];
  if (!live) throw new Error("Stream not found.");
  if (String(live.status) !== "live") throw new Error("This live has ended.");
  const banned = await sql<{ n: number }>`
    select count(*)::int as n from live_bans where stream_id = ${streamId} and user_id = ${userId}
  `;
  if ((banned[0]?.n ?? 0) > 0) throw new Error("You were removed from this stream.");
  return live;
}

async function sweepHost(sql: Awaited<ReturnType<typeof sqlClient>>, streamId?: string) {
  try {
    if (streamId) {
      await sql`
        update live_streams s
        set status = 'failed', ended_at = now(), fail_reason = 'host disconnected'
        where s.id = ${streamId} and s.status = 'live'
          and s.started_at < now() - interval '90 seconds'
          and not exists (
            select 1 from live_presence p
            where p.stream_id = s.id and p.user_id = s.host_id
              and p.last_seen > now() - interval '45 seconds'
          )
      `;
    } else {
      await sql`
        update live_streams s
        set status = 'failed', ended_at = now(), fail_reason = 'host disconnected'
        where s.status = 'live'
          and s.started_at < now() - interval '90 seconds'
          and not exists (
            select 1 from live_presence p
            where p.stream_id = s.id and p.user_id = s.host_id
              and p.last_seen > now() - interval '45 seconds'
          )
      `;
    }
  } catch {
    /* presence table applies with 0034 */
  }
}

export async function sweepDisconnectedLives(sql: Awaited<ReturnType<typeof sqlClient>>, streamId?: string) {
  return sweepHost(sql, streamId);
}

export const listLiveHosts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await sqlClient();
    await sweepHost(sql);
    const rows = await sql<{ id: string; host_id: string }>`
      select id, host_id from live_streams where status = 'live' order by started_at desc limit 40
    `;
    return rows.map((r) => ({ userId: r.host_id, streamId: r.id }));
  });

export const liveForUser = createServerFn({ method: "GET" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ data }) => {
    const sql = await sqlClient();
    const name = data.username.trim().replace(/^@/, "").toLowerCase();
    if (!name) return { streamId: null as string | null };
    const rows = await sql<{ id: string }>`
      select s.id from live_streams s
      join profiles p on p.user_id = s.host_id
      where p.username_lc = ${name} and s.status = 'live'
      limit 1
    `;
    return { streamId: rows[0]?.id ?? null };
  });

export const heartbeatLive = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    await sweepHost(sql, data.id);
    const live = await assertWatching(sql, data.id, context.userId);
    await sql`
      insert into live_presence (stream_id, user_id, last_seen)
      values (${data.id}, ${context.userId}, now())
      on conflict (stream_id, user_id) do update set last_seen = now()
    `;
    await sql`
      delete from live_presence
      where stream_id = ${data.id} and last_seen < now() - interval '25 seconds'
    `;
    const counted = await sql<{ n: number }>`
      select count(*)::int as n from live_presence where stream_id = ${data.id}
    `;
    const viewers = counted[0]?.n ?? 0;
    await sql`
      update live_streams set viewer_peak = greatest(viewer_peak, ${viewers})
      where id = ${data.id} and status = 'live'
    `;
    const hearts = await sql<{ count: number }>`
      select count from live_reaction_totals where stream_id = ${data.id} and kind = 'heart'
    `.catch(() => [] as { count: number }[]);
    const comments = await sql<AnyRow>`
      select id, user_id, body, created_at, sticker_id from live_comments
      where stream_id = ${data.id} order by created_at desc limit 40
    `.catch(async () =>
      sql<AnyRow>`
        select id, user_id, body, created_at from live_comments
        where stream_id = ${data.id} order by created_at desc limit 40
      `,
    );
    const authors = await loadAuthors(sql, comments.map((c) => String(c.user_id)));
    const { stickerViews } = await import("./stickers");
    const stickers = await stickerViews(
      sql,
      comments.map((c) => (c.sticker_id ? String(c.sticker_id) : null)),
    );
    return {
      status: "live" as const,
      viewers,
      hearts: Number(hearts[0]?.count ?? 0),
      startedAt: String(live.started_at ?? ""),
      isHost: String(live.host_id) === context.userId,
      comments: comments.reverse().map((c) => ({
        id: String(c.id),
        body: String(c.body ?? ""),
        createdAt: String(c.created_at ?? ""),
        userId: String(c.user_id),
        sticker: c.sticker_id ? stickers.get(String(c.sticker_id)) ?? null : null,
        author: authors.get(String(c.user_id))
          ? authorLite(authors.get(String(c.user_id))!)
          : {
              userId: String(c.user_id),
              username: "",
              displayName: "Viewer",
              avatarUrl: null,
              verifyKind: "none" as const,
              isArc: false,
              isPremium: false,
            },
      })),
    };
  });

export const failLive = createServerFn({ method: "POST" })
  .validator((d: { id: string; reason?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const reason = (data.reason ?? "stream failed").slice(0, 120);
    await sql`
      update live_streams
      set status = 'failed', ended_at = now(), fail_reason = ${reason}
      where id = ${data.id} and host_id = ${context.userId} and status = 'live'
    `;
    await sql`delete from live_presence where stream_id = ${data.id}`.catch(() => undefined);
    return { ok: true as const };
  });

export const leaveLive = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from live_presence where stream_id = ${data.id} and user_id = ${context.userId}`.catch(() => undefined);
    return { ok: true as const };
  });

export const bumpLiveHearts = createServerFn({ method: "POST" })
  .validator((d: { id: string; n: number }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const n = clampHeartBurst(data.n);
    if (n < 1) return { hearts: 0 };
    const sql = await sqlClient();
    const wait = takeToken(`live-heart:${context.userId}`, 12, 10_000);
    if (wait) throw new Error(rateError(wait));
    await assertWatching(sql, data.id, context.userId);
    await sql`
      insert into live_reaction_totals (stream_id, kind, count)
      values (${data.id}, 'heart', ${n})
      on conflict (stream_id, kind) do update
        set count = live_reaction_totals.count + ${n}, updated_at = now()
    `;
    await sql`
      update live_streams set like_count = like_count + ${n} where id = ${data.id}
    `.catch(() => undefined);
    const rows = await sql<{ count: number }>`
      select count from live_reaction_totals where stream_id = ${data.id} and kind = 'heart'
    `;
    return { hearts: Number(rows[0]?.count ?? n) };
  });

export const inviteToLive = createServerFn({ method: "POST" })
  .validator((d: { streamId: string; username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`live-invite:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const me = await ensureProfile(sql, { id: context.userId });
    const live = await assertWatching(sql, data.streamId, context.userId);
    if (String(live.host_id) !== context.userId) throw new Error("Only the host can invite.");
    const target = await getProfileByUsername(sql, data.username);
    if (!target || target.is_banned) throw new Error("That person is not on NYX.");
    if (target.user_id === context.userId) throw new Error("You are already the host.");
    const id = newId("li");
    await sql`
      insert into live_invites (id, stream_id, from_user_id, to_user_id, status)
      values (${id}, ${data.streamId}, ${context.userId}, ${target.user_id}, 'pending')
      on conflict (stream_id, to_user_id) do update
        set status = 'pending', from_user_id = ${context.userId}, created_at = now()
    `;
    await notify(sql, {
      userId: target.user_id,
      kind: "live_invite",
      body: `${me.display_name} invited you to their live`,
      actorId: me.user_id,
      entityId: data.streamId,
    });
    return { ok: true as const };
  });

export const respondLiveInvite = createServerFn({ method: "POST" })
  .validator((d: { streamId: string; accept: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const rows = await sql<{ id: string; from_user_id: string; status: string }>`
      select id, from_user_id, status from live_invites
      where stream_id = ${data.streamId} and to_user_id = ${context.userId}
      order by created_at desc limit 1
    `;
    const invite = rows[0];
    if (!invite || invite.status !== "pending") throw new Error("That invite is no longer open.");
    const next = data.accept ? "accepted" : "declined";
    await sql`update live_invites set status = ${next} where id = ${invite.id}`;
    if (data.accept) {
      const live = await sql<{ status: string }>`select status from live_streams where id = ${data.streamId}`;
      if (live[0]?.status !== "live") throw new Error("This live has ended.");
      await sql`
        insert into live_speakers (stream_id, user_id, role)
        values (${data.streamId}, ${context.userId}, 'invited')
        on conflict (stream_id, user_id) do update set role = 'invited', updated_at = now()
        where live_speakers.role in ('listener', 'requested', 'invited')
      `;
    }
    const host = await getProfile(sql, invite.from_user_id);
    if (host) {
      await notify(sql, {
        userId: host.user_id,
        kind: "live_invite",
        body: data.accept
          ? `${me.display_name} joined your live as a guest`
          : `${me.display_name} declined your live invite`,
        actorId: me.user_id,
        entityId: data.streamId,
      });
    }
    return { ok: true as const, status: next };
  });

/** Promote an invited viewer to a guest. The host already approved the invite. */
export const claimGuestSeat = createServerFn({ method: "POST" })
  .validator((d: { streamId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const live = await sql<{ host_id: string; status: string; max_guests?: number }>`
      select host_id, status, max_guests from live_streams where id = ${data.streamId}
    `.catch(async () =>
      sql<{ host_id: string; status: string }>`
        select host_id, status from live_streams where id = ${data.streamId}
      `,
    );
    if (!live[0] || live[0].status !== "live") throw new Error("This live has ended.");
    if (live[0].host_id === context.userId) return { role: "host" as const };
    const banned = await sql<{ n: number }>`
      select count(*)::int as n from live_bans where stream_id = ${data.streamId} and user_id = ${context.userId}
    `;
    if ((banned[0]?.n ?? 0) > 0) throw new Error("You were removed from this live.");
    const seat = await sql<{ role: string }>`
      select role from live_speakers where stream_id = ${data.streamId} and user_id = ${context.userId}
    `;
    if (seat[0]?.role === "speaker" || seat[0]?.role === "cohost") return { role: seat[0].role as "speaker" | "cohost" };
    if (seat[0]?.role !== "invited") throw new Error("The host has not invited you onto this live.");
    const row = live[0] as { max_guests?: number };
    const maxGuests = Math.max(1, Number(row.max_guests ?? 4) || 4);
    const seated = await sql<{ n: number }>`
      select count(*)::int as n from live_speakers
      where stream_id = ${data.streamId} and role in ('speaker', 'cohost')
    `;
    if ((seated[0]?.n ?? 0) >= maxGuests) throw new Error("This live is full.");
    await sql`
      update live_speakers set role = 'speaker', updated_at = now()
      where stream_id = ${data.streamId} and user_id = ${context.userId} and role = 'invited'
    `;
    await notify(sql, {
      userId: live[0].host_id,
      kind: "live_invite",
      body: `${me.display_name} joined your live`,
      actorId: me.user_id,
      entityId: data.streamId,
    });
    return { role: "speaker" as const };
  });

export const leaveGuestSeat = createServerFn({ method: "POST" })
  .validator((d: { streamId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      update live_speakers set role = 'listener', updated_at = now()
      where stream_id = ${data.streamId}
        and user_id = ${context.userId}
        and role in ('speaker', 'cohost', 'requested', 'invited')
    `;
    return { ok: true as const };
  });

export async function mentionLiveWatchers(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  opts: { streamId: string; body: string; actorId: string; actorName: string; commentId: string },
) {
  const names = extractMentions(opts.body).slice(0, 8);
  const ids: string[] = [];
  for (const name of names) {
    const p = await getProfileByUsername(sql, name);
    if (!p || p.user_id === opts.actorId || p.is_banned) continue;
    ids.push(p.user_id);
    await notify(sql, {
      userId: p.user_id,
      kind: "live_mention",
      body: `${opts.actorName} mentioned you in a live`,
      actorId: opts.actorId,
      entityId: opts.streamId,
    });
  }
  if (ids.length) {
    await sql`
      update live_comments set extra_json = ${JSON.stringify({ mentions: ids })}::jsonb
      where id = ${opts.commentId}
    `.catch(() => undefined);
  }
}
