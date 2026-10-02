import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { isResourceId, publicError } from "../public-error";
import {
  isMutedAt,
  muteUntilFrom,
  parseExtra,
  validateContact,
  validateLocation,
  validatePoll,
  validateScheduleAt,
  type MessageExtra,
} from "../comms-extra";
import { findSticker, stickerDataUrl } from "../stickers";
import { normalizeUsername, usernameError, validateUsername } from "../usernames";
import { extractSafeLinks } from "../link-preview";

import {
  assertNotBanned,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  loadAuthors,
  sqlClient,
  touchPresence,
} from "./helpers";
import { assertCanSend, assertMember, deliverOutgoing, flushDueScheduled } from "./chat-deliver";
import { lookupLinkPreview } from "./link-preview";
import { ensureDefaultPacks, seedStickers } from "./stickers";

async function writeAudit(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  conversationId: string,
  actorId: string,
  action: string,
  targetId?: string | null,
  meta?: unknown,
) {
  await sql`
    insert into group_audit (id, conversation_id, actor_id, action, target_id, meta_json)
    values (${newId("ga")}, ${conversationId}, ${actorId}, ${action}, ${targetId ?? null}, ${meta ? JSON.stringify(meta) : null}::jsonb)
  `.catch(() => undefined);
}

async function requireChatStaff(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  conversationId: string,
  userId: string,
  ownerOnly = false,
) {
  await assertMember(sql, conversationId, userId);
  const role = await sql<{ role: string }>`
    select role from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `;
  const r = role[0]?.role;
  if (ownerOnly) {
    if (r !== "owner") throw new Error("Only the owner can do that.");
  } else if (r !== "owner" && r !== "admin") {
    throw new Error("Only admins can do that.");
  }
  return r as "owner" | "admin" | "member";
}


export const pingInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await touchPresence(sql, context.userId).catch(() => undefined);
    const flushed = await flushDueScheduled(sql).catch(() => 0);
    return { flushed };
  });

export const saveConversationDraft = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const body = data.body.slice(0, 4000);
    if (!body.trim()) {
      await sql`
        delete from conversation_drafts
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { ok: true as const, body: "" };
    }
    await sql`
      insert into conversation_drafts (conversation_id, user_id, body, updated_at)
      values (${data.conversationId}, ${context.userId}, ${body}, now())
      on conflict (conversation_id, user_id) do update set body = excluded.body, updated_at = now()
    `;
    return { ok: true as const, body };
  });

export const getConversationDraft = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const row = await sql<{ body: string }>`
      select body from conversation_drafts
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    return { body: row[0]?.body ?? "" };
  });

export const listScheduledMessages = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    await flushDueScheduled(sql).catch(() => 0);
    const rows = await sql<{
      id: string;
      kind: string;
      body: string;
      send_at: string;
      silent: boolean;
    }>`
      select id, kind, body, send_at, silent from scheduled_messages
      where conversation_id = ${data.conversationId}
        and sender_id = ${context.userId}
        and status = 'pending'
      order by send_at asc
      limit 40
    `;
    return rows;
  });

export const updateScheduledMessage = createServerFn({ method: "POST" })
  .validator((d: { id: string; body?: string; sendAt?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!isResourceId(data.id, "sm")) throw new Error("Scheduled message not found.");
    const row = await sql<{ id: string; conversation_id: string }>`
      select id, conversation_id from scheduled_messages
      where id = ${data.id} and sender_id = ${context.userId} and status = 'pending'
    `;
    if (!row[0]) throw new Error("Scheduled message not found.");
    const body = data.body != null ? data.body.trim().slice(0, 4000) : null;
    const sendAt = data.sendAt ? validateScheduleAt(data.sendAt) : null;
    if (body != null) {
      await sql`update scheduled_messages set body = ${body}, updated_at = now() where id = ${data.id}`;
    }
    if (sendAt) {
      await sql`update scheduled_messages set send_at = ${sendAt.toISOString()}, updated_at = now() where id = ${data.id}`;
    }
    return { ok: true as const };
  });

export const cancelScheduledMessage = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!isResourceId(data.id, "sm")) throw new Error("Scheduled message not found.");
    await sql`
      update scheduled_messages set status = 'cancelled', updated_at = now()
      where id = ${data.id} and sender_id = ${context.userId} and status = 'pending'
    `;
    return { ok: true as const };
  });

export const setRecording = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; recording: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const wait = takeToken(`rec:${context.userId}`, 40, 10_000);
    if (wait) return { ok: true as const };
    if (!data.recording) {
      await sql`
        delete from recording_state
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `.catch(() => undefined);
      return { ok: true as const };
    }
    await sql`
      insert into recording_state (conversation_id, user_id, expires_at)
      values (${data.conversationId}, ${context.userId}, now() + interval '8 seconds')
      on conflict (conversation_id, user_id) do update set expires_at = excluded.expires_at
    `;
    return { ok: true as const };
  });

export const muteChatFor = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; duration: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    if (data.duration === "off") {
      await sql`
        update conversation_members set muted = false, mute_until = null
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { muted: false, until: null as string | null };
    }
    const until = muteUntilFrom(data.duration);
    if (until === "clear") {
      await sql`
        update conversation_members set muted = false, mute_until = null
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { muted: false, until: null as string | null };
    }
    const iso = until ? until.toISOString() : null;
    await sql`
      update conversation_members set muted = true, mute_until = ${iso}
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    return { muted: true, until: iso };
  });

export const pinThreadMessage = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; messageId: string; pinned: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    if (!isResourceId(data.messageId, "m")) throw new Error("Message not found.");
    const role = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    const convo = await sql<{ kind: string }>`select kind from conversations where id = ${data.conversationId}`;
    if (convo[0]?.kind === "group" && role[0]?.role === "member") {
      throw new Error("Only admins can pin messages in this group.");
    }
    const msg = await sql<{ id: string }>`
      select id from messages
      where id = ${data.messageId} and conversation_id = ${data.conversationId} and deleted_at is null
    `;
    if (!msg[0]) throw new Error("Message not found.");
    if (data.pinned) {
      const n = await sql<{ n: number }>`
        select count(*)::int as n from pinned_messages where conversation_id = ${data.conversationId}
      `;
      if ((n[0]?.n ?? 0) >= 5) throw new Error("You can pin up to 5 messages in a chat.");
      await sql`
        insert into pinned_messages (conversation_id, message_id)
        values (${data.conversationId}, ${data.messageId})
        on conflict do nothing
      `;
    } else {
      await sql`
        delete from pinned_messages
        where conversation_id = ${data.conversationId} and message_id = ${data.messageId}
      `;
    }
    await writeAudit(sql, data.conversationId, context.userId, data.pinned ? "pin" : "unpin", data.messageId);
    return { ok: true as const };
  });

export const listPinnedMessages = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const rows = await sql<{
      id: string;
      body: string;
      kind: string;
      sender_id: string;
      created_at: string;
    }>`
      select m.id, m.body, m.kind, m.sender_id, m.created_at
      from pinned_messages p
      join messages m on m.id = p.message_id
      where p.conversation_id = ${data.conversationId} and m.deleted_at is null
      order by m.created_at desc
      limit 5
    `;
    const authors = await loadAuthors(sql, rows.map((r) => r.sender_id));
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      kind: r.kind,
      senderName: authors.get(r.sender_id)?.display_name ?? "Someone",
      createdAt: r.created_at,
    }));
  });

export const bulkDeleteMessages = createServerFn({ method: "POST" })
  .validator((d: { ids: string[]; scope?: "me" | "everyone" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const ids = data.ids.filter((id) => isResourceId(id, "m")).slice(0, 50);
    if (ids.length === 0) return { ok: true as const, n: 0 };
    const scope = data.scope ?? "me";
    let n = 0;
    for (const id of ids) {
      const row = await sql<{ id: string; sender_id: string; conversation_id: string }>`
        select id, sender_id, conversation_id from messages where id = ${id}
      `;
      if (!row[0]) continue;
      await assertMember(sql, row[0].conversation_id, context.userId);
      if (scope === "me") {
        await sql`
          insert into message_hides (message_id, user_id) values (${id}, ${context.userId})
          on conflict do nothing
        `;
        n += 1;
        continue;
      }
      if (row[0].sender_id !== context.userId) continue;
      await sql`
        update messages set deleted_at = now(), body = '', media_url = null
        where id = ${id} and sender_id = ${context.userId}
      `;
      n += 1;
    }
    return { ok: true as const, n };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const wait = takeToken(`clear:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    const rows = await sql<{ id: string }>`
      select id from messages
      where conversation_id = ${data.conversationId}
        and deleted_at is null
        and not exists (
          select 1 from message_hides h where h.message_id = messages.id and h.user_id = ${context.userId}
        )
      order by created_at desc
      limit 2000
    `;
    for (const r of rows) {
      await sql`
        insert into message_hides (message_id, user_id) values (${r.id}, ${context.userId})
        on conflict do nothing
      `;
    }
    await sql`
      update conversation_members set last_read_at = now()
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    return { ok: true as const, n: rows.length };
  });

export const voteChatPoll = createServerFn({ method: "POST" })
  .validator((d: { pollId: string; optionId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!isResourceId(data.pollId, "pl")) throw new Error("Poll not found.");
    const poll = await sql<{
      id: string;
      conversation_id: string;
      options_json: unknown;
      multiple: boolean;
      closed_at: string | null;
      quiz: boolean;
      correct_option_id: string | null;
    }>`
      select id, conversation_id, options_json, multiple, closed_at, quiz, correct_option_id
      from chat_polls where id = ${data.pollId}
    `;
    if (!poll[0]) throw new Error("Poll not found.");
    if (poll[0].closed_at) throw new Error("This poll is closed.");
    await assertMember(sql, poll[0].conversation_id, context.userId);
    const options = Array.isArray(poll[0].options_json)
      ? (poll[0].options_json as Array<{ id: string }>)
      : [];
    if (!options.some((o) => o.id === data.optionId)) throw new Error("That answer isn’t available.");
    if (!poll[0].multiple) {
      await sql`delete from chat_poll_votes where poll_id = ${data.pollId} and user_id = ${context.userId}`;
    } else {
      const existing = await sql<{ option_id: string }>`
        select option_id from chat_poll_votes
        where poll_id = ${data.pollId} and user_id = ${context.userId} and option_id = ${data.optionId}
      `;
      if (existing[0]) {
        await sql`
          delete from chat_poll_votes
          where poll_id = ${data.pollId} and user_id = ${context.userId} and option_id = ${data.optionId}
        `;
        return { ok: true as const, removed: true };
      }
    }
    await sql`
      insert into chat_poll_votes (poll_id, user_id, option_id)
      values (${data.pollId}, ${context.userId}, ${data.optionId})
      on conflict do nothing
    `;
    return { ok: true as const, removed: false, quiz: poll[0].quiz, correct: poll[0].quiz ? poll[0].correct_option_id : null };
  });

export const closeChatPoll = createServerFn({ method: "POST" })
  .validator((d: { pollId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const poll = await sql<{ conversation_id: string; created_by: string }>`
      select conversation_id, created_by from chat_polls where id = ${data.pollId}
    `;
    if (!poll[0]) throw new Error("Poll not found.");
    await assertMember(sql, poll[0].conversation_id, context.userId);
    if (poll[0].created_by !== context.userId) {
      const role = await sql<{ role: string }>`
        select role from conversation_members
        where conversation_id = ${poll[0].conversation_id} and user_id = ${context.userId}
      `;
      if (role[0]?.role !== "owner" && role[0]?.role !== "admin") {
        throw new Error("Only the creator or an admin can close this poll.");
      }
    }
    await sql`update chat_polls set closed_at = now() where id = ${data.pollId} and closed_at is null`;
    return { ok: true as const };
  });

export const getChatPoll = createServerFn({ method: "GET" })
  .validator((d: { pollId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const poll = await sql<{
      id: string;
      conversation_id: string;
      question: string;
      options_json: unknown;
      anonymous: boolean;
      multiple: boolean;
      quiz: boolean;
      correct_option_id: string | null;
      closed_at: string | null;
      created_by: string;
    }>`
      select id, conversation_id, question, options_json, anonymous, multiple, quiz, correct_option_id, closed_at, created_by
      from chat_polls where id = ${data.pollId}
    `;
    if (!poll[0]) throw new Error("Poll not found.");
    await assertMember(sql, poll[0].conversation_id, context.userId);
    const options = (Array.isArray(poll[0].options_json) ? poll[0].options_json : []) as Array<{ id: string; text: string }>;
    const votes = await sql<{ option_id: string; n: number }>`
      select option_id, count(*)::int as n from chat_poll_votes where poll_id = ${data.pollId} group by option_id
    `;
    const mine = await sql<{ option_id: string }>`
      select option_id from chat_poll_votes where poll_id = ${data.pollId} and user_id = ${context.userId}
    `;
    const count = new Map(votes.map((v) => [v.option_id, v.n]));
    const total = votes.reduce((s, v) => s + v.n, 0);
    let voters: Array<{ optionId: string; userId: string; displayName: string }> = [];
    if (!poll[0].anonymous) {
      const people = await sql<{ option_id: string; user_id: string }>`
        select option_id, user_id from chat_poll_votes where poll_id = ${data.pollId}
      `;
      const authors = await loadAuthors(sql, people.map((p) => p.user_id));
      voters = people.map((p) => ({
        optionId: p.option_id,
        userId: p.user_id,
        displayName: authors.get(p.user_id)?.display_name ?? "Someone",
      }));
    }
    return {
      id: poll[0].id,
      question: poll[0].question,
      anonymous: poll[0].anonymous,
      multiple: poll[0].multiple,
      quiz: poll[0].quiz,
      closed: Boolean(poll[0].closed_at),
      correctOptionId: poll[0].quiz && (poll[0].closed_at || mine.length > 0) ? poll[0].correct_option_id : null,
      myVotes: mine.map((m) => m.option_id),
      total,
      options: options.map((o) => ({ id: o.id, text: o.text, votes: count.get(o.id) ?? 0 })),
      voters,
    };
  });

export const createInviteLink = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; expiresHours?: number | null; maxUses?: number | null; requireApproval?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    await assertMember(sql, data.conversationId, context.userId);
    const role = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    if (role[0]?.role !== "owner" && role[0]?.role !== "admin") {
      throw new Error("Only admins can create invite links.");
    }
    const wait = takeToken(`inv:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const hours = data.expiresHours == null ? null : Math.max(1, Math.min(24 * 30, data.expiresHours));
    const maxUses = data.maxUses == null ? null : Math.max(1, Math.min(1000, data.maxUses));
    const id = newId("il");
    const token = newId("inv").replace("inv_", "");
    const expires = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    await sql`
      insert into group_invite_links (
        id, conversation_id, token, created_by, expires_at, max_uses, require_approval
      ) values (
        ${id}, ${data.conversationId}, ${token}, ${context.userId}, ${expires}, ${maxUses}, ${Boolean(data.requireApproval)}
      )
    `;
    await writeAudit(sql, data.conversationId, context.userId, "invite_create", id);
    return { id, token, expiresAt: expires, maxUses, requireApproval: Boolean(data.requireApproval) };
  });

export const listInviteLinks = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const role = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    if (role[0]?.role !== "owner" && role[0]?.role !== "admin") return [];
    return sql<{
      id: string;
      token: string;
      expires_at: string | null;
      max_uses: number | null;
      use_count: number;
      require_approval: boolean;
      revoked_at: string | null;
      created_at: string;
    }>`
      select id, token, expires_at, max_uses, use_count, require_approval, revoked_at, created_at
      from group_invite_links
      where conversation_id = ${data.conversationId}
      order by created_at desc
      limit 20
    `;
  });

export const revokeInviteLink = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ conversation_id: string }>`
      select conversation_id from group_invite_links where id = ${data.id}
    `;
    if (!row[0]) throw new Error("Invite link not found.");
    const role = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${row[0].conversation_id} and user_id = ${context.userId}
    `;
    if (role[0]?.role !== "owner" && role[0]?.role !== "admin") {
      throw new Error("Only admins can revoke invite links.");
    }
    await sql`update group_invite_links set revoked_at = now() where id = ${data.id} and revoked_at is null`;
    await writeAudit(sql, row[0].conversation_id, context.userId, "invite_revoke", data.id);
    return { ok: true as const };
  });

export const joinByInvite = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`join:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const token = data.token.trim().slice(0, 64);
    const link = await sql<{
      id: string;
      conversation_id: string;
      expires_at: string | null;
      max_uses: number | null;
      use_count: number;
      require_approval: boolean;
      revoked_at: string | null;
    }>`
      select id, conversation_id, expires_at, max_uses, use_count, require_approval, revoked_at
      from group_invite_links where token = ${token} limit 1
    `;
    if (!link[0] || link[0].revoked_at) throw new Error("This invite link isn’t available.");
    if (link[0].expires_at && new Date(link[0].expires_at).getTime() < Date.now()) {
      throw new Error("This invite link expired.");
    }
    if (link[0].max_uses != null && link[0].use_count >= link[0].max_uses) {
      throw new Error("This invite link has no uses left.");
    }
    const banned = await sql<{ banned_at: string | null }>`
      select banned_at from conversation_members
      where conversation_id = ${link[0].conversation_id} and user_id = ${context.userId}
    `.catch(() => []);
    if (banned[0]?.banned_at) throw new Error("You can’t join this group.");
    const already = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${link[0].conversation_id} and user_id = ${context.userId}
    `;
    if ((already[0]?.n ?? 0) > 0) return { conversationId: link[0].conversation_id, pending: false };
    if (link[0].require_approval) {
      await sql`
        insert into group_join_requests (conversation_id, user_id, link_id)
        values (${link[0].conversation_id}, ${context.userId}, ${link[0].id})
        on conflict do nothing
      `;
      return { conversationId: link[0].conversation_id, pending: true };
    }
    await sql`
      insert into conversation_members (conversation_id, user_id, role)
      values (${link[0].conversation_id}, ${context.userId}, 'member')
      on conflict do nothing
    `;
    await sql`update group_invite_links set use_count = use_count + 1 where id = ${link[0].id}`;
    await writeAudit(sql, link[0].conversation_id, context.userId, "join", context.userId);
    return { conversationId: link[0].conversation_id, pending: false };
  });

export const listStickerPacks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await seedStickers(sql).catch(() => undefined);
    await ensureDefaultPacks(sql, context.userId);
    const packs = await sql<{
      id: string;
      title: string;
      author_name: string;
      description: string;
      category: string;
      kind: string;
      cover_url: string | null;
      sticker_count: number;
      animated: boolean;
      published: boolean;
      creator_id: string | null;
    }>`
      select id, title, author_name,
        coalesce(description, '') as description,
        coalesce(category, 'official') as category,
        coalesce(kind, 'official') as kind,
        cover_url,
        coalesce(sticker_count, 0) as sticker_count,
        coalesce(animated, false) as animated,
        coalesce(published, true) as published,
        creator_id
      from sticker_packs
      where coalesce(published, true) = true or creator_id = ${context.userId}
      order by title
    `.catch(async () => {
      const rows = await sql<{ id: string; title: string; author_name: string }>`
        select id, title, author_name from sticker_packs order by title
      `;
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        author_name: p.author_name,
        description: "",
        category: "official",
        kind: "official",
        cover_url: null as string | null,
        sticker_count: 0,
        animated: false,
        published: true,
        creator_id: null as string | null,
      }));
    });
    const installed = await sql<{ pack_id: string }>`
      select pack_id from user_sticker_packs where user_id = ${context.userId}
    `;
    const have = new Set(installed.map((p) => p.pack_id));
    const stickers = await sql<{
      id: string;
      pack_id: string;
      emoji: string;
      name: string;
      tags: string;
      animated: boolean;
      media_url: string | null;
      media_kind: string;
      is_official: boolean;
    }>`
      select id, pack_id, emoji,
        coalesce(name, '') as name,
        coalesce(tags, '') as tags,
        coalesce(animated, false) as animated,
        media_url,
        coalesce(media_kind, 'svg') as media_kind,
        coalesce(is_official, true) as is_official
      from stickers
      where coalesce(is_removed, false) = false
      order by sort_order
    `.catch(async () => {
      const rows = await sql<{ id: string; pack_id: string; emoji: string; svg: string }>`
        select id, pack_id, emoji, svg from stickers order by sort_order
      `;
      return rows.map((s) => ({
        id: s.id,
        pack_id: s.pack_id,
        emoji: s.emoji,
        name: "",
        tags: "",
        animated: false,
        media_url: stickerDataUrl(s.svg) as string | null,
        media_kind: "svg",
        is_official: true,
      }));
    });
    const favs = await sql<{ sticker_id: string }>`
      select sticker_id from sticker_favorites where user_id = ${context.userId}
    `;
    const recent = await sql<{ sticker_id: string }>`
      select sticker_id from sticker_recent where user_id = ${context.userId} order by used_at desc limit 24
    `;
    const byPack = new Map<string, typeof stickers>();
    for (const s of stickers) {
      const arr = byPack.get(s.pack_id) ?? [];
      arr.push(s);
      byPack.set(s.pack_id, arr);
    }
    return {
      packs: packs.map((p) => {
        const all = byPack.get(p.id) ?? [];
        const installedPack = have.has(p.id);
        const shown = installedPack ? all : all.slice(0, 8);
        return {
          id: p.id,
          title: p.title,
          authorName: p.author_name,
          description: p.description,
          category: p.category,
          kind: p.kind,
          coverUrl: p.cover_url,
          stickerCount: p.sticker_count || all.length,
          animated: p.animated || all.some((s) => s.animated),
          installed: installedPack,
          mine: p.creator_id === context.userId,
          stickers: shown.map((s) => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            tags: s.tags,
            animated: s.animated,
            mediaKind: s.media_kind,
            url: s.is_official || s.media_kind === "svg" ? "" : s.media_url ?? "",
          })),
        };
      }),
      favoriteIds: favs.map((f) => f.sticker_id),
      recentIds: recent.map((r) => r.sticker_id),
    };
  });


export const toggleStickerPack = createServerFn({ method: "POST" })
  .validator((d: { packId: string; install: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (data.install) {
      await sql`
        insert into user_sticker_packs (user_id, pack_id)
        values (${context.userId}, ${data.packId})
        on conflict do nothing
      `;
    } else {
      await sql`
        delete from user_sticker_packs where user_id = ${context.userId} and pack_id = ${data.packId}
      `;
    }
    return { ok: true as const };
  });

export const toggleFavoriteSticker = createServerFn({ method: "POST" })
  .validator((d: { stickerId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from sticker_favorites
      where user_id = ${context.userId} and sticker_id = ${data.stickerId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from sticker_favorites where user_id = ${context.userId} and sticker_id = ${data.stickerId}`;
      return { favorite: false };
    }
    await sql`
      insert into sticker_favorites (user_id, sticker_id) values (${context.userId}, ${data.stickerId})
      on conflict do nothing
    `;
    return { favorite: true };
  });

export const updateLiveLocation = createServerFn({ method: "POST" })
  .validator((d: { messageId: string; lat: number; lng: number; accuracy?: number | null; stop?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    if (!isResourceId(data.messageId, "m")) throw new Error("Message not found.");
    const loc = data.stop ? null : validateLocation({ lat: data.lat, lng: data.lng, accuracy: data.accuracy });
    const row = await sql<{ conversation_id: string; extra_json: unknown; sender_id: string }>`
      select conversation_id, extra_json, sender_id from messages where id = ${data.messageId} and kind = 'location'
    `;
    if (!row[0] || row[0].sender_id !== context.userId) throw new Error("Couldn't update that location.");
    await assertMember(sql, row[0].conversation_id, context.userId);
    const extra = parseExtra(row[0].extra_json) ?? {};
    if (data.stop) {
      extra.location = extra.location ? { ...extra.location, liveUntil: new Date().toISOString(), liveMs: null } : extra.location;
      await sql`delete from live_locations where message_id = ${data.messageId}`;
    } else if (loc && extra.location) {
      extra.location = { ...extra.location, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy };
      await sql`
        update live_locations
        set lat = ${loc.lat}, lng = ${loc.lng}, accuracy = ${loc.accuracy ?? null}, updated_at = now()
        where message_id = ${data.messageId} and user_id = ${context.userId} and live_until > now()
      `;
    }
    await sql`update messages set extra_json = ${JSON.stringify(extra)}::jsonb where id = ${data.messageId}`;
    return { ok: true as const };
  });

export const createTopic = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; title: string; icon?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const role = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
    if (role[0]?.role !== "owner" && role[0]?.role !== "admin") {
      throw new Error("Only admins can create topics.");
    }
    const title = data.title.trim().slice(0, 40);
    if (title.length < 1) throw new Error("Give the topic a title.");
    const id = newId("tp");
    await sql`
      insert into conversation_topics (id, conversation_id, title, icon, created_by)
      values (${id}, ${data.conversationId}, ${title}, ${(data.icon ?? "").slice(0, 8) || null}, ${context.userId})
    `;
    await sql`update conversations set forum_enabled = true where id = ${data.conversationId}`;
    return { id, title };
  });

export const listTopics = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    return sql<{ id: string; title: string; icon: string | null; closed: boolean; last_message_at: string | null }>`
      select id, title, icon, closed, last_message_at from conversation_topics
      where conversation_id = ${data.conversationId}
      order by last_message_at desc nulls last, created_at desc
      limit 40
    `;
  });

export const previewLink = createServerFn({ method: "POST" })
  .validator((d: { url: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const wait = takeToken(`lp:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const parsed = extractSafeLinks(data.url)[0];
    if (!parsed) return { preview: null as StoredPreview | null };
    const preview = await lookupLinkPreview(parsed.href);
    return { preview };
  });

type StoredPreview = Awaited<ReturnType<typeof lookupLinkPreview>>;

export async function enrichExtraWithPreview(
  extra: MessageExtra | null,
  body: string,
): Promise<MessageExtra | null> {
  if (extra?.noPreview) return extra;
  if (extra?.linkPreview) return extra;
  const first = extractSafeLinks(body)[0];
  if (!first) return extra;
  const preview = await lookupLinkPreview(first.href);
  if (!preview) return extra;
  return {
    ...(extra ?? {}),
    linkPreview: {
      url: preview.url,
      title: preview.title,
      description: preview.description,
      imageUrl: preview.imageUrl,
      domain: preview.domain,
    },
  };
}

export async function prepareOutgoingExtras(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  opts: {
    userId: string;
    conversationId: string;
    kind: string;
    extra?: MessageExtra | null;
  },
): Promise<MessageExtra | null> {
  const extra: MessageExtra = { ...(opts.extra ?? {}) };
  if (opts.kind === "poll") {
    if (!extra.poll) throw new Error("Couldn't create that poll. Add a question.");
    const poll = validatePoll(extra.poll);
    const pollId = newId("pl");
    extra.poll = { ...poll, id: pollId };
    await sql`
      insert into chat_polls (
        id, conversation_id, question, options_json, anonymous, multiple, quiz, correct_option_id, created_by
      ) values (
        ${pollId}, ${opts.conversationId}, ${poll.question}, ${JSON.stringify(poll.options)}::jsonb,
        ${poll.anonymous ?? false}, ${poll.multiple ?? false}, ${poll.quiz ?? false},
        ${poll.correctOptionId ?? null}, ${opts.userId}
      )
    `;
  }
  if (opts.kind === "location" && extra.location) {
    extra.location = validateLocation(extra.location);
    if (extra.location.liveMs) {
      extra.location.liveUntil = new Date(Date.now() + extra.location.liveMs).toISOString();
    }
  }
  if (opts.kind === "contact") {
    const c = extra.contact;
    if (!c) throw new Error("Couldn't share that contact.");
    const profile = c.userId
      ? await getProfile(sql, c.userId)
      : await getProfileByUsername(sql, c.username);
    if (!profile) throw new Error("Couldn't share that contact.");
    extra.contact = validateContact({
      userId: profile.user_id,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
    });
  }
  if (opts.kind === "sticker") {
    const s = extra.sticker;
    if (!s?.stickerId) throw new Error("Couldn't send that sticker.");
    const def = findSticker(s.packId, s.stickerId);
    if (def) extra.sticker = { packId: s.packId, stickerId: s.stickerId, emoji: def.emoji, name: def.name };
  }
  return extra.poll || extra.location || extra.contact || extra.sticker || extra.linkPreview || extra.noPreview
    ? extra
    : opts.extra ?? null;
}

export const setChannelUsername = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; username: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await requireChatStaff(sql, data.conversationId, context.userId, true);
    const convo = await sql<{ is_broadcast: boolean | null }>`
      select is_broadcast from conversations where id = ${data.conversationId}
    `;
    if (!convo[0]?.is_broadcast) throw new Error("Only channels can have a public username.");
    if (data.username == null || !data.username.trim()) {
      await sql`update conversations set username_lc = null where id = ${data.conversationId}`;
      return { username: null as string | null };
    }
    const issue = validateUsername(data.username);
    if (issue) throw new Error(usernameError(issue));
    const uname = normalizeUsername(data.username);
    const takenUser = await sql<{ n: number }>`
      select count(*)::int as n from profiles where username_lc = ${uname}
    `;
    const takenChan = await sql<{ n: number }>`
      select count(*)::int as n from conversations
      where username_lc = ${uname} and id <> ${data.conversationId}
    `;
    if ((takenUser[0]?.n ?? 0) > 0 || (takenChan[0]?.n ?? 0) > 0) {
      throw new Error(usernameError("taken"));
    }
    await sql`update conversations set username_lc = ${uname} where id = ${data.conversationId}`;
    await writeAudit(sql, data.conversationId, context.userId, "username", null, { username: uname });
    return { username: uname };
  });

export const setMemberAccess = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; username: string; action: "restrict" | "unrestrict" | "ban" | "unban" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const myRole = await requireChatStaff(sql, data.conversationId, context.userId);
    const target = await getProfileByUsername(sql, data.username);
    if (!target) throw new Error("User not found.");
    if (target.user_id === context.userId) throw new Error("You can't do that to yourself.");
    const row = await sql<{ role: string }>`
      select role from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${target.user_id}
    `;
    if (!row[0]) throw new Error("They're not in this chat.");
    if (row[0].role === "owner") throw new Error("You can't change the owner.");
    if (row[0].role === "admin" && myRole !== "owner") throw new Error("Only the owner can do that to an admin.");
    if (data.action === "restrict") {
      await sql`
        update conversation_members set restricted = true
        where conversation_id = ${data.conversationId} and user_id = ${target.user_id}
      `;
    } else if (data.action === "unrestrict") {
      await sql`
        update conversation_members set restricted = false
        where conversation_id = ${data.conversationId} and user_id = ${target.user_id}
      `;
    } else if (data.action === "ban") {
      await sql`
        update conversation_members set banned_at = now(), restricted = true
        where conversation_id = ${data.conversationId} and user_id = ${target.user_id}
      `;
    } else {
      await sql`
        update conversation_members set banned_at = null, restricted = false
        where conversation_id = ${data.conversationId} and user_id = ${target.user_id}
      `;
    }
    await writeAudit(sql, data.conversationId, context.userId, data.action, target.user_id);
    return { ok: true as const };
  });

export const listJoinRequests = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await requireChatStaff(sql, data.conversationId, context.userId);
    const rows = await sql<{ user_id: string; created_at: string }>`
      select user_id, created_at from group_join_requests
      where conversation_id = ${data.conversationId}
      order by created_at asc
      limit 40
    `;
    const authors = await loadAuthors(sql, rows.map((r) => r.user_id));
    return rows.map((r) => ({
      userId: r.user_id,
      username: authors.get(r.user_id)?.username ?? "",
      displayName: authors.get(r.user_id)?.display_name ?? "Someone",
      avatarUrl: authors.get(r.user_id)?.avatar_url ?? null,
      createdAt: r.created_at,
    }));
  });

export const resolveJoinRequest = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string; userId: string; approve: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await requireChatStaff(sql, data.conversationId, context.userId);
    const req = await sql<{ user_id: string; link_id: string | null }>`
      select user_id, link_id from group_join_requests
      where conversation_id = ${data.conversationId} and user_id = ${data.userId}
    `;
    if (!req[0]) throw new Error("That request isn’t available.");
    await sql`
      delete from group_join_requests
      where conversation_id = ${data.conversationId} and user_id = ${data.userId}
    `;
    if (!data.approve) {
      await writeAudit(sql, data.conversationId, context.userId, "join_reject", data.userId);
      return { ok: true as const, joined: false };
    }
    await sql`
      insert into conversation_members (conversation_id, user_id, role)
      values (${data.conversationId}, ${data.userId}, 'member')
      on conflict do nothing
    `;
    if (req[0].link_id) {
      await sql`update group_invite_links set use_count = use_count + 1 where id = ${req[0].link_id}`;
    }
    await writeAudit(sql, data.conversationId, context.userId, "join_approve", data.userId);
    return { ok: true as const, joined: true };
  });

export const createDiscussion = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await requireChatStaff(sql, data.conversationId, context.userId, true);
    const convo = await sql<{ title: string | null; linked_discussion_id: string | null; is_broadcast: boolean | null }>`
      select title, linked_discussion_id, is_broadcast from conversations where id = ${data.conversationId}
    `;
    if (!convo[0]?.is_broadcast) throw new Error("Discussion groups are for channels.");
    if (convo[0].linked_discussion_id) return { id: convo[0].linked_discussion_id };
    const id = newId("cv");
    const title = `${(convo[0].title ?? "Channel").slice(0, 40)} comments`;
    await sql`
      insert into conversations (id, kind, title, created_by, is_broadcast)
      values (${id}, 'group', ${title}, ${context.userId}, false)
    `;
    const staff = await sql<{ user_id: string; role: string }>`
      select user_id, role from conversation_members
      where conversation_id = ${data.conversationId} and role in ('owner', 'admin')
    `;
    for (const s of staff) {
      await sql`
        insert into conversation_members (conversation_id, user_id, role)
        values (${id}, ${s.user_id}, ${s.role})
        on conflict do nothing
      `;
    }
    await sql`update conversations set linked_discussion_id = ${id} where id = ${data.conversationId}`;
    await sql`
      insert into messages (id, conversation_id, sender_id, kind, body)
      values (${newId("m")}, ${id}, ${context.userId}, 'text', ${`Discussion for ${convo[0].title ?? "channel"}`})
    `;
    await writeAudit(sql, data.conversationId, context.userId, "discussion", id);
    return { id };
  });

export const joinDiscussion = createServerFn({ method: "POST" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const convo = await sql<{ linked_discussion_id: string | null }>`
      select linked_discussion_id from conversations where id = ${data.conversationId}
    `;
    const id = convo[0]?.linked_discussion_id;
    if (!id) throw new Error("This channel has no discussion group yet.");
    await sql`
      insert into conversation_members (conversation_id, user_id, role)
      values (${id}, ${context.userId}, 'member')
      on conflict do nothing
    `;
    return { id };
  });

export const subscribePublicChannel = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertNotBanned(me);
    const wait = takeToken(`sub:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const uname = normalizeUsername(data.username);
    const convo = await sql<{ id: string; banned_at: string | null }>`
      select c.id, m.banned_at
      from conversations c
      left join conversation_members m
        on m.conversation_id = c.id and m.user_id = ${context.userId}
      where c.username_lc = ${uname} and c.is_broadcast = true
      limit 1
    `;
    if (!convo[0]) throw new Error("Channel not found.");
    if (convo[0].banned_at) throw new Error("You can’t join this channel.");
    await sql`
      insert into conversation_members (conversation_id, user_id, role)
      values (${convo[0].id}, ${context.userId}, 'member')
      on conflict do nothing
    `;
    return { conversationId: convo[0].id };
  });

export const getPublicChannel = createServerFn({ method: "GET" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const uname = normalizeUsername(data.username);
    const row = await sql<{
      id: string;
      title: string | null;
      image_url: string | null;
      description: string | null;
      username_lc: string | null;
    }>`
      select id, title, image_url, description, username_lc
      from conversations
      where username_lc = ${uname} and is_broadcast = true
      limit 1
    `;
    if (!row[0]) throw new Error("Channel not found.");
    const members = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${row[0].id} and banned_at is null
    `.catch(async () => {
      const fallback = await sql<{ n: number }>`
        select count(*)::int as n from conversation_members where conversation_id = ${row[0]!.id}
      `;
      return fallback;
    });
    const mine = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${row[0].id} and user_id = ${context.userId}
        and banned_at is null
    `.catch(async () => {
      const fallback = await sql<{ n: number }>`
        select count(*)::int as n from conversation_members
        where conversation_id = ${row[0]!.id} and user_id = ${context.userId}
      `;
      return fallback;
    });
    return {
      id: row[0].id,
      title: row[0].title ?? "Channel",
      imageUrl: row[0].image_url,
      description: row[0].description,
      username: row[0].username_lc,
      subscribers: members[0]?.n ?? 0,
      joined: (mine[0]?.n ?? 0) > 0,
    };
  });

export const channelStats = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await requireChatStaff(sql, data.conversationId, context.userId);
    const subscribers = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${data.conversationId} and banned_at is null
    `.catch(async () => {
      const fallback = await sql<{ n: number }>`
        select count(*)::int as n from conversation_members where conversation_id = ${data.conversationId}
      `;
      return fallback;
    });
    const posts = await sql<{ n: number }>`
      select count(*)::int as n from messages
      where conversation_id = ${data.conversationId} and deleted_at is null
    `;
    const week = await sql<{ n: number }>`
      select count(*)::int as n from messages
      where conversation_id = ${data.conversationId} and deleted_at is null and created_at > now() - interval '7 days'
    `;
    const reactions = await sql<{ n: number }>`
      select count(*)::int as n from message_reactions r
      join messages m on m.id = r.message_id
      where m.conversation_id = ${data.conversationId}
    `;
    return {
      subscribers: subscribers[0]?.n ?? 0,
      posts: posts[0]?.n ?? 0,
      posts7d: week[0]?.n ?? 0,
      reactions: reactions[0]?.n ?? 0,
    };
  });

export { isMutedAt, parseExtra, assertCanSend };

