import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { assertDataUrl } from "../upload-guard";
import {
  CHAT_COLORS,
  CHAT_FONTS,
  CHAT_THEMES,
  CHAT_WALLPAPERS,
  DEFAULT_CHAT_CUSTOM,
  DISAPPEAR_OPTIONS,
  REMINDER_INTERVAL_MS,
  REMINDER_MAX,
  type ChatCustomization,
} from "../chat-appearance";
import { notify, sqlClient, getProfile } from "./helpers";

const COLOR_IDS = new Set(CHAT_COLORS.map((c) => c.id));
const FONT_IDS = new Set(CHAT_FONTS.map((f) => f.id));
const THEME_IDS = new Set(CHAT_THEMES.map((t) => t.id));
const PAPER_IDS = new Set(CHAT_WALLPAPERS.map((w) => w.id));
const DISAPPEAR_IDS = new Set(DISAPPEAR_OPTIONS.map((d) => d.id));

async function assertMember(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  conversationId: string,
  userId: string,
) {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `;
  if ((rows[0]?.n ?? 0) === 0) throw new Error("Couldn't open this conversation.");
}

function mapRow(r: {
  conversation_id: string;
  theme_id: string;
  chat_color: string;
  wallpaper_type: string;
  wallpaper_key: string | null;
  wallpaper_url: string | null;
  font_id: string;
  disappearing_enabled: boolean;
  disappearing_duration_sec: number;
  reminders_enabled: boolean;
}): ChatCustomization {
  return {
    conversationId: r.conversation_id,
    themeId: r.theme_id,
    chatColor: r.chat_color,
    wallpaperType: (r.wallpaper_type as ChatCustomization["wallpaperType"]) || "builtin",
    wallpaperKey: r.wallpaper_key,
    wallpaperUrl: r.wallpaper_url,
    fontId: r.font_id,
    disappearingEnabled: r.disappearing_enabled,
    disappearingDurationSec: r.disappearing_duration_sec,
    remindersEnabled: r.reminders_enabled,
  };
}

export const getChatCustomization = createServerFn({ method: "GET" })
  .validator((d: { conversationId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<ChatCustomization> => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const rows = await sql<{
      conversation_id: string;
      theme_id: string;
      chat_color: string;
      wallpaper_type: string;
      wallpaper_key: string | null;
      wallpaper_url: string | null;
      font_id: string;
      disappearing_enabled: boolean;
      disappearing_duration_sec: number;
      reminders_enabled: boolean;
    }>`
      select conversation_id, theme_id, chat_color, wallpaper_type, wallpaper_key, wallpaper_url,
             font_id, disappearing_enabled, disappearing_duration_sec, reminders_enabled
      from chat_customizations
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      limit 1
    `;
    if (rows[0]) return mapRow(rows[0]);
    const convo = await sql<{ disappear_sec: number }>`
      select coalesce(disappear_sec, 0)::int as disappear_sec from conversations where id = ${data.conversationId}
    `;
    const sec = convo[0]?.disappear_sec ?? 0;
    return {
      conversationId: data.conversationId,
      ...DEFAULT_CHAT_CUSTOM,
      disappearingEnabled: sec > 0,
      disappearingDurationSec: sec,
    };
  });

export const saveChatCustomization = createServerFn({ method: "POST" })
  .validator((d: {
    conversationId: string;
    themeId?: string;
    chatColor?: string;
    wallpaperType?: "builtin" | "gallery" | "none";
    wallpaperKey?: string | null;
    wallpaperUrl?: string | null;
    wallpaperW?: number | null;
    wallpaperH?: number | null;
    fontId?: string;
    disappearingEnabled?: boolean;
    disappearingDurationSec?: number;
    remindersEnabled?: boolean;
    applyDisappearToChat?: boolean;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await assertMember(sql, data.conversationId, context.userId);
    const wait = takeToken(`chat-custom:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));

    const existing = await sql<{
      theme_id: string;
      chat_color: string;
      wallpaper_type: string;
      wallpaper_key: string | null;
      wallpaper_url: string | null;
      font_id: string;
      disappearing_enabled: boolean;
      disappearing_duration_sec: number;
      reminders_enabled: boolean;
    }>`
      select theme_id, chat_color, wallpaper_type, wallpaper_key, wallpaper_url, font_id,
             disappearing_enabled, disappearing_duration_sec, reminders_enabled
      from chat_customizations
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      limit 1
    `;
    const current = existing[0]
      ? mapRow({ conversation_id: data.conversationId, ...existing[0] })
      : { conversationId: data.conversationId, ...DEFAULT_CHAT_CUSTOM };
    const themeId = data.themeId && THEME_IDS.has(data.themeId as never) ? data.themeId : current.themeId;
    const chatColor = data.chatColor && COLOR_IDS.has(data.chatColor as never) ? data.chatColor : current.chatColor;
    const fontId = data.fontId && FONT_IDS.has(data.fontId as never) ? data.fontId : current.fontId;
    const wallpaperType = data.wallpaperType ?? current.wallpaperType;
    let wallpaperKey = data.wallpaperKey ?? current.wallpaperKey;
    let wallpaperUrl = current.wallpaperUrl;
    let wallpaperW: number | null = null;
    let wallpaperH: number | null = null;
    let wallpaperBytes: number | null = null;
    if (wallpaperType === "builtin") {
      wallpaperKey = wallpaperKey && PAPER_IDS.has(wallpaperKey as never) ? wallpaperKey : "void";
      wallpaperUrl = null;
    } else if (wallpaperType === "gallery") {
      if (data.wallpaperUrl) {
        assertDataUrl(data.wallpaperUrl);
        if (data.wallpaperUrl.length > 900_000) throw new Error("Wallpaper is too large. Pick a smaller image.");
        wallpaperUrl = data.wallpaperUrl;
        wallpaperW = data.wallpaperW ?? null;
        wallpaperH = data.wallpaperH ?? null;
        wallpaperBytes = data.wallpaperUrl.length;
      }
    } else {
      wallpaperKey = null;
      wallpaperUrl = null;
    }
    const duration = DISAPPEAR_IDS.has((data.disappearingDurationSec ?? current.disappearingDurationSec) as never)
      ? (data.disappearingDurationSec ?? current.disappearingDurationSec)
      : 0;
    const disappearingEnabled = data.disappearingEnabled ?? duration > 0;
    const remindersEnabled = data.remindersEnabled ?? current.remindersEnabled;

    await sql`
      insert into chat_customizations (
        conversation_id, user_id, theme_id, chat_color, wallpaper_type, wallpaper_key, wallpaper_url,
        wallpaper_w, wallpaper_h, wallpaper_bytes, font_id, disappearing_enabled, disappearing_duration_sec,
        reminders_enabled, updated_at
      ) values (
        ${data.conversationId}, ${context.userId}, ${themeId}, ${chatColor}, ${wallpaperType}, ${wallpaperKey},
        ${wallpaperUrl}, ${wallpaperW}, ${wallpaperH}, ${wallpaperBytes}, ${fontId}, ${disappearingEnabled},
        ${duration}, ${remindersEnabled}, now()
      )
      on conflict (conversation_id, user_id) do update set
        theme_id = excluded.theme_id,
        chat_color = excluded.chat_color,
        wallpaper_type = excluded.wallpaper_type,
        wallpaper_key = excluded.wallpaper_key,
        wallpaper_url = excluded.wallpaper_url,
        wallpaper_w = excluded.wallpaper_w,
        wallpaper_h = excluded.wallpaper_h,
        wallpaper_bytes = excluded.wallpaper_bytes,
        font_id = excluded.font_id,
        disappearing_enabled = excluded.disappearing_enabled,
        disappearing_duration_sec = excluded.disappearing_duration_sec,
        reminders_enabled = excluded.reminders_enabled,
        updated_at = now()
    `;

    if (data.applyDisappearToChat) {
      await sql`update conversations set disappear_sec = ${disappearingEnabled ? duration : 0} where id = ${data.conversationId}`;
    }
    return { ok: true as const };
  });

export const inboxUnreadCount = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ n: number }>`
      select count(*)::int as n
      from messages m
      join conversation_members cm
        on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId}
      where m.sender_id <> ${context.userId}
        and m.deleted_at is null
        and (m.expires_at is null or m.expires_at > now())
        and (cm.last_read_at is null or m.created_at > cm.last_read_at)
        and coalesce(cm.archived, false) = false
    `;
    const latest = await sql<{
      conversation_id: string;
      body: string;
      kind: string;
      sender_id: string;
      created_at: string;
    }>`
      select m.conversation_id, m.body, m.kind, m.sender_id, m.created_at
      from messages m
      join conversation_members cm
        on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId}
      where m.sender_id <> ${context.userId}
        and m.deleted_at is null
        and (m.expires_at is null or m.expires_at > now())
        and (cm.last_read_at is null or m.created_at > cm.last_read_at)
        and coalesce(cm.muted, false) = false
        and coalesce(cm.archived, false) = false
      order by m.created_at desc
      limit 1
    `;
    let preview: {
      conversationId: string;
      body: string;
      senderName: string;
      senderAvatar: string | null;
      senderUsername: string;
    } | null = null;
    if (latest[0]) {
      const actor = await getProfile(sql, latest[0].sender_id);
      preview = {
        conversationId: latest[0].conversation_id,
        body: latest[0].body || latest[0].kind,
        senderName: actor?.display_name ?? "Someone",
        senderAvatar: actor?.avatar_url ?? null,
        senderUsername: actor?.username ?? "",
      };
    }
    return { unread: rows[0]?.n ?? 0, preview };
  });

export async function expireChatMessages(sql: Awaited<ReturnType<typeof sqlClient>>): Promise<number> {
  const gone = await sql<{ id: string }>`
    update messages
       set deleted_at = coalesce(deleted_at, now()), body = '', media_url = null
     where expires_at is not null
       and expires_at <= now()
       and deleted_at is null
     returning id
  `;
  return gone.length;
}

export async function sweepMessageReminders(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  recipientId: string,
): Promise<void> {
  const intervalMs = Number(process.env.NYX_MESSAGE_REMINDER_MS ?? REMINDER_INTERVAL_MS);
  const interval = Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : REMINDER_INTERVAL_MS;
  const cutoff = new Date(Date.now() - interval).toISOString();
  const prefs = await getProfile(sql, recipientId);
  const raw = prefs?.notif_prefs;
  const obj =
    typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : ((raw ?? {}) as Record<string, unknown>);
  if (obj.messages === false || obj.messageReminders === false) return;

  const rows = await sql<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }>`
    select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
    from messages m
    join conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = ${recipientId}
    left join chat_customizations cc
      on cc.conversation_id = m.conversation_id and cc.user_id = ${recipientId}
    where m.sender_id <> ${recipientId}
      and m.deleted_at is null
      and (m.expires_at is null or m.expires_at > now())
      and (cm.last_read_at is null or m.created_at > cm.last_read_at)
      and coalesce(cm.muted, false) = false
      and coalesce(cc.reminders_enabled, true) = true
      and m.created_at <= ${cutoff}
    order by m.created_at asc
    limit 8
  `;
  for (const m of rows) {
    const existing = await sql<{ reminder_count: number; last_reminder_at: string | null }>`
      select reminder_count, last_reminder_at from message_reminders
      where message_id = ${m.id} and recipient_id = ${recipientId}
    `;
    const count = existing[0]?.reminder_count ?? 0;
    if (count >= REMINDER_MAX) continue;
    const last = existing[0]?.last_reminder_at ? new Date(existing[0].last_reminder_at).getTime() : 0;
    if (last && Date.now() - last < interval) continue;
    const sender = await getProfile(sql, m.sender_id);
    await notify(sql, {
      userId: recipientId,
      kind: "message_reminder",
      body: `${sender?.display_name ?? "Someone"} is waiting on a reply`,
      actorId: m.sender_id,
      entityId: m.conversation_id,
      prefKey: "messages",
    });
    if (existing[0]) {
      await sql`
        update message_reminders
           set reminder_count = reminder_count + 1, last_reminder_at = now()
         where message_id = ${m.id} and recipient_id = ${recipientId}
      `;
    } else {
      await sql`
        insert into message_reminders (id, message_id, conversation_id, recipient_id, last_reminder_at, reminder_count)
        values (${newId("mr")}, ${m.id}, ${m.conversation_id}, ${recipientId}, now(), 1)
        on conflict (message_id, recipient_id) do update set
          reminder_count = message_reminders.reminder_count + 1,
          last_reminder_at = now()
      `;
    }
  }
}

export async function clearRemindersForConversation(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  conversationId: string,
  recipientId: string,
): Promise<void> {
  await sql`
    delete from message_reminders
    where conversation_id = ${conversationId} and recipient_id = ${recipientId}
  `;
}
