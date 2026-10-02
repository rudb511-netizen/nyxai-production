import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseExtra } from "../comms-extra";
import { OMNI_SUPPORT_DISPLAY, OMNI_SUPPORT_USER_ID } from "../omni-support-ids";
import { authorLite, ensureProfile, loadAuthors, requireArc, sqlClient } from "./helpers";
import { deliverOutgoing } from "./chat-deliver";
import { ensureOmniSupportUser } from "./omni-support";

async function assertSupportConversation(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  conversationId: string,
) {
  const members = await sql<{ user_id: string }>`
    select user_id from conversation_members where conversation_id = ${conversationId}
  `;
  if (!members.some((m) => m.user_id === OMNI_SUPPORT_USER_ID)) {
    throw new Error("Not a NYX Support conversation.");
  }
  const other = members.find((m) => m.user_id !== OMNI_SUPPORT_USER_ID);
  if (!other) throw new Error("Not a NYX Support conversation.");
  return other.user_id;
}

export const listSupportInbox = createServerFn({ method: "GET" })
  .validator((d: { q?: string; cursor?: string | null } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireArc(me);
    await ensureOmniSupportUser(sql);
    const q = (data.q ?? "").trim().slice(0, 80);
    const like = q ? `%${q.replace(/[%_]/g, "")}%` : null;
    const rows = await sql.query<{
      id: string;
      last_message_body: string | null;
      last_message_at: string | null;
      last_message_kind: string | null;
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      last_read_at: string | null;
    }>(
      `select c.id, c.last_message_body, c.last_message_at, c.last_message_kind,
              p.user_id, p.username, p.display_name, p.avatar_url,
              sr.last_read_at
       from conversations c
       join conversation_members sm on sm.conversation_id = c.id and sm.user_id = $1
       join conversation_members um on um.conversation_id = c.id and um.user_id <> $1
       join profiles p on p.user_id = um.user_id
       left join support_reads sr on sr.conversation_id = c.id and sr.admin_id = $2
       where c.kind = 'dm'
         and ($3::text is null
           or p.display_name ilike $3
           or p.username ilike $3
           or coalesce(c.last_message_body, '') ilike $3)
         and ($4::timestamptz is null or c.last_message_at < $4)
       order by c.last_message_at desc nulls last
       limit 40`,
      [OMNI_SUPPORT_USER_ID, context.userId, like, data.cursor ?? null],
    );
    const items = rows.map((r) => {
      const unread =
        r.last_message_at && (!r.last_read_at || new Date(r.last_message_at) > new Date(r.last_read_at));
      return {
        id: r.id,
        lastMessage: r.last_message_body,
        lastKind: r.last_message_kind,
        lastAt: r.last_message_at,
        unread: Boolean(unread),
        user: {
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
        },
      };
    });
    return {
      items,
      nextCursor: rows.length === 40 ? rows[rows.length - 1]!.last_message_at : null,
    };
  });

export const supportInboxUnread = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireArc(me);
    const rows = await sql<{ n: number }>`
      select count(*)::int as n
      from conversations c
      join conversation_members sm on sm.conversation_id = c.id and sm.user_id = ${OMNI_SUPPORT_USER_ID}
      left join support_reads sr on sr.conversation_id = c.id and sr.admin_id = ${context.userId}
      where c.kind = 'dm'
        and c.last_message_at is not null
        and (sr.last_read_at is null or c.last_message_at > sr.last_read_at)
    `.catch(() => [{ n: 0 }]);
    return { count: rows[0]?.n ?? 0 };
  });

export const listSupportThread = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string; before?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireArc(me);
    const memberId = await assertSupportConversation(sql, data.conversationId);
    const rows = await sql.query<{
      id: string;
      sender_id: string;
      kind: string;
      body: string;
      media_url: string | null;
      extra_json: unknown;
      created_at: string;
    }>(
      `select id, sender_id, kind, body, media_url, extra_json, created_at
       from messages
       where conversation_id = $1
         and deleted_at is null
         and ($2::timestamptz is null or created_at < $2)
       order by created_at desc
       limit 40`,
      [data.conversationId, data.before ?? null],
    );
    const authors = await loadAuthors(
      sql,
      rows.map((r) => r.sender_id).concat(memberId),
    );
    const member = authors.get(memberId);
    await sql`
      insert into support_reads (conversation_id, admin_id, last_read_at)
      values (${data.conversationId}, ${context.userId}, now())
      on conflict (conversation_id, admin_id) do update set last_read_at = now()
    `.catch(() => undefined);
    const messages = rows
      .slice()
      .reverse()
      .map((r) => {
        const extra = parseExtra(r.extra_json);
        const sender = authors.get(r.sender_id);
        return {
          id: r.id,
          senderId: r.sender_id,
          kind: r.kind,
          body: r.body,
          mediaUrl: r.media_url,
          createdAt: r.created_at,
          extra,
          senderName:
            r.sender_id === OMNI_SUPPORT_USER_ID
              ? extra?.supportAgentName
                ? `${OMNI_SUPPORT_DISPLAY} · ${extra.supportAgentName}`
                : OMNI_SUPPORT_DISPLAY
              : sender?.display_name ?? "Member",
          fromSupport: r.sender_id === OMNI_SUPPORT_USER_ID,
          agentName: extra?.supportAgentName ?? null,
        };
      });
    return {
      conversationId: data.conversationId,
      member: member ? authorLite(member) : { userId: memberId, username: "", displayName: "Member", avatarUrl: null, verifyKind: "none" as const, isArc: false, isPremium: false },
      messages,
      nextBefore: rows.length === 40 ? rows[rows.length - 1]!.created_at : null,
    };
  });

export const replySupport = createServerFn({ method: "POST" })
  .validator((d: {
    conversationId: string;
    body?: string;
    kind?: string;
    mediaUrl?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireArc(me);
    await assertSupportConversation(sql, data.conversationId);
    const support = await ensureOmniSupportUser(sql);
    const body = (data.body ?? "").trim().slice(0, 4000);
    const kind = data.kind ?? (data.mediaUrl ? "image" : "text");
    if (!body && !data.mediaUrl) throw new Error("Write a reply.");
    const extra = {
      supportAgentId: me.user_id,
      supportAgentName: me.display_name,
    };
    const sent = await deliverOutgoing(sql, {
      conversationId: data.conversationId,
      senderId: OMNI_SUPPORT_USER_ID,
      senderName: support.display_name || OMNI_SUPPORT_DISPLAY,
      kind,
      body,
      mediaUrl: data.mediaUrl,
      extra,
    });
    await sql`
      insert into support_reads (conversation_id, admin_id, last_read_at)
      values (${data.conversationId}, ${context.userId}, now())
      on conflict (conversation_id, admin_id) do update set last_read_at = now()
    `.catch(() => undefined);
    return { id: sent.id };
  });
