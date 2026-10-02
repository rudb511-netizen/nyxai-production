import { newId } from "../ids";
import { isResourceId, publicError } from "../public-error";
import { isBroken, pairSent } from "../streaks";
import { assertMediaRef } from "../upload-guard";
import {
  hashViewOnceToken,
  newViewOnceToken,
  viewOnceKindAllowed,
  viewOnceNotifyBody,
  VIEW_ONCE_TTL_MS,
} from "../view-once";
import {
  isMessageKind,
  isMutedAt,
  messagePreview,
  normalizeClientId,
  parseExtra,
  type MessageExtra,
} from "../comms-extra";
import { friendPair, getProfile, getRelation, notify, sqlClient } from "./helpers";
import { isArcFlag } from "../types";
import { OMNI_SUPPORT_USER_ID } from "../omni-support-ids";

type Sql = Awaited<ReturnType<typeof sqlClient>>;

export async function assertMember(sql: Sql, conversationId: string, userId: string) {
  if (!isResourceId(conversationId, "cv")) {
    throw new Error("Couldn't open this conversation. Please try again.");
  }
  const rows = await sql<{ n: number; banned_at: string | null }>`
    select count(*)::int as n, max(banned_at) as banned_at from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `.catch(async () => {
    const fallback = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${conversationId} and user_id = ${userId}
    `;
    return [{ n: fallback[0]?.n ?? 0, banned_at: null }];
  });
  if ((rows[0]?.n ?? 0) === 0) {
    const support = await sql<{ user_id: string }>`
      select user_id from conversation_members
      where conversation_id = ${conversationId} and user_id = ${OMNI_SUPPORT_USER_ID}
      limit 1
    `.catch(() => []);
    if (support[0]) {
      const me = await getProfile(sql, userId);
      if (me && isArcFlag(me)) return;
    }
    throw new Error("Couldn't open this conversation. Please try again.");
  }
  if (rows[0]?.banned_at) {
    throw new Error("You've been removed from this chat.");
  }
}

export async function applyStreak(sql: Sql, aId: string, bId: string, senderId: string) {
  const friends = await sql<{ n: number }>`
    select count(*)::int as n from friendships
    where user_a = ${friendPair(aId, bId)[0]} and user_b = ${friendPair(aId, bId)[1]}
  `;
  if ((friends[0]?.n ?? 0) === 0) return;
  const [ua, ub] = friendPair(aId, bId);
  const rows = await sql<{
    count: number;
    last_qualifying_at: string | null;
    a_sent_at: string | null;
    b_sent_at: string | null;
    freeze_until: string | null;
    icon: string;
  }>`
    select count, last_qualifying_at, a_sent_at, b_sent_at, freeze_until, icon
    from streaks where user_a = ${ua} and user_b = ${ub}
  `;
  const now = Date.now();
  let snap = {
    count: rows[0]?.count ?? 0,
    lastQualifyingAt: rows[0]?.last_qualifying_at ? new Date(rows[0].last_qualifying_at).getTime() : null,
    aSentAt: rows[0]?.a_sent_at ? new Date(rows[0].a_sent_at).getTime() : null,
    bSentAt: rows[0]?.b_sent_at ? new Date(rows[0].b_sent_at).getTime() : null,
    freezeUntil: rows[0]?.freeze_until ? new Date(rows[0].freeze_until).getTime() : null,
  };
  if (isBroken(snap, now)) {
    snap = { count: 0, lastQualifyingAt: null, aSentAt: null, bSentAt: null, freezeUntil: null };
  }
  snap = pairSent(snap, senderId === ua, now);
  const icon = rows[0]?.icon ?? "flame";
  await sql`
    insert into streaks (user_a, user_b, count, icon, last_qualifying_at, a_sent_at, b_sent_at, freeze_until)
    values (
      ${ua}, ${ub}, ${snap.count}, ${icon},
      ${snap.lastQualifyingAt ? new Date(snap.lastQualifyingAt).toISOString() : null},
      ${snap.aSentAt ? new Date(snap.aSentAt).toISOString() : null},
      ${snap.bSentAt ? new Date(snap.bSentAt).toISOString() : null},
      ${snap.freezeUntil ? new Date(snap.freezeUntil).toISOString() : null}
    )
    on conflict (user_a, user_b) do update set
      count = excluded.count,
      last_qualifying_at = excluded.last_qualifying_at,
      a_sent_at = excluded.a_sent_at,
      b_sent_at = excluded.b_sent_at,
      freeze_until = excluded.freeze_until
  `;
}

export function voicePreview(ms?: number | null): string {
  if (!ms || ms < 400) return "Voice message";
  const s = Math.max(1, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0
    ? `Voice message · ${m}:${String(r).padStart(2, "0")}`
    : `Voice message · 0:${String(r).padStart(2, "0")}`;
}

export async function memberIsMuted(sql: Sql, conversationId: string, userId: string): Promise<boolean> {
  const row = await sql<{ muted: boolean; mute_until: string | null }>`
    select muted, mute_until from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `.catch(async () => {
    const fallback = await sql<{ muted: boolean }>`
      select muted from conversation_members
      where conversation_id = ${conversationId} and user_id = ${userId}
    `;
    return [{ muted: fallback[0]?.muted ?? false, mute_until: null }];
  });
  return isMutedAt(Boolean(row[0]?.muted), row[0]?.mute_until ?? null);
}

export async function assertCanSend(sql: Sql, conversationId: string, userId: string) {
  await assertMember(sql, conversationId, userId);
  const member = await sql<{ role: string; restricted: boolean | null }>`
    select role, restricted from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `.catch(async () => {
    const fallback = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${conversationId} and user_id = ${userId}
    `;
    return [{ role: fallback[0]?.role ?? "member", restricted: false }];
  });
  if (member[0]?.restricted) {
    throw new Error("You can't send messages in this chat right now.");
  }
  const convo = await sql<{ kind: string; is_broadcast: boolean | null }>`
    select kind, is_broadcast from conversations where id = ${conversationId}
  `.catch(async () => {
    const rows = await sql<{ kind: string }>`select kind from conversations where id = ${conversationId}`;
    return rows.map((r) => ({ kind: r.kind, is_broadcast: false }));
  });
  if (convo[0]?.kind === "dm") {
    const others = await sql<{ user_id: string }>`
      select user_id from conversation_members
      where conversation_id = ${conversationId} and user_id <> ${userId}
    `;
    for (const o of others) {
      if (o.user_id === "omni_support_system" || o.user_id === "omni_ai_system") continue;
      const rel = await getRelation(sql, userId, o.user_id);
      if (rel.isBlocked) throw new Error("You blocked this person. Unblock them to message.");
      if (rel.isBlockedBy) throw new Error("You cannot message this person.");
    }
  }
  if (!convo[0]?.is_broadcast) return;
  if (member[0]?.role !== "owner" && member[0]?.role !== "admin") {
    throw new Error("Only admins can post in this channel.");
  }
}

export type DeliverInput = {
  conversationId: string;
  senderId: string;
  senderName: string;
  kind: string;
  body: string;
  mediaUrl?: string | null;
  replyToId?: string | null;
  durationMs?: number | null;
  forwardedFromId?: string | null;
  forwardedLabel?: string | null;
  viewOnce?: boolean;
  silent?: boolean;
  clientId?: string | null;
  albumId?: string | null;
  extra?: MessageExtra | null;
  topicId?: string | null;
};

export async function deliverOutgoing(sql: Sql, data: DeliverInput): Promise<{ id: string; duplicate: boolean }> {
  const kind = data.kind || "text";
  if (!isMessageKind(kind)) throw new Error("That message type isn’t allowed.");
  if (data.mediaUrl) {
    if (kind === "sticker" && /image\/svg/i.test(data.mediaUrl.slice(0, 80))) {
      data.mediaUrl = null;
    } else {
      assertMediaRef(data.mediaUrl);
    }
  }
  if (data.replyToId && !isResourceId(data.replyToId, "m")) {
    throw new Error("Couldn't send that reply.");
  }
  const extra = data.extra ?? null;
  const hasPayload =
    Boolean(data.body.trim()) ||
    Boolean(data.mediaUrl) ||
    kind === "sticker" ||
    kind === "poll" ||
    kind === "location" ||
    kind === "contact";
  if (!hasPayload) throw new Error("Message is empty.");

  const clientId = normalizeClientId(data.clientId);
  if (clientId) {
    const existing = await sql<{ id: string }>`
      select id from messages
      where conversation_id = ${data.conversationId}
        and sender_id = ${data.senderId}
        and client_id = ${clientId}
      limit 1
    `.catch(() => []);
    if (existing[0]) return { id: existing[0].id, duplicate: true };
  }

  await assertCanSend(sql, data.conversationId, data.senderId);

  const viewOnce = Boolean(data.viewOnce) && Boolean(data.mediaUrl) && viewOnceKindAllowed(kind);
  const tokenHash = viewOnce ? await hashViewOnceToken(newViewOnceToken()) : null;
  const viewOnceExpires = viewOnce ? new Date(Date.now() + VIEW_ONCE_TTL_MS).toISOString() : null;
  const convoMeta = await sql<{ disappear_sec: number }>`
    select coalesce(disappear_sec, 0)::int as disappear_sec from conversations where id = ${data.conversationId}
  `.catch(() => [{ disappear_sec: 0 }]);
  const senderCustom = await sql<{ disappearing_enabled: boolean; disappearing_duration_sec: number }>`
    select disappearing_enabled, disappearing_duration_sec from chat_customizations
    where conversation_id = ${data.conversationId} and user_id = ${data.senderId}
    limit 1
  `.catch(() => []);
  const disappearSec =
    convoMeta[0]?.disappear_sec ||
    (senderCustom[0]?.disappearing_enabled ? senderCustom[0].disappearing_duration_sec : 0);
  const chatExpires = disappearSec > 0 ? new Date(Date.now() + disappearSec * 1000).toISOString() : null;
  const id = newId("m");
  const extraJson = extra ? JSON.stringify(extra) : null;
  const silent = Boolean(data.silent);
  const albumId = data.albumId && isResourceId(data.albumId, "al") ? data.albumId : data.albumId?.startsWith("al_") ? data.albumId : null;
  const topicId = data.topicId && isResourceId(data.topicId, "tp") ? data.topicId : null;

  try {
    await sql`
      insert into messages (
        id, conversation_id, sender_id, kind, body, media_url, reply_to_id, duration_ms,
        forwarded_from_id, forwarded_label, view_once, view_once_state, view_once_token_hash,
        view_once_expires_at, expires_at, silent, client_id, album_id, extra_json, topic_id
      ) values (
        ${id}, ${data.conversationId}, ${data.senderId}, ${kind}, ${data.body}, ${data.mediaUrl ?? null},
        ${data.replyToId ?? null}, ${data.durationMs ?? null}, ${data.forwardedFromId ?? null},
        ${data.forwardedLabel ?? null}, ${viewOnce}, ${viewOnce ? "UNOPENED" : null}, ${tokenHash},
        ${viewOnceExpires}, ${chatExpires}, ${silent}, ${clientId}, ${albumId}, ${extraJson}::jsonb, ${topicId}
      )
    `;
  } catch {
    await sql`
      insert into messages (
        id, conversation_id, sender_id, kind, body, media_url, reply_to_id, duration_ms,
        forwarded_from_id, forwarded_label, view_once, view_once_state, view_once_token_hash,
        view_once_expires_at, expires_at
      ) values (
        ${id}, ${data.conversationId}, ${data.senderId}, ${kind}, ${data.body}, ${data.mediaUrl ?? null},
        ${data.replyToId ?? null}, ${data.durationMs ?? null}, ${data.forwardedFromId ?? null},
        ${data.forwardedLabel ?? null}, ${viewOnce}, ${viewOnce ? "UNOPENED" : null}, ${tokenHash},
        ${viewOnceExpires}, ${chatExpires}
      )
    `;
  }

  const { indexMessageMedia } = await import("./media-index");
  await indexMessageMedia(sql, {
    messageId: id,
    conversationId: data.conversationId,
    senderId: data.senderId,
    kind: kind === "gif" ? "image" : kind,
    body: data.body,
    mediaUrl: data.mediaUrl,
    filename: kind === "file" || kind === "audio" ? data.body : null,
    viewOnce,
    extra,
  }).catch(() => undefined);

  const preview =
    kind === "voice" && !data.body
      ? voicePreview(data.durationMs)
      : messagePreview(kind, data.body, extra, viewOnce);
  const previewKind = viewOnce ? "view_once" : kind;
  try {
    await sql`
      update conversations set last_message_at = now(), last_message_body = ${preview}, last_message_kind = ${previewKind}
      where id = ${data.conversationId}
    `;
  } catch {
    await sql`
      update conversations set last_message_at = now(), last_message_body = ${preview}
      where id = ${data.conversationId}
    `;
  }

  if (!silent) {
    const members = await sql<{ user_id: string; muted: boolean; mute_until?: string | null }>`
      select user_id, muted, mute_until from conversation_members where conversation_id = ${data.conversationId}
    `.catch(async () =>
      sql<{ user_id: string; muted: boolean }>`
        select user_id, muted from conversation_members where conversation_id = ${data.conversationId}
      `,
    );
    for (const m of members) {
      if (m.user_id === data.senderId) continue;
      if (isMutedAt(Boolean(m.muted), "mute_until" in m ? (m.mute_until as string | null) : null)) continue;
      await notify(sql, {
        userId: m.user_id,
        kind: "message",
        body: viewOnce
          ? viewOnceNotifyBody(data.senderName, kind)
          : `${data.senderName}: ${preview.slice(0, 80)}`,
        actorId: data.senderId,
        entityId: data.conversationId,
        prefKey: "messages",
      });
    }
    if (members.length === 2) {
      const other = members.find((m) => m.user_id !== data.senderId)?.user_id;
      if (other) await applyStreak(sql, data.senderId, other, data.senderId);
    }
  }

  await sql`
    delete from conversation_drafts
    where conversation_id = ${data.conversationId} and user_id = ${data.senderId}
  `.catch(() => undefined);

  return { id, duplicate: false };
}

export async function flushDueScheduled(sql: Sql, limit = 20): Promise<number> {
  const due = await sql<{
    id: string;
    conversation_id: string;
    sender_id: string;
    kind: string;
    body: string;
    media_url: string | null;
    reply_to_id: string | null;
    duration_ms: number | null;
    extra_json: unknown;
    silent: boolean;
    album_id: string | null;
    client_id: string | null;
    topic_id: string | null;
  }>`
    select id, conversation_id, sender_id, kind, body, media_url, reply_to_id, duration_ms,
           extra_json, silent, album_id, client_id, topic_id
    from scheduled_messages
    where status = 'pending' and send_at <= now()
    order by send_at asc
    limit ${limit}
  `.catch(() => []);
  let n = 0;
  for (const row of due) {
    try {
      const locked = await sql<{ id: string }>`
        update scheduled_messages set status = 'sent', updated_at = now()
        where id = ${row.id} and status = 'pending'
        returning id
      `;
      if (!locked[0]) continue;
      const sender = await getProfile(sql, row.sender_id);
      const extra = parseExtra(row.extra_json);
      const delivered = await deliverOutgoing(sql, {
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: sender?.display_name ?? "Someone",
        kind: row.kind,
        body: row.body,
        mediaUrl: row.media_url,
        replyToId: row.reply_to_id,
        durationMs: row.duration_ms,
        silent: row.silent,
        clientId: row.client_id,
        albumId: row.album_id,
        extra,
        topicId: row.topic_id,
      });
      await sql`
        update scheduled_messages set sent_message_id = ${delivered.id} where id = ${row.id}
      `;
      n += 1;
    } catch (e) {
      await sql`
        update scheduled_messages set status = 'pending', updated_at = now()
        where id = ${row.id} and status = 'sent' and sent_message_id is null
      `.catch(() => undefined);
      publicError(e, "Couldn't send a scheduled message.");
    }
  }
  return n;
}


